import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import type { Database } from "./database.types";

type Table = keyof Database["public"]["Tables"];

let seq = 0;

function visible() {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

// True while the browser tab is in front.
export function usePageVisible() {
  const [shown, setShown] = useState(visible);
  useEffect(() => {
    const h = () => setShown(visible());
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  }, []);
  return shown;
}

// Calls onChange (debounced) whenever a row in the table(s) is inserted, updated
// or deleted, as filtered by `filter` (e.g. "workspace_id=eq.<id>") and by RLS.
// Also calls it once when the tab comes back into view or the socket rejoins,
// to catch anything missed in between. Pass enabled: false to hold off.
export function useLiveTable(
  table: Table | Table[],
  filter: string | undefined,
  onChange: () => void,
  opts: { enabled?: boolean; delay?: number } = {},
) {
  const { enabled = true, delay = 400 } = opts;
  const cb = useRef(onChange);
  useEffect(() => {
    cb.current = onChange;
  });
  const tables = Array.isArray(table) ? table.join(",") : table;

  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    let hidden = !visible();
    let joined = false;
    const fire = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => cb.current(), delay);
    };

    const channel = supabase.channel(`live:${tables}:${filter ?? "all"}:${++seq}`);
    for (const t of tables.split(",")) {
      channel.on("postgres_changes", { event: "*", schema: "public", table: t, ...(filter ? { filter } : {}) }, fire);
    }
    channel.subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      if (joined) fire();
      joined = true;
    });

    const onVis = () => {
      if (!visible()) hidden = true;
      else if (hidden) {
        hidden = false;
        fire();
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
      supabase.removeChannel(channel);
    };
  }, [tables, filter, enabled, delay]);
}

// setInterval that only runs while the tab is visible.
export function useVisibleInterval(fn: () => void, ms: number, enabled = true) {
  const cb = useRef(fn);
  useEffect(() => {
    cb.current = fn;
  });
  const shown = usePageVisible();
  useEffect(() => {
    if (!enabled || !shown) return;
    const t = window.setInterval(() => cb.current(), ms);
    return () => window.clearInterval(t);
  }, [ms, enabled, shown]);
}
