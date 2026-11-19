import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { useAuth } from "../../../lib/auth";
import { useWorkspace } from "../../../lib/workspace";
import { useLiveTable } from "../../../lib/realtime";
import { nameOf, useMembers } from "../../../lib/members";
import { Alert, Card, Empty, Input, Select, Spinner } from "../../../components/ui";
import { STAGE_LABEL, type Stage } from "./leadShared";
import { ago } from "./LeadTimeline";
import { followUpState, followUpTone, whenLabel } from "./followUp";
import { answerTone, parseAnswers, useLeadQuestions } from "./leadQuestions";
import type { Json } from "../../../lib/database.types";
import LeadPanel from "./LeadPanel";
import FollowUpResults, { wonAt, type StatActivity } from "./FollowUpResults";
import { lockTimeLabel, useLeadLock } from "./leadLock";

type Row = {
  id: string;
  name: string;
  company: string | null;
  phone: string | null;
  stage: string;
  source: string;
  assigned_to: string | null;
  follow_up_at: string | null;
  first_contacted_at: string | null;
  last_contacted_at: string | null;
  last_remark: string | null;
  last_remark_at: string | null;
  created_at: string;
  answers: Json;
  lost_reason: string | null;
};

const RANGES = [
  { days: 7, label: "Last 7 days", phrase: "last 7 days" },
  { days: 30, label: "Last 30 days", phrase: "last 30 days" },
  { days: 90, label: "Last 90 days", phrase: "last 90 days" },
];
const DAY = 24 * 3600 * 1000;

type Tab = "overdue" | "today" | "upcoming" | "uncontacted" | "none";
const TABS: { key: Tab; label: string; hint: string; tone: string }[] = [
  { key: "overdue", label: "Overdue", hint: "Follow-up time has passed.", tone: "bg-red-100 text-red-700" },
  { key: "today", label: "Today", hint: "Due later today.", tone: "bg-amber-100 text-amber-800" },
  { key: "upcoming", label: "Next 7 days", hint: "Coming up this week.", tone: "bg-sky-100 text-sky-800" },
  { key: "uncontacted", label: "Not contacted yet", hint: "New leads nobody has called or messaged. Oldest first.", tone: "bg-rose-100 text-rose-700" },
  { key: "none", label: "No follow-up set", hint: "Open leads with nothing scheduled.", tone: "bg-slate-200 text-slate-700" },
];

// The time now in India, as "HH:MM".
function istNow() {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
}

function tabOf(r: Row): Tab[] {
  const out: Tab[] = [];
  if (!r.first_contacted_at) out.push("uncontacted");
  const s = followUpState(r.follow_up_at);
  if (s === "overdue" || s === "today" || s === "upcoming") out.push(s);
  if (!r.follow_up_at && r.first_contacted_at) out.push("none");
  return out;
}

export default function FollowUps() {
  const { workspace, isAdmin, canWrite, hasModule } = useWorkspace();
  const { session } = useAuth();
  const me = session?.user.id ?? "";
  const people = useMembers(workspace.id);
  const questions = useLeadQuestions(workspace.id);
  const [allRows, setAllRows] = useState<Row[] | null>(null);
  const rows = useMemo(() => allRows?.filter((r) => r.stage !== "won" && r.stage !== "lost") ?? null, [allRows]);
  const [activities, setActivities] = useState<StatActivity[]>([]);
  const [view, setView] = useState<"desk" | "results">("desk");
  const [days, setDays] = useState(30);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("overdue");
  const [who, setWho] = useState("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [panelKey, setPanelKey] = useState(0);
  const [toast, setToast] = useState("");
  const [, tick] = useState(0);
  // Your place in the automatic lead rotation (null = not in it).
  const [away, setAwayState] = useState<boolean | null>(null);
  // Stuck lock: while stuck, only the overdue list is shown.
  const { lock, refresh: refreshLock } = useLeadLock(workspace.id);
  const stuck = !!lock?.stuck;
  const [wasStuck, setWasStuck] = useState(false);
  useEffect(() => {
    if (!stuck) return;
    setWasStuck(true);
    setView("desk");
    setTab("overdue");
    setQ("");
  }, [stuck]);

  useEffect(() => {
    if (!me) return;
    supabase
      .from("lead_assignment_members")
      .select("is_away, in_rotation")
      .eq("workspace_id", workspace.id)
      .eq("user_id", me)
      .then(({ data }) => {
        const rows = (data ?? []).filter((r) => r.in_rotation);
        setAwayState(rows.length ? rows.some((r) => r.is_away) : null);
      });
  }, [workspace.id, me]);

  async function toggleAway(next: boolean) {
    setError("");
    const { error } = await supabase.rpc("set_my_lead_away", { p_workspace_id: workspace.id, p_away: next });
    if (error) return setError(error.message);
    setAwayState(next);
  }

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("leads")
      .select("id, name, company, phone, stage, source, assigned_to, follow_up_at, first_contacted_at, last_contacted_at, last_remark, last_remark_at, created_at, answers, lost_reason")
      .eq("workspace_id", workspace.id)
      .limit(5000);
    if (error) setError(error.message);
    setAllRows(data ?? []);
  }, [workspace.id]);

  // Stage changes and logged contacts for this period and the one before (for "vs before").
  const loadActivities = useCallback(async () => {
    const { data } = await supabase
      .from("lead_activities")
      .select("lead_id, kind, details, created_by, created_at")
      .eq("workspace_id", workspace.id)
      .in("kind", ["stage", "call", "whatsapp", "meeting"])
      .gte("created_at", new Date(Date.now() - 2 * days * DAY).toISOString())
      .order("created_at")
      .limit(10000);
    setActivities(data ?? []);
  }, [workspace.id, days]);
  useEffect(() => {
    loadActivities();
  }, [loadActivities]);

  useEffect(() => {
    load();
  }, [load]);
  useLiveTable("leads", `workspace_id=eq.${workspace.id}`, load);

  // Re-sort into Overdue as times pass.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const mine = useMemo(
    () => (rows ?? []).filter((r) => (who === "" ? true : who === "none" ? !r.assigned_to : r.assigned_to === who)),
    [rows, who],
  );
  const mineAll = useMemo(
    () => (allRows ?? []).filter((r) => (who === "" ? true : who === "none" ? !r.assigned_to : r.assigned_to === who)),
    [allRows, who],
  );
  // Leads won in this period and the one before.
  const won = useMemo(() => {
    const since = Date.now() - days * DAY;
    let now = 0;
    let before = 0;
    for (const r of mineAll) {
      const w = wonAt(r, activities);
      if (!w) continue;
      const t = new Date(w).getTime();
      if (t >= since) now++;
      else if (t >= since - days * DAY) before++;
    }
    return { now, before };
  }, [mineAll, activities, days]);
  const groups = useMemo(() => {
    const g: Record<Tab, Row[]> = { overdue: [], today: [], upcoming: [], uncontacted: [], none: [] };
    for (const r of mine) for (const t of tabOf(r)) g[t].push(r);
    const at = (r: Row) => (r.follow_up_at ? new Date(r.follow_up_at).getTime() : 0);
    g.overdue.sort((a, b) => at(a) - at(b));
    g.today.sort((a, b) => at(a) - at(b));
    g.upcoming.sort((a, b) => at(a) - at(b));
    g.uncontacted.sort((a, b) => a.created_at.localeCompare(b.created_at));
    g.none.sort((a, b) => (a.last_contacted_at ?? "").localeCompare(b.last_contacted_at ?? ""));
    return g;
  }, [mine]);



  // While stuck: the leads that wait until the overdue ones are cleared.
  const waiting = useMemo(() => (stuck ? mine.filter((r) => followUpState(r.follow_up_at) !== "overdue") : []), [stuck, mine]);

  // The list shown on the left: the tab, or search across all open leads.
  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return groups[tab];
    const digits = term.replace(/\D/g, "");
    return mine.filter(
      (r) => r.name.toLowerCase().includes(term) || (r.company ?? "").toLowerCase().includes(term) || (digits.length >= 3 && (r.phone ?? "").replace(/\D/g, "").includes(digits)),
    );
  }, [groups, tab, q, mine]);

  // Keep a lead open on wide screens: the first one in the list.
  useEffect(() => {
    if (!rows) return;
    // A lead that just moved to another list (for example after a call) stays open
    // until it's saved; switching lists picks the first lead of the new list.
    if (selected && (list.some((r) => r.id === selected) || mobileOpen || (!q && rows.some((r) => r.id === selected)))) return;
    setSelected(list[0]?.id ?? null);
  }, [list, rows, selected, mobileOpen]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  function openLead(id: string) {
    setSelected(id);
    setMobileOpen(true);
    setPanelKey((k) => k + 1);
    if (window.innerWidth < 1024) window.scrollTo({ top: 0 });
  }

  function afterSave(savedId: string) {
    const name = rows?.find((r) => r.id === savedId)?.name.split(" ")[0] ?? "Lead";
    const i = list.findIndex((r) => r.id === savedId);
    const next = list.slice(i + 1).find((r) => r.id !== savedId) ?? list.find((r) => r.id !== savedId);
    setPanelKey((k) => k + 1);
    if (next) {
      setSelected(next.id);
      setToast(`Saved ${name}. Opened the next lead.`);
    } else {
      setToast(`Saved ${name}.`);
    }
    load();
    loadActivities();
    refreshLock();
  }

  if (!hasModule("leads")) {
    return (
      <Card title="Follow-ups">
        <p className="text-sm text-slate-500">Leads are not part of your current plan.</p>
      </Card>
    );
  }
  if (!rows) return <Spinner />;

  const info = TABS.find((t) => t.key === tab)!;
  const listQuestions = questions.filter((x) => x.show_in_list);
  const currentIndex = list.findIndex((r) => r.id === selected);
  const hasNext = list.some((r, i) => r.id !== selected && (currentIndex < 0 || i !== currentIndex));

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Follow-ups</h1>
          <p className="text-sm text-slate-500">
            {groups.overdue.length} overdue, {groups.today.length} due today
            {!isAdmin && " · your leads"}
          </p>
        </div>
        {!stuck && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg bg-white p-0.5 ring-1 ring-slate-200" role="group" aria-label="View">
            {(["desk", "results"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${view === v ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
              >
                {v === "desk" ? "Follow up" : "Results"}
              </button>
            ))}
          </div>
          <Select className="!w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
            {RANGES.map((r) => <option key={r.days} value={r.days}>{r.label}</option>)}
          </Select>
          {away !== null && canWrite && (
            <label
              className={`inline-flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ring-1 ${away ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-green-50 text-green-800 ring-green-200"}`}
              title="When you're away, new leads skip you and go to the next person."
            >
              <input type="checkbox" checked={!away} onChange={(e) => toggleAway(!e.target.checked)} />
              {away ? "Away: not getting new leads" : "Getting new leads"}
            </label>
          )}
          {isAdmin && (
            <Select className="!w-auto" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Whose follow-ups">
              <option value="">Everyone</option>
              <option value={me}>Mine</option>
              <option value="none">Nobody assigned</option>
              {people.filter((p) => p.is_active && p.user_id !== me).map((p) => (
                <option key={p.user_id} value={p.user_id}>{p.full_name}</option>
              ))}
            </Select>
          )}
        </div>
        )}
      </div>

      {error && <Alert>{error}</Alert>}

      {stuck && lock ? (
        <div role="alert" className="rounded-xl bg-red-600 px-5 py-4 text-white shadow-sm">
          <div className="text-base font-semibold">
            Leads locked: {lock.overdue} overdue lead{lock.overdue === 1 ? "" : "s"} to clear
          </div>
          <p className="mt-1 text-sm text-red-50">
            After {lockTimeLabel(lock.lock_time)} you can only work on your overdue leads. For each one, Call or WhatsApp first and then set the next follow-up, or mark it Won or Lost.
            New leads still come to you, but you can't contact them until the last overdue one is done.
          </p>
        </div>
      ) : wasStuck ? (
        <Alert tone="success">All overdue leads are cleared. You have full access again.</Alert>
      ) : lock?.enabled && !isAdmin && !lock.unlocked_today && lock.overdue > 0 && istNow() < lock.lock_time ? (
        <Alert tone="warning">
          Leads lock at {lockTimeLabel(lock.lock_time)}. You have {lock.overdue} overdue lead{lock.overdue === 1 ? "" : "s"}. Contact {lock.overdue === 1 ? "it" : "them"} before then to keep full access.
        </Alert>
      ) : null}

      {!stuck && (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { key: "overdue" as const, label: "Overdue", value: groups.overdue.length, hint: "Follow-up time has passed", tone: groups.overdue.length ? "text-red-600" : "text-slate-900" },
          { key: "today" as const, label: "Due today", value: groups.today.length, hint: "Still to do today", tone: "text-slate-900" },
          { key: "uncontacted" as const, label: "New, not called yet", value: groups.uncontacted.length, hint: "Call these first", tone: groups.uncontacted.length ? "text-rose-600" : "text-slate-900" },
          {
            key: "won" as const,
            label: "Won",
            value: won.now,
            hint: won.before || won.now ? `${won.before} in the ${RANGES.find((r) => r.days === days)!.phrase.replace("last", "previous")}` : `In the ${RANGES.find((r) => r.days === days)!.phrase}`,
            tone: "text-green-700",
          },
        ].map((t) => {
          const active = t.key === "won" ? view === "results" : view === "desk" && !q && tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              aria-pressed={active}
              onClick={() => {
                if (t.key === "won") return setView("results");
                setView("desk");
                setTab(t.key);
                setQ("");
                setSelected(null);
                setMobileOpen(false);
              }}
              className={`rounded-xl bg-white p-4 text-left shadow-sm ring-1 transition hover:ring-slate-300 ${active ? "ring-2 ring-indigo-500" : "ring-slate-200"}`}
            >
              <div className="text-sm font-medium text-slate-500">{t.label}</div>
              <div className={`mt-1 text-2xl font-bold tabular-nums ${t.tone}`}>{t.value}</div>
              <div className="mt-0.5 text-xs text-slate-500">{t.hint}</div>
            </button>
          );
        })}
      </div>
      )}

      {view === "results" ? (
        <FollowUpResults
          leads={mineAll}
          allLeads={allRows ?? []}
          activities={activities}
          since={Date.now() - days * DAY}
          rangeLabel={RANGES.find((r) => r.days === days)!.phrase}
          people={people}
          showTeam={isAdmin && who === ""}
        />
      ) : (
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div className={`min-w-0 rounded-xl bg-white shadow-sm ring-1 ring-slate-200 lg:sticky lg:top-4 ${mobileOpen ? "hidden lg:block" : ""}`}>
          {!stuck && (
          <div className="flex flex-wrap gap-1 border-b border-slate-100 p-2" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={!q && tab === t.key}
                onClick={() => {
                  setTab(t.key);
                  setQ("");
                  setSelected(null);
                }}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ${!q && tab === t.key ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-50"}`}
              >
                {t.label}
                <span className={`rounded-full px-1.5 text-[11px] font-semibold ${!q && tab === t.key ? "bg-indigo-600 text-white" : t.tone}`}>{groups[t.key].length}</span>
              </button>
            ))}
          </div>
          )}
          <div className="space-y-2 p-2">
            {stuck ? <p className="px-1 pt-1 text-sm font-semibold text-red-700">Your overdue leads</p> : <Input type="search" placeholder="Search name or phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search open leads" />}
            <p className="px-1 text-xs text-slate-500">{q ? `${list.length} open lead${list.length === 1 ? "" : "s"} found` : info.hint}</p>
          </div>
          <div className="max-h-[70vh] space-y-1.5 overflow-y-auto px-2 pb-2">
            {list.length ? (
              list.map((r) => {
                const ans = parseAnswers(r.answers);
                const current = r.id === selected;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => openLead(r.id)}
                    aria-current={current}
                    className={`block w-full rounded-lg px-3 py-2.5 text-left ring-1 transition ${current ? "bg-indigo-50 ring-indigo-400" : "bg-white ring-slate-200 hover:ring-slate-300"}`}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0 truncate font-medium text-slate-900">{r.name}</span>
                      <span className="flex shrink-0 gap-1">
                        {listQuestions.map((lq) =>
                          ans[lq.key] ? (
                            <span key={lq.key} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${answerTone(ans[lq.key]).chip}`}>{ans[lq.key]}</span>
                          ) : null,
                        )}
                      </span>
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500">
                      {!r.first_contacted_at && !r.follow_up_at ? (
                        <span className="font-medium text-rose-600">New · added {ago(r.created_at)}</span>
                      ) : r.follow_up_at ? (
                        <span className={`font-medium ${followUpTone(r.follow_up_at)}`}>
                          {followUpState(r.follow_up_at) === "overdue" ? "Overdue · " : ""}
                          {whenLabel(r.follow_up_at)}
                        </span>
                      ) : (
                        <span>No follow-up set</span>
                      )}
                      <span>· {STAGE_LABEL[r.stage as Stage] ?? r.stage}</span>
                      {isAdmin && who === "" && <span>· {nameOf(people, r.assigned_to) || "Nobody"}</span>}
                    </span>
                  </button>
                );
              })
            ) : (
              <Empty>{q ? "No open leads match." : tab === "overdue" ? "Nothing overdue. Nice work." : "Nothing here."}</Empty>
            )}
            {stuck && waiting.length > 0 && (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <p className="px-1 text-xs font-semibold text-slate-500">
                  {waiting.length} more lead{waiting.length === 1 ? "" : "s"} waiting. They open once your overdue leads are cleared.
                </p>
                <ul className="mt-1.5 space-y-1">
                  {waiting.slice(0, 20).map((r) => (
                    <li key={r.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-400" aria-disabled="true">
                      <span className="truncate">{r.name}</span>
                      <span className="shrink-0 text-xs">{!r.first_contacted_at ? "New" : "Locked"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        <div className={`min-w-0 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200 ${mobileOpen ? "" : "hidden lg:block"}`}>
          {selected ? (
            <LeadPanel
              key={`${selected}:${panelKey}`}
              leadId={selected}
              questions={questions}
              people={people}
              me={me}
              hasNext={hasNext}
              onSaved={afterSave}
              onBack={() => setMobileOpen(false)}
            />
          ) : (
            <Empty>Pick a lead from the list.</Empty>
          )}
        </div>
      </div>
      )}

      {toast && (
        <div role="status" className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      )}
    </>
  );
}
