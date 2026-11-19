import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { useLiveTable } from "../../../lib/realtime";

// The signed-in person's Stuck lock state, worked out by the database
// (India time, the admin's lock time, overdue leads and any unlock for today).
export type LeadLock = { enabled: boolean; lock_time: string; stuck: boolean; overdue: number; unlocked_today: boolean };

export function lockTimeLabel(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(2000, 0, 1, h, m);
  return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }).toUpperCase();
}

export function useLeadLock(workspaceId: string) {
  const [lock, setLock] = useState<LeadLock | null>(null);
  const refresh = useCallback(async () => {
    const { data } = await supabase.rpc("my_lead_lock", { p_workspace_id: workspaceId });
    if (data && typeof data === "object" && !Array.isArray(data)) setLock(data as unknown as LeadLock);
  }, [workspaceId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, [refresh]);
  useLiveTable("leads", `workspace_id=eq.${workspaceId}`, refresh);

  return { lock, refresh };
}
