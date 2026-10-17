import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { useWorkspace } from "../../../lib/workspace";
import { useLiveTable, usePageVisible, useVisibleInterval } from "../../../lib/realtime";
import { nameOf, type Person } from "../../../lib/members";
import { Alert, Button, Card, Empty } from "../../../components/ui";
import { announceTimerChange, dateTime, hms, secondsOf, TIMER_EVENT } from "./timeUtil";

type Opt = { id: string; label: string };
type Running = { id: string; user_id: string; started_at: string; stopped_at: string | null; work_item_id: string | null; client_id: string | null; notes: string | null };

// Admins: who is clocked in right now. Updates live as timers start and stop.
export function LiveMonitor({ people, items, clients }: { people: Person[]; items: Opt[]; clients: Opt[] }) {
  const { workspace, isAdmin, canWrite } = useWorkspace();
  const [rows, setRows] = useState<Running[] | null>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState("");
  const [checked, setChecked] = useState(new Date());

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("time_entries")
      .select("id, user_id, started_at, stopped_at, work_item_id, client_id, notes")
      .eq("workspace_id", workspace.id)
      .is("stopped_at", null)
      .order("started_at");
    if (error) setError(error.message);
    setRows(data ?? []);
    setChecked(new Date());
  }, [workspace.id]);

  const shown = usePageVisible();

  useEffect(() => {
    load();
    window.addEventListener(TIMER_EVENT, load);
    return () => window.removeEventListener(TIMER_EVENT, load);
  }, [load]);

  useLiveTable("time_entries", `workspace_id=eq.${workspace.id}`, load);
  useVisibleInterval(load, 5 * 60_000);

  useEffect(() => {
    if (!rows?.length || !shown) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [rows, shown]);

  async function stop(r: Running) {
    if (!confirm(`Stop ${nameOf(people, r.user_id) || "this person"}'s timer now?`)) return;
    setError("");
    const { error } = await supabase.rpc("stop_timer", { p_workspace_id: workspace.id, p_user_id: r.user_id });
    if (error) return setError(error.message);
    announceTimerChange();
  }

  const label = (list: Opt[], id: string | null) => (id ? list.find((x) => x.id === id)?.label ?? "" : "");

  return (
    <Card
      title={`Clocked in now${rows ? ` (${rows.length})` : ""}`}
      actions={<span className="text-xs text-slate-500">Updated {checked.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</span>}
    >
      {error && <div className="mb-3"><Alert>{error}</Alert></div>}
      {!rows ? null : rows.length === 0 ? (
        <Empty>Nobody has a timer running right now.</Empty>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((r) => {
            const secs = secondsOf(r, now);
            const long = secs > 10 * 3600;
            const work = [label(items, r.work_item_id), label(clients, r.client_id)].filter(Boolean).join(" · ") || r.notes || "General work";
            return (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-medium">
                    <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-green-600" aria-hidden />
                    {nameOf(people, r.user_id) || "Member"}
                  </div>
                  <div className="truncate text-xs text-slate-500">{work} · since {dateTime(r.started_at)}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`font-mono tabular-nums ${long ? "font-semibold text-red-600" : ""}`} title={long ? "Running over 10 hours. Possibly forgotten." : undefined}>
                    {hms(secs)}
                  </span>
                  {isAdmin && canWrite && <Button variant="danger" className="!py-1" onClick={() => stop(r)}>Stop</Button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
