import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { useWorkspace } from "../lib/workspace";
import { useLiveTable, usePageVisible } from "../lib/realtime";
import { announceTimerChange, hms, secondsOf, TIMER_EVENT } from "../pages/workspace/time/timeUtil";

type Running = {
  id: string;
  started_at: string;
  notes: string | null;
  work_item_id: string | null;
  work_item: { title: string } | null;
  client: { company_name: string } | null;
};

// A paused session: the timer was stopped with Pause, and Resume starts a new
// entry for the same work. `logged` is the time already logged in this session;
// `entryId` is the running entry once resumed (paused = false).
type PauseState = {
  workItemId: string | null;
  notes: string | null;
  label: string;
  logged: number;
  paused: boolean;
  entryId: string | null;
};

const storageKey = (ws: string, user: string) => `timer-pause:${ws}:${user}`;

function readSession(key: string): PauseState | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as PauseState;
    return v && typeof v.logged === "number" ? v : null;
  } catch {
    return null;
  }
}

function writeSession(key: string, v: PauseState | null) {
  try {
    if (v) localStorage.setItem(key, JSON.stringify(v));
    else localStorage.removeItem(key);
  } catch {
    /* storage blocked: pause still stops the timer, it just won't be remembered */
  }
}

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
  const key = me ? storageKey(workspace.id, me) : null;
  const [pauseState, setPauseState] = useState<PauseState | null>(null);

  const remember = useCallback(
    (v: PauseState | null) => {
      if (key) writeSession(key, v);
      setPauseState(v);
    },
    [key],
  );

  const load = useCallback(async () => {
    if (!me) return;
    setPauseState(readSession(storageKey(workspace.id, me)));
    const { data } = await supabase
      .from("time_entries")
      .select("id, started_at, notes, work_item_id, work_item:work_items(title), client:clients(company_name)")
      .eq("workspace_id", workspace.id)
      .eq("user_id", me)
      .is("stopped_at", null)
      .maybeSingle();
    setRunning((data as Running | null) ?? null);
    setLoaded(true);
  }, [workspace.id, me]);

  useEffect(() => {
    load();
    window.addEventListener(TIMER_EVENT, load);
    return () => window.removeEventListener(TIMER_EVENT, load);
  }, [load]);

  // Timers started or stopped in another tab, or by an admin. Also reloads on tab return.
  useLiveTable("time_entries", `user_id=eq.${me}`, load, { enabled: !!me });

  // Tick once a second while a timer runs and the tab is visible.
  const shown = usePageVisible();
  useEffect(() => {
    if (!running || !shown) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running, shown]);

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
    remember(null);
    announceTimerChange();
  }

  async function pause() {
    if (!running) return;
    const entry = running;
    // Carry on the same session if this entry came from Resume.
    const prior = pauseState && !pauseState.paused && pauseState.entryId === entry.id ? pauseState.logged : 0;
    setBusy(true);
    setError("");
    const { error } = await supabase.rpc("stop_timer", { p_workspace_id: workspace.id });
    if (error) {
      setBusy(false);
      return setError(error.message);
    }
    const { data } = await supabase
      .from("time_entries")
      .select("started_at, stopped_at, duration_seconds")
      .eq("workspace_id", workspace.id)
      .eq("id", entry.id)
      .maybeSingle();
    setBusy(false);
    remember({
      workItemId: entry.work_item_id,
      notes: entry.notes,
      label,
      logged: prior + (data ? secondsOf(data) : secondsOf(entry)),
      paused: true,
      entryId: null,
    });
    announceTimerChange();
  }

  async function resume() {
    if (!pauseState) return;
    setBusy(true);
    setError("");
    const { data, error } = await supabase.rpc("start_timer", {
      p_workspace_id: workspace.id,
      p_work_item_id: pauseState.workItemId || undefined,
      p_notes: pauseState.notes || undefined,
    });
    setBusy(false);
    if (error) return setError(error.message);
    remember({ ...pauseState, paused: false, entryId: data });
    announceTimerChange();
  }

  function discard() {
    setError("");
    remember(null);
    announceTimerChange();
  }

  const label = running
    ? [running.work_item?.title, running.client?.company_name].filter(Boolean).join(" · ") || running.notes || "General work"
    : "";
  const paused = !running && pauseState?.paused ? pauseState : null;
  // While a resumed session runs, show the whole session's time next to this entry's.
  const sessionSoFar = running && pauseState && !pauseState.paused && pauseState.entryId === running.id ? pauseState.logged : 0;

  return (
    <div className={`border-b text-sm ${running ? "border-green-200 bg-green-50" : paused ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}>
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-1.5">
        {running ? (
          <>
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-green-600" aria-hidden />
            <span className="font-mono font-semibold tabular-nums text-green-800">{hms(secondsOf(running, now))}</span>
            <span className="min-w-0 flex-1 truncate text-slate-700" title={label}>
              {label}
              {sessionSoFar > 0 && <span className="text-xs text-slate-500"> · {hms(sessionSoFar + secondsOf(running, now))} in total</span>}
            </span>
            <button
              className="shrink-0 rounded-md px-3 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-300 hover:bg-amber-50 disabled:opacity-50"
              disabled={busy}
              onClick={pause}
            >
              Pause
            </button>
            <button
              className="shrink-0 rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
              disabled={busy}
              onClick={stop}
            >
              Stop
            </button>
          </>
        ) : paused ? (
          <>
            <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">Paused</span>
            <span className="font-mono font-semibold tabular-nums text-amber-800">{hms(paused.logged)}</span>
            <span className="min-w-0 flex-1 truncate text-slate-700" title={paused.label}>{paused.label}</span>
            <button
              className="shrink-0 rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
              disabled={busy}
              onClick={resume}
            >
              ▶ Resume
            </button>
            <button
              className="shrink-0 text-xs text-slate-500 hover:text-slate-800"
              title="Forget this paused timer. Time already logged stays."
              disabled={busy}
              onClick={discard}
            >
              Discard
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
