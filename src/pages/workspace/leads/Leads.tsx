import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { supabase } from "../../../lib/supabase";
import { useAuth } from "../../../lib/auth";
import { useWorkspace } from "../../../lib/workspace";
import { useLiveTable } from "../../../lib/realtime";
import { nameOf, useMembers } from "../../../lib/members";
import { downloadCsv, inr } from "../../../lib/format";
import { Alert, Badge, Button, Card, Drawer, Empty, Input, Select, Spinner } from "../../../components/ui";
import LeadPanel from "./LeadPanel";
import { answerTone, parseAnswers, useLeadQuestions } from "./leadQuestions";
import LeadModal, { type Lead } from "./LeadModal";
import ConvertModal from "./ConvertModal";
import { LostReasonModal, followUpTone, whenLabel } from "./followUp";
import { ago } from "./LeadTimeline";
import { lockTimeLabel, useLeadLock } from "./leadLock";
import { SOURCES, STAGES, STAGE_LABEL, STAGE_TONE, parseFields, type FormField, type Stage } from "./leadShared";

type View = "board" | "table";

const PAGE_SIZE = 50;
const BOARD_STEP = 20;

function byPosition(a: Lead, b: Lead) {
  return a.position - b.position || b.created_at.localeCompare(a.created_at);
}

const isOpen = (l: Lead) => l.stage !== "won" && l.stage !== "lost";

// While the Stuck lock is on, staff see a pointer to their overdue leads instead.
export default function Leads() {
  const { workspace, hasModule } = useWorkspace();
  const { lock } = useLeadLock(workspace.id);
  if (hasModule("leads") && lock?.stuck) {
    return (
      <Card title="Leads are locked for now">
        <p className="text-sm text-slate-600">
          It's past {lockTimeLabel(lock.lock_time)} and you have {lock.overdue} overdue lead{lock.overdue === 1 ? "" : "s"}. Contact each one and set its next follow-up, or mark it Won or Lost, and your leads open again.
        </p>
        <Link to={`/w/${workspace.slug}/follow-ups`} className="mt-4 inline-flex rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">
          Open my overdue leads
        </Link>
      </Card>
    );
  }
  return <LeadsPage />;
}

function LeadsPage() {
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
  const [check, setCheck] = useState(""); // "<question key>\t<answer>", or "<key>\t" for unanswered
  const [panelId, setPanelId] = useState<string | null>(null);
  const questions = useLeadQuestions(workspace.id);
  const [editing, setEditing] = useState<Lead | "new" | null>(null);
  const [converting, setConverting] = useState<Lead | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<Stage | null>(null);
  // A move to Lost waits here until a reason is picked.
  const [losing, setLosing] = useState<{ lead: Lead; beforeId: string | null; quick: boolean } | null>(null);

  // Search text, settled 300 ms after typing, with the leads whose older remarks match.
  const [term, setTerm] = useState("");
  const [remarkHits, setRemarkHits] = useState<string[]>([]);
  useEffect(() => {
    const t0 = q.trim();
    let cancelled = false;
    const t = setTimeout(async () => {
      let hits: string[] = [];
      if (t0.length >= 3) {
        const { data } = await supabase
          .from("lead_activities")
          .select("lead_id")
          .eq("workspace_id", workspace.id)
          .in("kind", ["remark", "call", "whatsapp", "meeting"])
          .ilike("body", `%${t0.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
          .limit(100);
        hits = [...new Set((data ?? []).map((r) => r.lead_id))];
      }
      if (cancelled) return;
      setRemarkHits((prev) => (prev.join() === hits.join() ? prev : hits));
      setTerm(t0);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, workspace.id]);

  // Paging: the list loads one page at a time, the board a few cards per column.
  const [page, setPage] = useState(0);
  const [listTotal, setListTotal] = useState(0);
  const [boardLimit, setBoardLimit] = useState<Record<string, number>>({});
  const [stageCounts, setStageCounts] = useState<Record<string, number>>({});
  const [summary, setSummary] = useState({ open: 0, value: 0 });
  const [loadingMore, setLoadingMore] = useState<string | null>(null);

  useEffect(() => {
    setPage(0);
    setBoardLimit({});
  }, [term, remarkHits, stage, source, assignee, check, view]);

  // All leads matching the search and filters (stage is applied by the caller).
  const matching = useCallback(() => {
    const base = () => supabase.from("leads").select("*", { count: "exact" }).eq("workspace_id", workspace.id);
    const filter = (qb: ReturnType<typeof base>) => {
      if (source) qb = qb.eq("source", source);
      if (assignee === "none") qb = qb.is("assigned_to", null);
      else if (assignee) qb = qb.eq("assigned_to", assignee);
      if (check) {
        const [key, want] = check.split("\t");
        qb = want ? qb.eq(`answers->>${key}`, want) : qb.is(`answers->>${key}`, null);
      }
      const safe = term.replace(/[,()*%_\\:"']/g, " ").trim();
      if (safe) {
        const like = `%${safe}%`;
        const ors = ["name", "phone", "email", "company", "last_remark"].map((c) => `${c}.ilike.${like}`);
        if (remarkHits.length) ors.push(`id.in.(${remarkHits.join(",")})`);
        qb = qb.or(ors.join(","));
      }
      return qb;
    };
    return filter(base());
  }, [workspace.id, source, assignee, check, term, remarkHits]);

  const load = useCallback(async () => {

    let rows: Lead[] = [];
    if (view === "table") {
      let qb = matching();
      if (stage) qb = qb.eq("stage", stage);
      const { data, error, count } = await qb.order("created_at", { ascending: false }).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (error) setError(error.message);
      rows = data ?? [];
      setListTotal(count ?? 0);
    } else {
      const res = await Promise.all(
        STAGES.map((st) =>
          matching()
            .eq("stage", st.key)
            .order("position")
            .order("created_at", { ascending: false })
            .range(0, (boardLimit[st.key] ?? BOARD_STEP) - 1),
        ),
      );
      const err = res.find((r) => r.error)?.error;
      if (err) setError(err.message);
      rows = res.flatMap((r) => r.data ?? []);
      setStageCounts(Object.fromEntries(STAGES.map((st, i) => [st.key, res[i].count ?? 0])));
    }
    setLeads(rows);
    setLoadingMore(null);

    // Header numbers: every open lead, but only its value.
    const { data: open } = await supabase
      .from("leads")
      .select("value")
      .eq("workspace_id", workspace.id)
      .not("stage", "in", "(won,lost)")
      .not("value", "is", null);
    const { count: allOpen } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace.id)
      .not("stage", "in", "(won,lost)");
    setSummary({ open: allOpen ?? 0, value: (open ?? []).reduce((sum, l) => sum + Number(l.value ?? 0), 0) });

    // Only admins can read forms; staff just see answer keys.
    const { data: f } = await supabase.from("lead_forms").select("id, title, fields").eq("workspace_id", workspace.id);
    setForms(Object.fromEntries((f ?? []).map((x) => [x.id, { title: x.title, fields: parseFields(x.fields) }])));
  }, [workspace.id, view, page, boardLimit, stage, matching]);

  useEffect(() => {
    load();
  }, [load]);

  useLiveTable("leads", `workspace_id=eq.${workspace.id}`, load);

  // Opening a lead from a notification or search (?open=<lead id>), or a new one (?new=1).
  const openId = params.get("open");
  const wantsNew = params.get("new") === "1";
  useEffect(() => {
    if ((!openId && !wantsNew) || !leads) return;
    const l = openId ? leads.find((x) => x.id === openId) : null;
    if (l) {
      setPanelId(null);
      setEditing(l);
    }
    else if (wantsNew && canWrite) setEditing("new");
    setParams((p) => {
      p.delete("open");
      p.delete("new");
      return p;
    }, { replace: true });
  }, [openId, wantsNew, leads, canWrite, setParams]);

  function switchView(v: View) {
    setView(v);
    try {
      localStorage.setItem("leads-view", v);
    } catch {
      /* ignore */
    }
  }

  const filtered = leads ?? [];

  // Export: every lead matching the filters, not just the page on screen.
  const [exporting, setExporting] = useState(false);
  async function exportAll() {
    setExporting(true);
    const all: Lead[] = [];
    for (let from = 0; ; from += 1000) {
      let qb = matching();
      if (view === "table" && stage) qb = qb.eq("stage", stage);
      const { data, error } = await qb.order("created_at", { ascending: false }).range(from, from + 999);
      if (error) {
        setError(error.message);
        break;
      }
      all.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    setExporting(false);
    const rows = all;
    downloadCsv(
                "leads.csv",
                ["Name", "Company", "Phone", "Email", "Source", "Stage", "Lost reason", "Value", "Score", "Assigned to", ...questions.map((x) => x.label), "Next follow-up", "Last contact", "Last remark", "Added"],
                rows.map((l) => [l.name, l.company, l.phone, l.email, l.source, STAGE_LABEL[l.stage as Stage], l.lost_reason, l.value, l.score, nameOf(people, l.assigned_to),
                  ...questions.map((x) => parseAnswers(l.answers)[x.key] ?? ""),
                  l.follow_up_at ? new Date(l.follow_up_at).toLocaleString("en-IN") : "", l.last_contacted_at ? new Date(l.last_contacted_at).toLocaleString("en-IN") : "",
                  l.last_remark, l.created_at.slice(0, 10)]),
    );
  }

  const sourceOptions = useMemo(() => {
    const extra = (leads ?? []).map((l) => l.source).filter((s) => !SOURCES.includes(s));
    return [...SOURCES, ...new Set(extra)];
  }, [leads]);

  // Moves a lead to a stage, before another card (or to the end), and renumbers that column.
  async function move(id: string, to: Stage, beforeId: string | null, lostReason?: string) {
    if (!leads) return;
    const lead = leads.find((l) => l.id === id);
    if (!lead || id === beforeId) return;
    if (to === "lost" && lead.stage !== "lost" && !lostReason) return setLosing({ lead, beforeId, quick: false });
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
    if (lead.stage !== to) load(); // picks up the cleared follow-up, contact time, etc.
    setError("");
    const results = await Promise.all(
      changes.map(({ l, i }) =>
        supabase
          .from("leads")
          .update(l.id === id ? { stage: to, position: i, ...(lostReason ? { lost_reason: lostReason } : {}) } : { position: i })
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

  async function quickStage(lead: Lead, to: Stage, lostReason?: string) {
    if (to === "lost" && lead.stage !== "lost" && !lostReason) return setLosing({ lead, beforeId: null, quick: true });
    const top = Math.min(0, ...(leads ?? []).filter((l) => l.stage === to).map((l) => l.position)) - 1;
    setError("");
    const { data, error } = await supabase
      .from("leads")
      .update({ stage: to, position: top, ...(lostReason ? { lost_reason: lostReason } : {}) })
      .eq("workspace_id", workspace.id)
      .eq("id", lead.id)
      .select()
      .single();
    if (error) return setError(error.message);
    setLeads((ls) => (ls ?? []).map((l) => (l.id === lead.id ? data : l)));
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

  const draggable = canWrite;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Leads</h1>
          <p className="text-sm text-slate-500">
            {summary.open} open lead{summary.open === 1 ? "" : "s"} worth {inr(summary.value)}
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
          <Button variant="secondary" onClick={exportAll} disabled={exporting}>
            {exporting ? "Exporting…" : "Export"}
          </Button>
          {canWrite && isAdmin && (
            <Link to={`/w/${workspace.slug}/lead-import`} className="inline-flex items-center justify-center rounded-lg bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50">
              Import
            </Link>
          )}
          {canWrite && <Button onClick={() => setEditing("new")}>+ Add lead</Button>}
        </div>
      </div>

      {error && <Alert>{error}</Alert>}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Input type="search" placeholder="Search name, phone, company, remarks" value={q} onChange={(e) => setQ(e.target.value)} />
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
        {questions.length > 0 && (
          <Select value={check} onChange={(e) => setCheck(e.target.value)} aria-label="Quick check answer">
            <option value="">Any quick-check answer</option>
            {questions.map((x) => (
              <optgroup key={x.key} label={x.label}>
                {x.options.map((o) => <option key={o} value={`${x.key}\t${o}`}>{x.label} {o}</option>)}
                <option value={`${x.key}\t`}>{x.label} not answered</option>
              </optgroup>
            ))}
          </Select>
        )}
      </div>

      {view === "board" ? (
        <div className="-mx-4 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
          {canWrite && <p className="mb-2 text-xs text-slate-500">Drag a card to another column to change its stage. On a phone, tap a card to change it.</p>}
          <div className="flex gap-3">
            {STAGES.map((s) => {
              const cards = filtered.filter((l) => l.stage === s.key).sort(byPosition);
              const total = cards.reduce((sum, l) => sum + Number(l.value ?? 0), 0);
              const all = stageCounts[s.key] ?? cards.length;
              const more = all - cards.length;
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
                    <span className="text-sm font-semibold">{s.label} <span className="font-normal text-slate-500">{all}</span></span>
                    {total > 0 && more <= 0 && <span className="text-xs text-slate-500">{inr(total)}</span>}
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
                          {isOpen(l) && !l.first_contacted_at && <Badge tone="bg-rose-100 text-rose-700">Not contacted</Badge>}
                          {l.stage === "lost" && l.lost_reason && <Badge tone="bg-slate-100 text-slate-600">{l.lost_reason}</Badge>}
                        </div>
                        {l.last_remark && (
                          <p className="mt-2 line-clamp-2 break-words text-xs text-slate-600" title={l.last_remark}>
                            <span className="text-slate-400">{l.last_remark_at ? `${ago(l.last_remark_at)}: ` : ""}</span>
                            {l.last_remark}
                          </p>
                        )}
                        {(l.assigned_to || l.follow_up_at) && (
                          <div className="mt-2 flex justify-between gap-2 text-xs">
                            <span className="truncate text-slate-500">{nameOf(people, l.assigned_to)}</span>
                            {l.follow_up_at && <span className={`shrink-0 ${followUpTone(l.follow_up_at)}`}>{whenLabel(l.follow_up_at)}</span>}
                          </div>
                        )}
                        {l.last_contacted_at && isOpen(l) && (
                          <div className="mt-1 text-[11px] text-slate-400">Last contact {ago(l.last_contacted_at)}</div>
                        )}
                      </article>
                    ))}
                    {!cards.length && <p className="px-1 py-4 text-center text-xs text-slate-400">No leads</p>}
                    {more > 0 && (
                      <button
                        type="button"
                        disabled={loadingMore === s.key}
                        onClick={() => {
                          setLoadingMore(s.key);
                          setBoardLimit((b) => ({ ...b, [s.key]: (b[s.key] ?? BOARD_STEP) + BOARD_STEP }));
                        }}
                        className="rounded-md bg-white/70 px-3 py-2 text-xs font-semibold text-indigo-700 ring-1 ring-slate-200 hover:bg-white disabled:opacity-60"
                      >
                        {loadingMore === s.key ? "Loading…" : `View more (${more} more)`}
                      </button>
                    )}
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
              <table className="w-full min-w-[1100px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <th className="px-5 py-2 font-medium">Lead</th>
                    <th className="px-2 py-2 font-medium">Contact</th>
                    <th className="px-2 py-2 font-medium">Source</th>
                    <th className="px-2 py-2 font-medium">Stage</th>
                    {questions.map((x) => (
                      <th key={x.key} className="max-w-[110px] px-2 py-2 font-medium leading-tight">{x.label}</th>
                    ))}
                    <th className="px-2 py-2 text-right font-medium">Value</th>
                    <th className="px-2 py-2 font-medium">Assigned</th>
                    <th className="px-2 py-2 font-medium">Last remark</th>
                    <th className="px-5 py-2 font-medium">Next follow-up</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((l) => (
                    <tr key={l.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setPanelId(l.id)}>
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
                      {questions.map((x) => {
                        const a = parseAnswers(l.answers)[x.key];
                        return (
                          <td key={x.key} className="px-2 py-2">
                            {a ? (
                              <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${answerTone(a).chip}`}>{a}</span>
                            ) : (
                              <span className="text-xs text-slate-300">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-2 py-2 text-right">{l.value != null ? inr(l.value) : ""}</td>
                      <td className="px-2 py-2">{nameOf(people, l.assigned_to)}</td>
                      <td className="max-w-[220px] px-2 py-2 text-xs text-slate-600">
                        {l.last_remark && (
                          <>
                            <div className="truncate" title={l.last_remark}>{l.last_remark}</div>
                            {l.last_remark_at && <div className="text-slate-400">{ago(l.last_remark_at)}</div>}
                          </>
                        )}
                      </td>
                      <td className={`whitespace-nowrap px-5 py-2 text-xs ${followUpTone(l.follow_up_at)}`}>
                        {whenLabel(l.follow_up_at)}
                        {isOpen(l) && !l.first_contacted_at && <div className="text-rose-600">Not contacted</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>{term || stage || source || assignee || check ? "No leads match these filters." : "No leads yet. Add one, or share a lead form."}</Empty>
          )}
          {listTotal > PAGE_SIZE && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-sm">
              <span className="text-slate-500">
                Showing {page * PAGE_SIZE + 1}–{Math.min(listTotal, (page + 1) * PAGE_SIZE)} of {listTotal}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Previous</Button>
                <span className="text-slate-500">Page {page + 1} of {Math.ceil(listTotal / PAGE_SIZE)}</span>
                <Button variant="secondary" disabled={(page + 1) * PAGE_SIZE >= listTotal} onClick={() => setPage((p) => p + 1)}>Next →</Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {panelId && (
        <Drawer title="Follow up" onClose={() => setPanelId(null)}>
          <LeadPanel
            leadId={panelId}
            questions={questions}
            people={people}
            me={me}
            hasNext={false}
            onSaved={() => {
              setPanelId(null);
              load();
            }}
            onBack={() => setPanelId(null)}
          />
        </Drawer>
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

      {losing && (
        <LostReasonModal
          name={losing.lead.name}
          onCancel={() => setLosing(null)}
          onConfirm={(reason) => {
            const x = losing;
            setLosing(null);
            if (x.quick) quickStage(x.lead, "lost", reason);
            else move(x.lead.id, "lost", x.beforeId, reason);
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
