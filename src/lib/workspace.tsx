import { createContext, useContext } from "react";
import type { MemberRole, Tables } from "./supabase";
import type { WorkspaceStatus } from "./status";

export type WorkspaceCtx = {
  workspace: Tables<"workspaces">;
  plan: Tables<"plans"> | null;
  role: MemberRole | null; // null = Super Admin looking in (read-only)
  // Set while the Super Admin is acting as this company's owner (full access, logged).
  support: { until: string } | null;
  status: WorkspaceStatus;
  isAdmin: boolean;
  canWrite: boolean;
  hasModule: (m: "leads" | "work" | "invoicing" | "ad_funds") => boolean;
};

export const WorkspaceContext = createContext<WorkspaceCtx | null>(null);

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside a workspace route");
  return ctx;
}
