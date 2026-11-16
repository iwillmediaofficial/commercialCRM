import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { supabase } from "../../../lib/supabase";
import { useAuth } from "../../../lib/auth";
import { useWorkspace } from "../../../lib/workspace";
import { useLiveTable } from "../../../lib/realtime";
import { nameOf, useMembers } from "../../../lib/members";
import { Alert, Badge, Card, Empty, Select, Spinner } from "../../../components/ui";
import { STAGE_LABEL, STAGE_TONE, type Stage } from "./leadShared";
import { ago } from "./LeadTimeline";
import { QUICK_PICKS, followUpState, followUpTone, telLink, waLink, whenLabel } from "./followUp";

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
};

type Tab = "overdue" | "today" | "upcoming" | "uncontacted" | "none";
const TABS: { key: Tab; label: string; hint: string; tone: string }[] = [
  { key: "overdue", label: "Overdue", hint: "Follow-up time has passed.", tone: "bg-red-100 text-red-700" },
  { key: "today", label: "Today", hint: "Due later today.", tone: "bg-amber-100 text-amber-800" },
  { key: "upcoming", label: "Next 7 days", hint: "Coming up this week.", tone: "bg-sky-100 text-sky-800" },
  { key: "uncontacted", label: "Not contacted yet", hint: "New leads nobody has called or messaged. Oldest first.", tone: "bg-rose-100 text-rose-700" },
  { key: "none", label: "No follow-up set", hint: "Open leads with nothing scheduled.", tone: "bg-slate-200 text-slate-700" },
];

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
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("overdue");
  const [who, setWho] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("leads")
      .select("id, name, company, phone, stage, source, assigned_to, follow_up_at, first_contacted_at, last_contacted_at, last_remark, last_remark_at, created_at")
      .eq("workspace_id", workspace.id)
      .not("stage", "in", "(won,lost)");
    if (error) setError(error.message);
    setRows(data ?? []);
  }, [workspace.id]);

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

  async function snooze(r: Row, at: string) {
    setError("");
    setBusyId(r.id);
    const { error } = await supabase.from("leads").update({ follow_up_at: at }).eq("workspace_id", workspace.id).eq("id", r.id);
    setBusyId(null);
    if (error) return setError(error.message);
    setRows((xs) => (xs ?? []).map((x) => (x.id === r.id ? { ...x, follow_up_at: at } : x)));
  }

  if (!hasModule("leads")) {
    return (
      <Card title="Follow-ups">
        <p className="text-sm text-slate-500">Leads are not part of your current plan.</p>
      </Card>
    );
  }
  if (!rows) return <Spinner />;

  const list = groups[tab];
  const info = TABS.find((t) => t.key === tab)!;
  const leadLink = (id: string) => `/w/${workspace.slug}/leads?open=${id}`;

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

      {error && <Alert>{error}</Alert>}

      <div className="flex flex-wrap gap-2" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ring-1 ${tab === t.key ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"}`}
          >
            {t.label}
            <span className={`rounded-full px-1.5 text-xs ${tab === t.key ? "bg-white/20 text-white" : t.tone}`}>{groups[t.key].length}</span>
          </button>
        ))}
      </div>

      <Card>
        <p className="mb-3 text-xs text-slate-500">{info.hint}</p>
        {list.length ? (
          <ul className="-mx-5 divide-y divide-slate-100">
            {list.map((r) => {
              const tel = telLink(r.phone);
              const wa = waLink(r.phone);
              return (
                <li key={r.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-3">
                  <div className="min-w-[180px] flex-1">
                    <Link to={leadLink(r.id)} className="font-medium text-slate-900 hover:text-indigo-700 hover:underline">{r.name}</Link>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      {r.company && <span>{r.company}</span>}
                      <Badge tone={STAGE_TONE[r.stage as Stage]}>{STAGE_LABEL[r.stage as Stage] ?? r.stage}</Badge>
                      {isAdmin && <span>{nameOf(people, r.assigned_to) || "Nobody assigned"}</span>}
                    </div>
                    {r.last_remark && (
                      <p className="mt-1 line-clamp-2 break-words text-xs text-slate-600">
                        <span className="text-slate-400">{r.last_remark_at ? `${ago(r.last_remark_at)}: ` : ""}</span>
                        {r.last_remark}
                      </p>
                    )}
                  </div>
                  <div className="w-40 text-sm">
                    {tab === "uncontacted" ? (
                      <span className="text-rose-600">Added {ago(r.created_at)}</span>
                    ) : r.follow_up_at ? (
                      <span className={followUpTone(r.follow_up_at)}>{whenLabel(r.follow_up_at)}</span>
                    ) : (
                      <span className="text-slate-400">
                        {r.last_contacted_at ? `Last contact ${ago(r.last_contacted_at)}` : "No follow-up"}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {tel && <a href={tel} className="rounded-md bg-sky-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-sky-700">Call</a>}
                    {wa && <a href={wa} target="_blank" rel="noreferrer" className="rounded-md bg-green-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-green-700">WhatsApp</a>}
                    <Link to={leadLink(r.id)} className="rounded-md bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
                      Log &amp; open
                    </Link>
                    {canWrite && (
                      <select
                        aria-label={`Snooze ${r.name}`}
                        className="rounded-md border-0 bg-white py-1 pl-2 pr-7 text-xs font-semibold text-slate-700 ring-1 ring-slate-200"
                        value=""
                        disabled={busyId === r.id}
                        onChange={(e) => {
                          const q = QUICK_PICKS.find((x) => x.key === e.target.value);
                          if (q) snooze(r, q.at());
                        }}
                      >
                        <option value="">{r.follow_up_at ? "Snooze…" : "Set follow-up…"}</option>
                        {QUICK_PICKS.map((q) => <option key={q.key} value={q.key}>{q.label}</option>)}
                      </select>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>{tab === "overdue" ? "Nothing overdue. Nice work." : "Nothing here."}</Empty>
        )}
      </Card>
    </>
  );
}
