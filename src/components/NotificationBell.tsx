import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { supabase, type Tables } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { useLiveTable, useVisibleInterval } from "../lib/realtime";

type Note = Tables<"notifications">;

// Old links pointed at /settings/subscription; inside a workspace that page is "billing".
function target(slug: string, link: string | null) {
  if (!link) return null;
  if (link.startsWith("/w/")) return link;
  const path = link.replace(/^\/+/, "").replace(/^settings\/subscription$/, "billing");
  return `/w/${slug}/${path}`;
}

// Bell with unread count for the signed-in person's notifications in this workspace.
export function NotificationBell({ workspace }: { workspace: { id: string; slug: string } }) {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [notes, setNotes] = useState<Note[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const userId = session?.user.id;

  const load = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .or(`workspace_id.eq.${workspace.id},workspace_id.is.null`)
      .order("created_at", { ascending: false })
      .limit(30);
    setNotes(data ?? []);
  }, [userId, workspace.id]);

  useEffect(() => {
    load();
  }, [load]);

  useLiveTable("notifications", `user_id=eq.${userId}`, load, { enabled: !!userId });
  // Slow safety net in case the live connection drops.
  useVisibleInterval(load, 5 * 60_000);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const unread = notes.filter((n) => !n.is_read);

  async function markAll() {
    if (!unread.length) return;
    await supabase.from("notifications").update({ is_read: true }).in("id", unread.map((n) => n.id));
    load();
  }

  async function openNote(n: Note) {
    if (!n.is_read) await supabase.from("notifications").update({ is_read: true }).eq("id", n.id);
    setOpen(false);
    load();
    const to = target(workspace.slug, n.link);
    if (to) navigate(to);
  }

  return (
    <div className="relative" ref={box}>
      <button
        className="relative rounded-md p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        aria-label={`Notifications${unread.length ? `, ${unread.length} unread` : ""}`}
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread.length > 0 && (
          <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] font-semibold leading-4 text-white">
            {unread.length > 9 ? "9+" : unread.length}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg bg-white shadow-lg ring-1 ring-slate-200">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            {unread.length > 0 && <button className="text-xs text-indigo-600 hover:underline" onClick={markAll}>Mark all read</button>}
          </div>
          <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
            {notes.length === 0 && <li className="p-4 text-center text-sm text-slate-500">Nothing yet.</li>}
            {notes.map((n) => (
              <li key={n.id}>
                <button className={`block w-full px-3 py-2 text-left hover:bg-slate-50 ${n.is_read ? "" : "bg-indigo-50/50"}`} onClick={() => openNote(n)}>
                  <div className="text-sm font-medium">{n.title}</div>
                  {n.message && <div className="text-xs text-slate-600">{n.message}</div>}
                  <div className="mt-0.5 text-[11px] text-slate-400">{new Date(n.created_at).toLocaleString()}</div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
