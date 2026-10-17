// Small helpers shared by the timer bar, work items and timesheets.

export const TIMER_EVENT = "timer-changed";

// Tell every open page that a timer started or stopped.
export function announceTimerChange() {
  window.dispatchEvent(new Event(TIMER_EVENT));
}

// 3725 -> "01:02:05"
export function hms(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

// 5400 -> "1.5 h"
export function hours(totalSeconds: number, digits = 2) {
  const h = totalSeconds / 3600;
  return `${Number(h.toFixed(digits)).toLocaleString("en-IN")} h`;
}

// Seconds an entry has run: finished length, or so far if still running.
export function secondsOf(e: { started_at: string; stopped_at?: string | null; duration_seconds?: number | null }, now = Date.now()) {
  if (e.stopped_at) return e.duration_seconds ?? Math.max(0, (new Date(e.stopped_at).getTime() - new Date(e.started_at).getTime()) / 1000);
  return Math.max(0, (now - new Date(e.started_at).getTime()) / 1000);
}

// ISO timestamp -> value for <input type="datetime-local"> in local time.
export function toLocalInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Today's date as YYYY-MM-DD in local time.
export function localDay(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function dateTime(iso: string | null | undefined) {
  return iso
    ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
    : "";
}
