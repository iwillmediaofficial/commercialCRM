export type WorkspaceStatus = "trial" | "active" | "grace" | "expired" | "suspended";

export const STATUS_LABEL: Record<WorkspaceStatus, string> = {
  trial: "Trial",
  active: "Active",
  grace: "Grace period",
  expired: "Expired (read-only)",
  suspended: "Suspended",
};

export const STATUS_STYLE: Record<WorkspaceStatus, string> = {
  trial: "bg-sky-100 text-sky-800",
  active: "bg-green-100 text-green-800",
  grace: "bg-amber-100 text-amber-800",
  expired: "bg-red-100 text-red-700",
  suspended: "bg-slate-200 text-slate-700",
};

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const s = (status ?? "expired") as WorkspaceStatus;
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[s]}`}>{STATUS_LABEL[s]}</span>;
}
