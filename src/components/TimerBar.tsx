import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { useWorkspace } from "../lib/workspace";
import { announceTimerChange, hms, secondsOf, TIMER_EVENT } from "../pages/workspace/time/timeUtil";

type Running = {
  id: string;
  started_at: string;
  notes: string | null;
  work_item: { title: string } | null;
  client: { company_name: string } | null;
};

// The global running-timer bar shown at the top of every workspace page.
export function TimerBar() {
  const { workspace, canWrite } = useWorkspace();
  const { session } = useAuth();
  const me = session?.user.id;
  const [running, setRunning] = useState<Running | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<{ id: string; title: string }[]>([]);
  const [itemId, setItemId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!me) return;
    const { data } = await supabase
      .from("time_entries")
      .select("id, started_at, notes, work_item:work_items(title), client:clients(company_name)")
      .eq("workspace_id", workspace.id)
      .eq("user_id", me)
      .is("stopped_at", null)
      .maybeSingle();
    setRunning((data as Running | null) ?? null);
    setLoaded(true);
  }, [workspace.id, me]);

  useEffect(() => {
    load();
    const onFocus = () => load();
    window.addEventListener(TIMER_EVENT, load);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener(TIMER_EVENT, load);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  // Tick once a second while a timer runs.
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  // Load the work item picker the first time it is opened.
  useEffect(() => {
    if (!open) return;
    supabase
      .from("work_items")
      .select("id, title")
      .eq("workspace_id", workspace.id)
      .neq("status", "completed")
      .order("title")
      .then(({ data }) => setItems(data ?? []));
  }, [open, workspace.id]);

  if (!canWrite || !loaded) return null;

  async function start() {
    setBusy(true);
    setError("");
    const { error } = await supabase.rpc("start_timer", {
      p_workspace_id: workspace.id,
      p_work_item_id: itemId || undefined,
      p_notes: note.trim() || undefined,
    });
    setBusy(false);
    if (error) return setError(error.message);
    setOpen(false);
    setItemId("");
    setNote("");
    announceTimerChange();
  }

  async function stop() {
    setBusy(true);
    setError("");
    const { error } = await supabase.rpc("stop_timer", { p_workspace_id: workspace.id });
    setBusy(false);
    if (error) return setError(error.message);
    announceTimerChange();
  }

  const label = running
    ? [running.work_item?.title, running.client?.company_name].filter(Boolean).join(" · ") || running.notes || "General work"
    : "";

  return (
    <div className={`border-b text-sm ${running ? "border-green-200 bg-green-50" : "border-slate-200 bg-white"}`}>
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-1.5">
        {running ? (
          <>
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-green-600" aria-hidden />
            <span className="font-mono font-semibold tabular-nums text-green-800">{hms(secondsOf(running, now))}</span>
            <span className="min-w-0 flex-1 truncate text-slate-700" title={label}>{label}</span>
            <button
              className="shrink-0 rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
              disabled={busy}
              onClick={stop}
            >
              Stop
            </button>
          </>
        ) : open ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              start();
            }}
          >
            <select
              className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
              value={itemId}
              onChange={(e) => setItemId(e.target.value)}
              aria-label="Work item"
            >
              <option value="">No work item</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>{i.title}</option>
              ))}
            </select>
            <input
              className="hidden min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm sm:block"
              placeholder="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button
              type="submit"
              className="shrink-0 rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
              disabled={busy}
            >
              Start
            </button>
            <button type="button" className="shrink-0 text-xs text-slate-500 hover:text-slate-800" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <>
            <span className="flex-1 text-slate-500">No timer running</span>
            <button
              className="shrink-0 rounded-md px-3 py-1 text-xs font-medium text-green-700 ring-1 ring-green-300 hover:bg-green-50"
              onClick={() => setOpen(true)}
            >
              ▶ Start timer
            </button>
          </>
        )}
        {error && <span className="shrink-0 truncate text-xs text-red-600" title={error}>{error}</span>}
      </div>
    </div>
  );
}
