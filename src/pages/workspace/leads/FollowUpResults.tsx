import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { useWorkspace } from "../../../lib/workspace";
import { nameOf, type Person } from "../../../lib/members";
import { Alert, Card, Empty } from "../../../components/ui";
import { STAGE_LABEL, type Stage } from "./leadShared";

// Results view of the Follow-ups page: how leads that came in during the period
// moved towards Won, and (for admins) how each person is keeping up.

export type StatLead = {
  id: string;
  stage: string;
  assigned_to: string | null;
  follow_up_at: string | null;
  first_contacted_at: string | null;
  created_at: string;
  lost_reason: string | null;
};
export type StatActivity = { lead_id: string; kind: string; details: unknown; created_by: string | null; created_at: string };

const FLOW: Stage[] = ["new", "contacted", "qualified", "proposal_sent", "won"];
const BAR: Record<string, string> = {
  new: "bg-sky-500",
  contacted: "bg-indigo-500",
  qualified: "bg-violet-500",
  proposal_sent: "bg-amber-500",
  won: "bg-green-600",
};

const stageTo = (a: StatActivity) => {
  const d = a.details as Record<string, unknown> | null;
  return d && typeof d.to === "string" ? d.to : null;
};

// When a Won lead was won: its last move to Won, or (for leads won before the
// timeline existed, or added as Won) the day it was added.
export function wonAt(lead: { id: string; stage: string; created_at: string }, activities: StatActivity[]) {
  if (lead.stage !== "won") return null;
  const hit = activities.filter((a) => a.lead_id === lead.id && a.kind === "stage" && stageTo(a) === "won");
  return hit.length ? hit[hit.length - 1].created_at : lead.created_at;
}

type Props = {
  leads: StatLead[]; // already filtered to the chosen person
  activities: StatActivity[];
  since: number;
  rangeLabel: string;
  people: Person[];
  showTeam: boolean;
  allLeads: StatLead[];
};

type LockRow = { user_id: string; overdue: number; stuck: boolean; unlocked_today: boolean };

export default function FollowUpResults({ leads, activities, since, rangeLabel, people, showTeam, allLeads }: Props) {
  const { workspace, canWrite } = useWorkspace();
  const [locks, setLocks] = useState<Record<string, LockRow>>({});
  const [lockOn, setLockOn] = useState(false);
  const [lockError, setLockError] = useState("");
  const [unlocking, setUnlocking] = useState("");
  const loadLocks = useCallback(async () => {
    if (!showTeam) return;
    const [t, s] = await Promise.all([
      supabase.rpc("team_lead_lock", { p_workspace_id: workspace.id }),
      supabase.from("workspace_settings").select("stuck_lock_enabled").eq("workspace_id", workspace.id).maybeSingle(),
    ]);
    setLocks(Object.fromEntries((t.data ?? []).map((r) => [r.user_id, r])));
    setLockOn(!!s.data?.stuck_lock_enabled);
  }, [showTeam, workspace.id]);
  useEffect(() => {
    loadLocks();
  }, [loadLocks, allLeads]);

  async function unlock(userId: string) {
    setLockError("");
    setUnlocking(userId);
    const { error } = await supabase.rpc("unlock_lead_lock", { p_workspace_id: workspace.id, p_user_id: userId });
    setUnlocking("");
    if (error) return setLockError(error.message);
    loadLocks();
  }

  const inRange = leads.filter((l) => new Date(l.created_at).getTime() >= since);

  // Furthest stage each lead reached, from its current stage and its stage history.
  const reached = new Map<string, number>();
  for (const l of inRange) {
    let best = Math.max(FLOW.indexOf(l.stage as Stage), l.first_contacted_at ? 1 : 0);
    for (const a of activities) {
      if (a.lead_id === l.id && a.kind === "stage") best = Math.max(best, FLOW.indexOf((stageTo(a) ?? "") as Stage));
    }
    reached.set(l.id, best);
  }
  const counts = FLOW.map((_, i) => inRange.filter((l) => (reached.get(l.id) ?? 0) >= i).length);
  const max = counts[0] || 1;
  const lost = inRange.filter((l) => l.stage === "lost");
  const reasons = Object.entries(
    lost.reduce<Record<string, number>>((m, l) => {
      const r = l.lost_reason || "No reason given";
      m[r] = (m[r] ?? 0) + 1;
      return m;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);

  const now = Date.now();
  const team = people
    .filter((p) => p.is_active || allLeads.some((l) => l.assigned_to === p.user_id))
    .map((p) => {
      const mine = allLeads.filter((l) => l.assigned_to === p.user_id);
      const newOnes = mine.filter((l) => new Date(l.created_at).getTime() >= since);
      return {
        id: p.user_id,
        name: nameOf(people, p.user_id),
        leads: newOnes.length,
        contacted: newOnes.filter((l) => l.first_contacted_at).length,
        followUps: activities.filter((a) => a.created_by === p.user_id && ["call", "whatsapp", "meeting"].includes(a.kind) && new Date(a.created_at).getTime() >= since).length,
        overdue: mine.filter((l) => l.stage !== "won" && l.stage !== "lost" && l.follow_up_at && new Date(l.follow_up_at).getTime() < now).length,
        won: mine.filter((l) => {
          const w = wonAt(l, activities);
          return !!w && new Date(w).getTime() >= since;
        }).length,
      };
    })
    .filter((r) => r.leads || r.followUps || r.overdue || r.won || locks[r.id]?.stuck)
    .sort((a, b) => b.won - a.won || b.followUps - a.followUps);

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <Card title="How new leads moved towards Won">
        <p className="-mt-2 mb-4 text-sm text-slate-500">
          {inRange.length} lead{inRange.length === 1 ? "" : "s"} came in during the {rangeLabel}. Each bar counts the leads that reached that stage or went further.
        </p>
        {inRange.length ? (
          <div className="space-y-1">
            {FLOW.map((s, i) => (
              <div key={s}>
                <div className="grid grid-cols-[110px_minmax(0,1fr)_40px] items-center gap-3 text-sm">
                  <span className="text-slate-700">{STAGE_LABEL[s]}</span>
                  <div className="h-6 rounded bg-slate-100">
                    <div className={`h-6 rounded ${BAR[s]}`} style={{ width: `${Math.max(counts[i] ? 2 : 0, (counts[i] / max) * 100)}%` }} />
                  </div>
                  <span className="text-right font-semibold tabular-nums">{counts[i]}</span>
                </div>
                {i < FLOW.length - 1 && counts[i] > 0 && (
                  <div className="ml-[122px] py-0.5 text-xs text-slate-500">
                    {Math.round((counts[i + 1] / counts[i]) * 100)}% moved on to {STAGE_LABEL[FLOW[i + 1]]}
                  </div>
                )}
              </div>
            ))}
            {lost.length > 0 && (
              <div className="mt-4 border-t border-slate-100 pt-3 text-sm">
                <div className="font-medium text-slate-700">Lost: {lost.length}</div>
                <ul className="mt-1 space-y-0.5 text-slate-500">
                  {reasons.map(([r, n]) => <li key={r}>{r}: {n}</li>)}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <Empty>No leads came in during the {rangeLabel}.</Empty>
        )}
      </Card>

      {showTeam && (
        <Card title="Team">
          <p className="-mt-2 mb-3 text-sm text-slate-500">
            Leads that came in during the {rangeLabel}, calls and messages logged, follow-ups overdue right now, and leads won.
          </p>
          {lockError && <div className="mb-3"><Alert>{lockError}</Alert></div>}
          {team.length ? (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full min-w-[600px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <th className="px-5 py-2 font-medium">Person</th>
                    <th className="px-2 py-2 text-right font-medium">New leads</th>
                    <th className="px-2 py-2 text-right font-medium">Contacted</th>
                    <th className="px-2 py-2 text-right font-medium">Calls &amp; messages</th>
                    <th className="px-2 py-2 text-right font-medium">Overdue</th>
                    {lockOn && <th className="px-2 py-2 font-medium">Lock</th>}
                    <th className="px-5 py-2 text-right font-medium">Won</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {team.map((r) => (
                    <tr key={r.id}>
                      <td className="px-5 py-2 font-medium">{r.name}</td>
                      <td className="px-2 py-2 text-right">{r.leads}</td>
                      <td className="px-2 py-2 text-right">
                        {r.contacted}
                        {r.leads > 0 && <span className="text-slate-400"> ({Math.round((r.contacted / r.leads) * 100)}%)</span>}
                      </td>
                      <td className="px-2 py-2 text-right">{r.followUps}</td>
                      <td className={`px-2 py-2 text-right ${r.overdue ? "font-semibold text-red-600" : ""}`}>{r.overdue}</td>
                      {lockOn && (
                        <td className="px-2 py-2">
                          {locks[r.id]?.stuck ? (
                            <span className="inline-flex flex-wrap items-center gap-2">
                              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">Stuck</span>
                              {canWrite && (
                                <button
                                  type="button"
                                  disabled={unlocking === r.id}
                                  onClick={() => unlock(r.id)}
                                  className="text-xs font-medium text-indigo-600 hover:underline disabled:opacity-50"
                                >
                                  {unlocking === r.id ? "Unlocking…" : "Unlock for today"}
                                </button>
                              )}
                            </span>
                          ) : locks[r.id]?.unlocked_today ? (
                            <span className="text-xs text-slate-500">Unlocked today</span>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                      )}
                      <td className="px-5 py-2 text-right font-semibold text-green-700">{r.won}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>Nothing to show for the {rangeLabel}.</Empty>
          )}
        </Card>
      )}
    </div>
  );
}
