import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { useWorkspace } from "../lib/workspace";
import { useLiveTable, usePageVisible } from "../lib/realtime";
import { Icon } from "./icons";
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

// The running-timer pill in the top bar of every workspace page.
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

  const pill = "flex h-10 items-center gap-2 rounded-xl px-1.5 pl-3 text-sm ring-1";
  const iconBtn = "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg disabled:opacity-50";

  return (
    <div className="relative">
      {running ? (
        <div className={`${pill} bg-emerald-50 ring-emerald-200`}>
          <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span className="font-mono text-[13px] font-semibold tabular-nums text-emerald-800">{hms(secondsOf(running, now))}</span>
          <span className="hidden max-w-44 truncate text-slate-600 xl:block" title={label}>
            {label}
            {sessionSoFar > 0 && <span className="text-xs text-slate-400"> · {hms(sessionSoFar + secondsOf(running, now))} total</span>}
          </span>
          <button className={`${iconBtn} text-amber-700 hover:bg-amber-100`} disabled={busy} onClick={pause} title="Pause" aria-label="Pause timer">
            <Icon name="pause" className="h-3.5 w-3.5" />
          </button>
          <button className={`${iconBtn} bg-red-500 text-white hover:bg-red-600`} disabled={busy} onClick={stop} title="Stop" aria-label="Stop timer">
            <Icon name="stop" className="h-3 w-3" />
          </button>
        </div>
      ) : paused ? (
        <div className={`${pill} bg-amber-50 ring-amber-200`}>
          <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">Paused</span>
          <span className="font-mono text-[13px] font-semibold tabular-nums text-amber-800">{hms(paused.logged)}</span>
          <span className="hidden max-w-40 truncate text-slate-600 xl:block" title={paused.label}>{paused.label}</span>
          <button
            className="flex h-7 shrink-0 items-center gap-1 rounded-lg bg-emerald-600 px-2.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            disabled={busy}
            onClick={resume}
          >
            <Icon name="play" className="h-3 w-3" /> Resume
          </button>
          <button
            className="hidden shrink-0 px-1 text-xs text-slate-500 hover:text-slate-800 sm:block"
            title="Forget this paused timer. Time already logged stays."
            disabled={busy}
            onClick={discard}
          >
            Discard
          </button>
        </div>
      ) : (
        <div className={`${pill} bg-white ring-slate-200`}>
          <span className="hidden h-2 w-2 rounded-full bg-slate-300 sm:block" aria-hidden />
          <span className="hidden text-slate-500 lg:block">No timer running</span>
          <button
            className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-slate-900 px-2.5 text-xs font-semibold text-white hover:bg-slate-800"
            onClick={() => setOpen(!open)}
          >
            <Icon name="play" className="h-3 w-3" /> <span className="hidden sm:inline">Start timer</span>
          </button>
        </div>
      )}
      {open && !running && !paused && (
        <form
          className="absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] space-y-3 rounded-xl bg-white p-4 shadow-lg ring-1 ring-slate-200"
          onSubmit={(e) => {
            e.preventDefault();
            start();
          }}
        >
          <div className="text-sm font-semibold">Start a timer</div>
          <select
            className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm"
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
            className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm"
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              disabled={busy}
            >
              <Icon name="play" className="h-3 w-3" /> Start
            </button>
          </div>
        </form>
      )}
      {error && (
        <div className="absolute right-0 z-40 mt-2 w-72 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-200" role="alert" onClick={() => setError("")}>
          {error}
        </div>
      )}
    </div>
  );
}
