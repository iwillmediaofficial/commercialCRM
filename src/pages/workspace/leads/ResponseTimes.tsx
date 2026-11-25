import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { supabase } from "../../../lib/supabase";
import { useWorkspace } from "../../../lib/workspace";
import { nameOf, useMembers } from "../../../lib/members";
import { Alert, Card, Empty, Select, Spinner } from "../../../components/ui";

// How fast leads get their first contact, and whether follow-ups happen on time.
// Times count working hours only (9 AM to 8 PM India time, every day): the same
// clock the pass-on timer uses, so a lead that arrives at night isn't counted
// as hours late.

type LeadRow = {
  id: string;
  name: string;
  created_at: string;
  assigned_to: string | null;
  first_contacted_at: string | null;
  follow_up_at: string | null;
  stage: string;
};
type Act = { lead_id: string; kind: string; details: unknown; created_by: string | null; created_at: string };

const DAY = 86_400_000;
const IST = 330 * 60_000;
const OPEN_H = 9;
const CLOSE_H = 20;
const PAGE = 1000;
const MAX_PAGES = 30;
const CONTACT_KINDS = new Set(["call", "whatsapp", "meeting"]);
const MANUAL_KINDS = new Set(["remark", "call", "whatsapp", "meeting"]);
const GRACE_MS = 3600_000; // a follow-up done within an hour of its time is on time

const RANGES: [number, string][] = [
  [7, "Last 7 days"],
  [30, "Last 30 days"],
  [90, "Last 90 days"],
];

// Minutes between two moments, counting only 9 AM to 8 PM India time.
export function workMinutes(fromMs: number, toMs: number) {
  if (!(toMs > fromMs)) return 0;
  let total = 0;
  let dayStart = Math.floor((fromMs + IST) / DAY) * DAY - IST; // India midnight
  while (dayStart < toMs) {
    const s = Math.max(fromMs, dayStart + OPEN_H * 3600_000);
    const e = Math.min(toMs, dayStart + CLOSE_H * 3600_000);
    if (e > s) total += e - s;
    dayStart += DAY;
  }
  return total / 60_000;
}

export function duration(min: number | null) {
  if (min == null) return "–";
  if (min < 1) return "under 1 min";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function pct(n: number, d: number) {
  return d ? `${Math.round((n / d) * 100)}%` : "–";
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown) {
  return typeof v === "string" && v ? v : null;
}
const ms = (iso: string) => new Date(iso).getTime();

// Older follow-ups hold only a date: they were due at 10 AM that day.
function dueAt(v: unknown) {
  const s = str(v);
  if (!s) return null;
  const t = s.length === 10 ? Date.parse(`${s}T10:00:00+05:30`) : Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const { data, error } = await page(i * PAGE, i * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return { rows: out, cut: false };
  }
  return { rows: out, cut: true };
}

type PersonStats = {
  first: number[]; // response minutes, one per lead they first contacted
  waiting: number;
  passedOn: number;
  fuOnTime: number;
  fuLate: number;
  fuMissed: number;
  overdue: number;
};
const blank = (): PersonStats => ({ first: [], waiting: 0, passedOn: 0, fuOnTime: 0, fuLate: 0, fuMissed: 0, overdue: 0 });

export default function ResponseTimes() {
  const { workspace, isAdmin, role, hasModule } = useWorkspace();
  const people = useMembers(workspace.id);
  const [days, setDays] = useState(30);
  const [data, setData] = useState<{ leads: LeadRow[]; acts: Act[]; cut: boolean; at: number } | null>(null);
  const [error, setError] = useState("");
  const allowed = hasModule("leads") && (isAdmin || role === null);

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    setData(null);
    setError("");
    (async () => {
      const now = Date.now();
      // Follow-ups due in the range may have been set up to a month before it.
      const actsSince = new Date(now - (days + 30) * DAY).toISOString();
      try {
        const [l, a] = await Promise.all([
          fetchAll<LeadRow>((f, t) =>
            supabase
              .from("leads")
              .select("id, name, created_at, assigned_to, first_contacted_at, follow_up_at, stage")
              .eq("workspace_id", workspace.id)
              .order("created_at")
              .order("id")
              .range(f, t),
          ),
          fetchAll<Act>((f, t) =>
            supabase
              .from("lead_activities")
              .select("lead_id, kind, details, created_by, created_at")
              .eq("workspace_id", workspace.id)
              .gte("created_at", actsSince)
              .order("created_at")
              .order("id")
              .range(f, t),
          ),
        ]);
        if (!cancelled) setData({ leads: l.rows, acts: a.rows, cut: l.cut || a.cut, at: now });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspace.id, days, allowed]);

  const report = useMemo(() => {
    if (!data) return null;
    const now = data.at;
    const since = now - days * DAY;
    const byLead = new Map<string, Act[]>();
    for (const a of data.acts) {
      const xs = byLead.get(a.lead_id);
      if (xs) xs.push(a);
      else byLead.set(a.lead_id, [a]);
    }
    const stats = new Map<string, PersonStats>(); // "" = nobody assigned
    const of = (id: string | null) => {
      const k = id ?? "";
      let s = stats.get(k);
      if (!s) stats.set(k, (s = blank()));
      return s;
    };

    // Who had the lead at a given moment.
    function assigneeAt(lead: LeadRow, acts: Act[], t: number): string | null {
      let before: Act | undefined;
      let after: Act | undefined;
      for (const a of acts) {
        if (a.kind !== "assigned") continue;
        if (ms(a.created_at) <= t) before = a;
        else if (!after) after = a;
      }
      if (before) return str(obj(before.details).to);
      if (after) return str(obj(after.details).from);
      const created = acts.find((a) => a.kind === "created");
      if (created && "assigned_to" in obj(created.details)) return str(obj(created.details).assigned_to);
      return lead.assigned_to;
    }

    let total = 0;
    let contacted = 0;
    let addedContacted = 0;
    const waits: number[] = [];
    let within1h = 0;
    const stillWaiting: { lead: LeadRow; min: number }[] = [];

    for (const lead of data.leads) {
      const acts = byLead.get(lead.id) ?? [];
      // Overdue follow-ups right now, by whoever has the lead.
      if (lead.follow_up_at && ms(lead.follow_up_at) < now && lead.stage !== "won" && lead.stage !== "lost") of(lead.assigned_to).overdue++;

      const created = ms(lead.created_at);
      if (created < since) continue;
      const first = acts.find((a) => CONTACT_KINDS.has(a.kind));
      const contactAt = first ? ms(first.created_at) : lead.first_contacted_at ? ms(lead.first_contacted_at) : null;
      if (contactAt == null) {
        if (lead.stage === "won" || lead.stage === "lost") continue; // closed without a logged contact
        total++;
        const owner = lead.assigned_to;
        const got = [...acts].reverse().find((a) => a.kind === "assigned" && str(obj(a.details).to) === owner);
        const min = workMinutes(got ? ms(got.created_at) : created, now);
        of(owner).waiting++;
        stillWaiting.push({ lead, min });
        continue;
      }
      // Added by hand as already contacted: not a response to measure.
      if (!first && contactAt - created < 60_000) {
        addedContacted++;
        continue;
      }
      total++;
      contacted++;
      const wait = workMinutes(created, contactAt);
      waits.push(wait);
      if (wait <= 60) within1h++;
      const responder = first?.created_by ?? assigneeAt(lead, acts, contactAt);
      // Their clock starts when the lead reached them.
      let start = created;
      for (const a of acts) {
        if (ms(a.created_at) > contactAt) break;
        if (a.kind === "assigned" && str(obj(a.details).to) === responder) start = ms(a.created_at);
      }
      of(responder).first.push(workMinutes(start, contactAt));
    }

    let passedOn = 0;
    for (const a of data.acts) {
      const d = obj(a.details);
      if (a.kind === "assigned" && d.reason === "not_contacted" && ms(a.created_at) >= since) {
        passedOn++;
        of(str(d.from)).passedOn++;
      }
    }

    // Follow-ups that fell due in the range (and at least an hour ago).
    let fuDue = 0;
    let fuOnTime = 0;
    const leadById = new Map(data.leads.map((l) => [l.id, l]));
    for (const [leadId, acts] of byLead) {
      const lead = leadById.get(leadId);
      if (!lead) continue;
      acts.forEach((f, i) => {
        if (f.kind !== "follow_up") return;
        const due = dueAt(obj(f.details).to);
        if (due == null || due < since || due > now - GRACE_MS) return;
        const setAt = ms(f.created_at);
        const rest = acts.slice(i + 1);
        const change = rest.find((a) => a.kind === "follow_up" || (a.kind === "stage" && (obj(a.details).to === "won" || obj(a.details).to === "lost")));
        const changeAt = change ? ms(change.created_at) : null;
        if (changeAt != null && changeAt < due) return; // moved before it was due
        const done = rest.find((a) => MANUAL_KINDS.has(a.kind) && ms(a.created_at) > setAt);
        const doneAt = done ? ms(done.created_at) : null;
        const s = of(assigneeAt(lead, acts, due));
        fuDue++;
        if (doneAt != null && doneAt <= due + GRACE_MS) {
          s.fuOnTime++;
          fuOnTime++;
        } else if (doneAt != null && (changeAt == null || doneAt <= changeAt)) s.fuLate++;
        else s.fuMissed++;
      });
    }

    stillWaiting.sort((a, b) => b.min - a.min);
    return { total, contacted, addedContacted, waits, within1h, passedOn, fuDue, fuOnTime, stats, stillWaiting };
  }, [data, days]);

  if (!allowed) {
    return (
      <Card title="Response times">
        <p className="text-sm text-slate-500">
          {hasModule("leads") ? "Only owners and admins can see response times." : "Leads are not part of your current plan."}
        </p>
      </Card>
    );
  }

  const leadLink = (id: string) => `/w/${workspace.slug}/leads?open=${id}`;
  const rows = report
    ? [...report.stats.entries()]
        .map(([id, s]) => ({ id, name: id ? nameOf(people, id) || "A former member" : "Nobody assigned", s }))
        .sort((a, b) => (a.id === "" ? 1 : b.id === "" ? -1 : a.name.localeCompare(b.name)))
    : [];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Response times</h1>
          <p className="text-sm text-slate-500">
            How quickly new leads get their first call or message, and whether follow-ups happen on time. Times count working hours only (9 AM to 8 PM).
          </p>
        </div>
        <Select className="!w-auto" value={String(days)} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
          {RANGES.map(([d, l]) => <option key={d} value={d}>{l}</option>)}
        </Select>
      </div>

      {error && <Alert>{error}</Alert>}
      {data?.cut && <Alert tone="warning">There is a lot of data, so only part of it was read. Pick a shorter period for exact numbers.</Alert>}

      {!report ? (
        !error && <Spinner />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Stat label="New leads" value={String(report.total)} sub={report.addedContacted ? `plus ${report.addedContacted} added already contacted` : undefined} />
            <Stat label="Contacted" value={pct(report.contacted, report.total)} sub={`${report.contacted} of ${report.total}`} />
            <Stat label="Typical time to first contact" value={duration(median(report.waits))} sub="Half of leads were contacted faster than this" />
            <Stat label="Contacted within 1 hour" value={pct(report.within1h, report.contacted)} sub={`${report.within1h} leads`} />
            <Stat label="Follow-ups done on time" value={pct(report.fuOnTime, report.fuDue)} sub={`${report.fuOnTime} of ${report.fuDue} due`} />
            <Stat label="Passed on (not contacted in time)" value={String(report.passedOn)} />
          </div>

          <Card title="By person">
            {rows.length ? (
              <div className="-mx-5 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs font-medium text-slate-500">
                      <th className="px-5 py-2">Person</th>
                      <th className="px-3 py-2 text-right">First contacts</th>
                      <th className="px-3 py-2 text-right">Typical response</th>
                      <th className="px-3 py-2 text-right">Within 15 min</th>
                      <th className="px-3 py-2 text-right">Within 1 h</th>
                      <th className="px-3 py-2 text-right">Not contacted yet</th>
                      <th className="px-3 py-2 text-right">Passed on</th>
                      <th className="px-3 py-2 text-right">Follow-ups on time</th>
                      <th className="px-3 py-2 text-right">Late</th>
                      <th className="px-3 py-2 text-right">Missed</th>
                      <th className="px-5 py-2 text-right">Overdue now</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map(({ id, name, s }) => {
                      const due = s.fuOnTime + s.fuLate + s.fuMissed;
                      return (
                        <tr key={id || "none"}>
                          <td className="px-5 py-2 font-medium text-slate-800">{name}</td>
                          <td className="px-3 py-2 text-right">{s.first.length}</td>
                          <td className="px-3 py-2 text-right">{duration(median(s.first))}</td>
                          <td className="px-3 py-2 text-right">{pct(s.first.filter((m) => m <= 15).length, s.first.length)}</td>
                          <td className="px-3 py-2 text-right">{pct(s.first.filter((m) => m <= 60).length, s.first.length)}</td>
                          <td className={`px-3 py-2 text-right ${s.waiting ? "font-semibold text-rose-600" : ""}`}>{s.waiting}</td>
                          <td className={`px-3 py-2 text-right ${s.passedOn ? "text-amber-700" : ""}`}>{s.passedOn}</td>
                          <td className="px-3 py-2 text-right">{due ? `${pct(s.fuOnTime, due)} (${s.fuOnTime}/${due})` : "–"}</td>
                          <td className="px-3 py-2 text-right">{s.fuLate}</td>
                          <td className={`px-3 py-2 text-right ${s.fuMissed ? "text-rose-600" : ""}`}>{s.fuMissed}</td>
                          <td className={`px-5 py-2 text-right ${s.overdue ? "font-semibold text-red-600" : ""}`}>{s.overdue}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>No leads in this period.</Empty>
            )}
            <ul className="mt-4 space-y-1 text-xs text-slate-500">
              <li><b>First contacts</b>: new leads where this person made the first call, WhatsApp or meeting. <b>Typical response</b> is timed from when the lead reached them.</li>
              <li><b>Passed on</b>: leads taken away from them because nobody contacted them in time.</li>
              <li><b>Follow-ups on time</b>: something was logged by the follow-up time or within an hour after. <b>Late</b>: logged later. <b>Missed</b>: still not done, or moved to another day without contact.</li>
              <li><b>Overdue now</b>: open leads whose follow-up time has passed, whatever the period.</li>
            </ul>
          </Card>

          <Card title="Still waiting for a first contact">
            {report.stillWaiting.length ? (
              <ul className="-mx-5 divide-y divide-slate-100">
                {report.stillWaiting.slice(0, 15).map(({ lead, min }) => (
                  <li key={lead.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2 text-sm">
                    <Link to={leadLink(lead.id)} className="font-medium text-slate-900 hover:text-brand-700 hover:underline">{lead.name}</Link>
                    <span className="text-slate-500">
                      {nameOf(people, lead.assigned_to) || "Nobody assigned"} · waiting <span className="font-medium text-rose-600">{duration(min)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>Every new lead in this period has been contacted.</Empty>
            )}
          </Card>
        </>
      )}
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}
