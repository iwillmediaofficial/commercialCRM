import type { Tables } from "../../../lib/supabase";

export type WorkItem = Tables<"work_items">;
export type Status = "backlog" | "in_progress" | "under_review" | "completed";
export type Priority = "low" | "medium" | "high" | "urgent";
export type CheckItem = { id: string; text: string; done: boolean };
export type ClientOpt = { id: string; company_name: string };

export const STATUSES: [Status, string][] = [
  ["backlog", "Backlog"],
  ["in_progress", "In progress"],
  ["under_review", "Under review"],
  ["completed", "Completed"],
];
export const STATUS_LABEL = Object.fromEntries(STATUSES) as Record<Status, string>;
export const STATUS_TONE: Record<Status, string> = {
  backlog: "bg-slate-100 text-slate-700",
  in_progress: "bg-sky-100 text-sky-800",
  under_review: "bg-violet-100 text-violet-800",
  completed: "bg-green-100 text-green-800",
};

export const PRIORITIES: [Priority, string][] = [
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
  ["urgent", "Urgent"],
];
export const PRIORITY_LABEL = Object.fromEntries(PRIORITIES) as Record<Priority, string>;
export const PRIORITY_TONE: Record<Priority, string> = {
  low: "bg-slate-100 text-slate-600",
  medium: "bg-amber-100 text-amber-800",
  high: "bg-orange-100 text-orange-800",
  urgent: "bg-red-100 text-red-700",
};

export function checklistOf(item: Pick<WorkItem, "checklist"> | null | undefined): CheckItem[] {
  return Array.isArray(item?.checklist) ? (item.checklist as unknown as CheckItem[]) : [];
}

// "overdue" | "soon" (due within 3 days) | null, ignoring finished items.
export function dueState(item: Pick<WorkItem, "due_date" | "status">, today: string) {
  if (!item.due_date || item.status === "completed") return null;
  if (item.due_date < today) return "overdue" as const;
  const soon = new Date(today);
  soon.setDate(soon.getDate() + 3);
  return item.due_date <= soon.toISOString().slice(0, 10) ? ("soon" as const) : null;
}
