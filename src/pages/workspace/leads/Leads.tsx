import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { useSearchParams } from "react-router";
import { supabase } from "../../../lib/supabase";
import { useAuth } from "../../../lib/auth";
import { useWorkspace } from "../../../lib/workspace";
import { useLiveTable } from "../../../lib/realtime";
import { nameOf, useMembers } from "../../../lib/members";
import { date, downloadCsv, inr } from "../../../lib/format";
import { Alert, Badge, Button, Card, Empty, Input, Select, Spinner } from "../../../components/ui";
import LeadModal, { type Lead } from "./LeadModal";
import ConvertModal from "./ConvertModal";
import { localDay } from "../time/timeUtil";
import { SOURCES, STAGES, STAGE_LABEL, STAGE_TONE, parseFields, type FormField, type Stage } from "./leadShared";

type View = "board" | "table";

function byPosition(a: Lead, b: Lead) {
  return a.position - b.position || b.created_at.localeCompare(a.created_at);
}

function followUpTone(d: string | null) {
  if (!d) return "";
  const today = localDay();
  return d < today ? "text-red-600" : d === today ? "text-amber-700" : "text-slate-500";
}

export default function Leads() {
  const { workspace, canWrite, isAdmin, hasModule } = useWorkspace();
  const { session } = useAuth();
  const me = session?.user.id ?? "";
  const people = useMembers(workspace.id);
  const [params, setParams] = useSearchParams();

  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [forms, setForms] = useState<Record<string, { title: string; fields: FormField[] }>>({});
  const [error, setError] = useState("");
  const [view, setView] = useState<View>(() => {
    try {
      return localStorage.getItem("leads-view") === "table" ? "table" : "board";
    } catch {
      return "board";
    }
  });
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("");
  const [source, setSource] = useState("");
  const [assignee, setAssignee] = useState("");
  const [editing, setEditing] = useState<Lead | "new" | null>(null);
  const [converting, setConverting] = useState<Lead | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<Stage | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("position")
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    setLeads(data ?? []);
    // Only admins can read forms; staff just see answer keys.
    const { data: f } = await supabase.from("lead_forms").select("id, title, fields").eq("workspace_id", workspace.id);
    setForms(Object.fromEntries((f ?? []).map((x) => [x.id, { title: x.title, fields: parseFields(x.fields) }])));
  }, [workspace.id]);

  useEffect(() => {
    load();
  }, [load]);

  useLiveTable("leads", `workspace_id=eq.${workspace.id}`, load);

  // Opening a lead from a notification link (?open=<lead id>).
  const openId = params.get("open");
  useEffect(() => {
    if (!openId || !leads) return;
    const l = leads.find((x) => x.id === openId);
    if (l) setEditing(l);
    setParams((p) => {
      p.delete("open");
      return p;
    }, { replace: true });
  }, [openId, leads, setParams]);

  function switchView(v: View) {
    setView(v);
    try {
      localStorage.setItem("leads-view", v);
    } catch {
      /* ignore */
    }
  }

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (leads ?? []).filter((l) => {
      if (view === "table" && stage && l.stage !== stage) return false;
      if (source && l.source !== source) return false;
      if (assignee === "none" ? l.assigned_to : assignee && l.assigned_to !== assignee) return false;
      if (!term) return true;
      return [l.name, l.phone, l.email, l.company, l.notes].some((x) => x?.toLowerCase().includes(term));
    });
  }, [leads, q, stage, source, assignee, view]);

  const sourceOptions = useMemo(() => {
    const extra = (leads ?? []).map((l) => l.source).filter((s) => !SOURCES.includes(s));
    return [...SOURCES, ...new Set(extra)];
  }, [leads]);

  // Moves a lead to a stage, before another card (or to the end), and renumbers that column.
  async function move(id: string, to: Stage, beforeId: string | null) {
    if (!leads) return;
    const lead = leads.find((l) => l.id === id);
    if (!lead || id === beforeId) return;
    const column = leads.filter((l) => l.stage === to && l.id !== id).sort(byPosition);
    const at = beforeId ? column.findIndex((l) => l.id === beforeId) : -1;
    column.splice(at < 0 ? column.length : at, 0, { ...lead, stage: to });
    const changes = column
      .map((l, i) => ({ l, i }))
      .filter(({ l, i }) => l.position !== i || (l.id === id && lead.stage !== to));
    if (!changes.length) return;

    const prev = leads;
    const updated = new Map(changes.map(({ l, i }) => [l.id, { ...l, position: i }]));
    setLeads(leads.map((l) => updated.get(l.id) ?? l));
    setError("");
    const results = await Promise.all(
      changes.map(({ l, i }) =>
        supabase
          .from("leads")
          .update(l.id === id ? { stage: to, position: i } : { position: i })
          .eq("workspace_id", workspace.id)
          .eq("id", l.id),
      ),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      setError(failed.error.message);
      setLeads(prev);
      load();
      return;
    }
    if (to === "won" && lead.stage !== "won" && !lead.converted_client_id) setConverting({ ...lead, stage: "won" });
  }

  async function quickStage(lead: Lead, to: Stage) {
    const top = Math.min(0, ...(leads ?? []).filter((l) => l.stage === to).map((l) => l.position)) - 1;
    setError("");
    const { error } = await supabase.from("leads").update({ stage: to, position: top }).eq("workspace_id", workspace.id).eq("id", lead.id);
    if (error) return setError(error.message);
    setLeads((ls) => (ls ?? []).map((l) => (l.id === lead.id ? { ...l, stage: to, position: top } : l)));
    if (to === "won" && !lead.converted_client_id) setConverting({ ...lead, stage: "won" });
  }

  function onDragStart(e: DragEvent, id: string) {
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
    setDragId(id);
  }

  function onDrop(e: DragEvent, to: Stage, beforeId: string | null) {
    e.preventDefault();
    e.stopPropagation();
    const id = e.dataTransfer.getData("text/plain") || dragId;
    setDragId(null);
    setOverStage(null);
    if (id) move(id, to, beforeId);
  }

  if (!hasModule("leads")) {
    return (
      <Card title="Leads">
        <p className="text-sm text-slate-500">Leads are not part of your current plan. Upgrade on the Subscription page to use them.</p>
      </Card>
    );
  }
  if (!leads) return <Spinner />;

  const open = leads.filter((l) => !["won", "lost"].includes(l.stage));
  const pipelineValue = open.reduce((s, l) => s + Number(l.value ?? 0), 0);
  const draggable = canWrite;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Leads</h1>
          <p className="text-sm text-slate-500">
            {open.length} open lead{open.length === 1 ? "" : "s"} worth {inr(pipelineValue)}
            {!isAdmin && " · showing leads given to you or added by you"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="inline-flex rounded-md ring-1 ring-slate-300" role="group" aria-label="View">
            {(["board", "table"] as View[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => switchView(v)}
                className={`px-3 py-2 text-sm first:rounded-l-md last:rounded-r-md ${view === v ? "bg-indigo-600 text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`}
              >
                {v === "board" ? "Board" : "List"}
              </button>
            ))}
          </div>
          <Button
            variant="secondary"
            onClick={() =>
              downloadCsv(
                "leads.csv",
                ["Name", "Company", "Phone", "Email", "Source", "Stage", "Value", "Score", "Assigned to", "Follow-up", "Added"],
                filtered.map((l) => [l.name, l.company, l.phone, l.email, l.source, STAGE_LABEL[l.stage as Stage], l.value, l.score, nameOf(people, l.assigned_to), l.follow_up_date, l.created_at.slice(0, 10)]),
              )
            }
          >
            Export
          </Button>
          {canWrite && <Button onClick={() => setEditing("new")}>+ Add lead</Button>}
        </div>
      </div>

      {error && <Alert>{error}</Alert>}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Input type="search" placeholder="Search name, phone, email, company" value={q} onChange={(e) => setQ(e.target.value)} />
        {view === "table" && (
          <Select value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Stage">
            <option value="">All stages</option>
            {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </Select>
        )}
        <Select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source">
          <option value="">All sources</option>
          {sourceOptions.map((s) => <option key={s}>{s}</option>)}
        </Select>
        <Select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Assigned to">
          <option value="">Anyone</option>
          <option value="none">Not assigned</option>
          {people.map((p) => <option key={p.user_id} value={p.user_id}>{p.user_id === me ? `${p.full_name} (me)` : p.full_name}</option>)}
        </Select>
      </div>

      {view === "board" ? (
        <div className="-mx-4 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
          {canWrite && <p className="mb-2 text-xs text-slate-500">Drag a card to another column to change its stage. On a phone, tap a card to change it.</p>}
          <div className="flex gap-3">
            {STAGES.map((s) => {
              const cards = filtered.filter((l) => l.stage === s.key).sort(byPosition);
              const total = cards.reduce((sum, l) => sum + Number(l.value ?? 0), 0);
              return (
                <section
                  key={s.key}
                  aria-label={s.label}
                  className={`flex w-64 shrink-0 flex-col rounded-lg border-t-4 bg-slate-100 p-2 ${s.bar} ${overStage === s.key ? "ring-2 ring-indigo-400" : ""}`}
                  onDragOver={(e) => {
                    if (!draggable || !dragId) return;
                    e.preventDefault();
                    if (overStage !== s.key) setOverStage(s.key);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverStage(null);
                  }}
                  onDrop={(e) => draggable && onDrop(e, s.key, null)}
                >
                  <header className="mb-2 flex items-baseline justify-between px-1">
                    <span className="text-sm font-semibold">{s.label} <span className="font-normal text-slate-500">{cards.length}</span></span>
                    {total > 0 && <span className="text-xs text-slate-500">{inr(total)}</span>}
                  </header>
                  <div className="flex min-h-24 flex-1 flex-col gap-2">
                    {cards.map((l) => (
                      <article
                        key={l.id}
                        draggable={draggable}
                        onDragStart={(e) => onDragStart(e, l.id)}
                        onDragEnd={() => {
                          setDragId(null);
                          setOverStage(null);
                        }}
                        onDragOver={(e) => draggable && dragId && e.preventDefault()}
                        onDrop={(e) => draggable && onDrop(e, s.key, l.id)}
                        onClick={() => setEditing(l)}
                        className={`cursor-pointer rounded-md bg-white p-3 text-sm shadow-sm ring-1 ring-slate-200 hover:ring-indigo-300 ${dragId === l.id ? "opacity-40" : ""}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate font-medium">{l.name}</div>
                            {l.company && <div className="truncate text-xs text-slate-500">{l.company}</div>}
                          </div>
                          {l.value != null && <span className="shrink-0 text-xs font-medium">{inr(l.value)}</span>}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-1">
                          <Badge>{l.source}</Badge>
                          {l.score != null && <Badge tone={l.score >= 70 ? "bg-green-100 text-green-800" : l.score >= 40 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}>Score {l.score}</Badge>}
                          {l.converted_client_id && <Badge tone="bg-green-100 text-green-800">Client</Badge>}
                        </div>
                        {(l.assigned_to || l.follow_up_date) && (
                          <div className="mt-2 flex justify-between gap-2 text-xs">
                            <span className="truncate text-slate-500">{nameOf(people, l.assigned_to)}</span>
                            {l.follow_up_date && <span className={`shrink-0 ${followUpTone(l.follow_up_date)}`}>Follow up {date(l.follow_up_date)}</span>}
                          </div>
                        )}
                      </article>
                    ))}
                    {!cards.length && <p className="px-1 py-4 text-center text-xs text-slate-400">No leads</p>}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        <Card>
          {filtered.length ? (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <th className="px-5 py-2 font-medium">Lead</th>
                    <th className="px-2 py-2 font-medium">Contact</th>
                    <th className="px-2 py-2 font-medium">Source</th>
                    <th className="px-2 py-2 font-medium">Stage</th>
                    <th className="px-2 py-2 text-right font-medium">Value</th>
                    <th className="px-2 py-2 font-medium">Assigned</th>
                    <th className="px-5 py-2 font-medium">Follow-up</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...filtered].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((l) => (
                    <tr key={l.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setEditing(l)}>
                      <td className="px-5 py-2">
                        <div className="font-medium">{l.name}</div>
                        {l.company && <div className="text-xs text-slate-500">{l.company}</div>}
                      </td>
                      <td className="px-2 py-2 text-xs">
                        {l.phone && <div>{l.phone}</div>}
                        {l.email && <div className="text-slate-500">{l.email}</div>}
                      </td>
                      <td className="px-2 py-2">{l.source}</td>
                      <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                        {canWrite ? (
                          <select
                            aria-label={`Stage of ${l.name}`}
                            className={`rounded-full border-0 px-2 py-0.5 text-xs font-medium ${STAGE_TONE[l.stage as Stage]}`}
                            value={l.stage}
                            onChange={(e) => quickStage(l, e.target.value as Stage)}
                          >
                            {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                          </select>
                        ) : (
                          <Badge tone={STAGE_TONE[l.stage as Stage]}>{STAGE_LABEL[l.stage as Stage]}</Badge>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">{l.value != null ? inr(l.value) : ""}</td>
                      <td className="px-2 py-2">{nameOf(people, l.assigned_to)}</td>
                      <td className={`px-5 py-2 ${followUpTone(l.follow_up_date)}`}>{date(l.follow_up_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>{leads.length ? "No leads match these filters." : "No leads yet. Add one, or share a lead form."}</Empty>
          )}
        </Card>
      )}

      {editing && (
        <LeadModal
          lead={editing === "new" ? null : editing}
          people={people}
          me={me}
          formFields={forms}
          onClose={() => setEditing(null)}
          onSaved={(saved, prevStage) => {
            setEditing(null);
            setLeads((ls) => {
              const list = ls ?? [];
              return list.some((l) => l.id === saved.id) ? list.map((l) => (l.id === saved.id ? saved : l)) : [saved, ...list];
            });
            if (saved.stage === "won" && prevStage !== "won" && !saved.converted_client_id) setConverting(saved);
          }}
          onDeleted={(id) => {
            setEditing(null);
            setLeads((ls) => (ls ?? []).filter((l) => l.id !== id));
          }}
          onConvert={(l) => {
            setEditing(null);
            setConverting(l);
          }}
        />
      )}

      {converting && (
        <ConvertModal
          lead={converting}
          onClose={() => setConverting(null)}
          onDone={(clientId) =>
            setLeads((ls) => (ls ?? []).map((l) => (l.id === converting.id ? { ...l, stage: "won", converted_client_id: clientId } : l)))
          }
        />
      )}
    </>
  );
}
