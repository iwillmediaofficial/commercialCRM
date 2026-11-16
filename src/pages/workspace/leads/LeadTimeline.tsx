import { useCallback, useEffect, useState, type FormEvent } from "react";
import { supabase, type Tables } from "../../../lib/supabase";
import { useWorkspace } from "../../../lib/workspace";
import { useLiveTable } from "../../../lib/realtime";
import { nameOf, type Person } from "../../../lib/members";
import { date } from "../../../lib/format";
import { Alert, Button, Select, Spinner, Textarea } from "../../../components/ui";
import { STAGE_LABEL, type Stage } from "./leadShared";
import { QUICK_PICKS, fromLocalInput, toLocalInput, whenLabel } from "./followUp";
import type { Lead } from "./LeadModal";

export type Activity = Tables<"lead_activities">;

// Entries people write. The rest are written by the database when the lead changes.
export type ManualKind = "remark" | "call" | "whatsapp" | "meeting";
export const MANUAL_KINDS: { key: ManualKind; label: string }[] = [
  { key: "remark", label: "Remark" },
  { key: "call", label: "Call" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "meeting", label: "Meeting" },
];
export const OUTCOMES: [string, string][] = [
  ["connected", "Connected"],
  ["no_answer", "No answer"],
  ["busy", "Busy"],
  ["switched_off", "Switched off"],
  ["wrong_number", "Wrong number"],
];
const OUTCOME_LABEL = Object.fromEntries(OUTCOMES);
const isManual = (k: string) => MANUAL_KINDS.some((m) => m.key === k);
const EDIT_WINDOW_MS = 24 * 3600 * 1000;

const KIND_STYLE: Record<string, { dot: string; label: string }> = {
  remark: { dot: "bg-indigo-500", label: "Remark" },
  call: { dot: "bg-sky-500", label: "Call" },
  whatsapp: { dot: "bg-green-500", label: "WhatsApp" },
  meeting: { dot: "bg-amber-500", label: "Meeting" },
  created: { dot: "bg-slate-300", label: "" },
  stage: { dot: "bg-slate-300", label: "" },
  assigned: { dot: "bg-slate-300", label: "" },
  follow_up: { dot: "bg-slate-300", label: "" },
  converted: { dot: "bg-green-600", label: "" },
};

export function dateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return date(iso);
}

function str(v: unknown) {
  return typeof v === "string" ? v : null;
}

// One line for an automatic entry, e.g. "Moved from New lead to Contacted".
function describe(a: Activity, people: Person[], forms: Record<string, { title: string }>) {
  const d = (a.details && typeof a.details === "object" && !Array.isArray(a.details) ? a.details : {}) as Record<string, unknown>;
  const who = (id: unknown) => nameOf(people, str(id)) || "a former member";
  switch (a.kind) {
    case "created": {
      const form = str(d.form_id) ? forms[str(d.form_id)!] : undefined;
      if (form) return `Lead came in from the form "${form.title}"`;
      if (!a.created_by) return "Lead came in from a lead form";
      return `Lead added${str(d.source) ? ` (source: ${str(d.source)})` : ""}`;
    }
    case "stage":
      return `Moved from ${STAGE_LABEL[str(d.from) as Stage] ?? d.from} to ${STAGE_LABEL[str(d.to) as Stage] ?? d.to}${str(d.reason) ? ` (reason: ${str(d.reason)})` : ""}`;
    case "assigned":
      if (!d.to) return `Unassigned (was ${who(d.from)})`;
      return d.from ? `Reassigned from ${who(d.from)} to ${who(d.to)}` : `Assigned to ${who(d.to)}`;
    case "follow_up": {
      // Older entries hold dates, newer ones date and time.
      const when = (v: unknown) => (str(v) && str(v)!.length > 10 ? whenLabel(str(v)) : date(str(v)));
      if (!d.to) return "Follow-up cleared";
      return d.from ? `Follow-up moved from ${when(d.from)} to ${when(d.to)}` : `Follow-up set for ${when(d.to)}`;
    }
    case "converted":
      return "Became a client";
    default:
      return a.kind;
  }
}

type LeadPatch = Partial<Pick<Lead, "stage" | "follow_up_at" | "follow_up_date" | "last_remark" | "last_remark_at" | "first_contacted_at" | "last_contacted_at">>;

type Props = {
  leadId: string;
  stage: string;
  followUpAt: string | null;
  // Set by the Call / WhatsApp buttons: pick that entry type.
  preset?: { kind: ManualKind; n: number } | null;
  onLeadChanged?: (patch: LeadPatch) => void;
  people: Person[];
  me: string;
  forms: Record<string, { title: string }>;
  onCount?: (n: number) => void;
};

export default function LeadTimeline({ leadId, stage, followUpAt, preset, onLeadChanged, people, me, forms, onCount }: Props) {
  const { workspace, isAdmin, canWrite } = useWorkspace();
  const [items, setItems] = useState<Activity[] | null>(null);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<ManualKind>("remark");
  const [outcome, setOutcome] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [editOutcome, setEditOutcome] = useState("");
  const [next, setNext] = useState("keep"); // keep | quick pick key | custom | clear
  const [custom, setCustom] = useState("");
  const closed = stage === "won" || stage === "lost";

  useEffect(() => {
    if (preset) setKind(preset.kind);
  }, [preset]);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("lead_activities")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) setError(error.message);
    setItems(data ?? []);
  }, [leadId]);

  useEffect(() => {
    load();
  }, [load]);
  useLiveTable("lead_activities", `lead_id=eq.${leadId}`, load);

  useEffect(() => {
    if (items && onCount) onCount(items.filter((a) => isManual(a.kind)).length);
  }, [items, onCount]);

  const needsText = kind === "remark" || kind === "meeting";
  const hasOutcome = kind === "call" || kind === "whatsapp";

  async function add(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (needsText && !body.trim()) return setError(kind === "meeting" ? "Write a short note about the meeting." : "Write the remark first.");
    if (hasOutcome && !outcome && !body.trim()) return setError("Pick how it went, or add a note.");
    let nextAt: string | null | undefined; // undefined = leave as is
    if (!closed && next === "clear") nextAt = null;
    else if (!closed && next === "custom") {
      if (!custom) return setError("Pick the date and time of the next follow-up.");
      nextAt = fromLocalInput(custom);
    } else if (!closed && next !== "keep") nextAt = QUICK_PICKS.find((q) => q.key === next)?.at();
    setBusy(true);
    const { data, error } = await supabase
      .from("lead_activities")
      .insert({
        workspace_id: workspace.id,
        lead_id: leadId,
        kind,
        outcome: hasOutcome ? outcome || null : null,
        body: body.trim() || null,
        created_by: me,
      })
      .select()
      .single();
    if (error) {
      setBusy(false);
      return setError(error.message);
    }
    setItems((xs) => [data, ...(xs ?? []).filter((x) => x.id !== data.id)]);
    setBody("");
    setOutcome("");
    if (nextAt !== undefined) {
      const r = await supabase.from("leads").update({ follow_up_at: nextAt }).eq("id", leadId);
      if (r.error) setError(`Saved, but the follow-up wasn't changed: ${r.error.message}`);
    }
    setNext("keep");
    setCustom("");
    // A call can move the lead to Contacted; pass the fresh values up.
    const { data: fresh } = await supabase
      .from("leads")
      .select("stage, follow_up_at, follow_up_date, last_remark, last_remark_at, first_contacted_at, last_contacted_at")
      .eq("id", leadId)
      .maybeSingle();
    setBusy(false);
    if (fresh) onLeadChanged?.(fresh);
    load();
  }

  async function saveEdit(a: Activity) {
    setError("");
    if ((a.kind === "remark" || a.kind === "meeting") && !editBody.trim()) return setError("A remark can't be empty. Delete it instead.");
    setBusy(true);
    const { data, error } = await supabase
      .from("lead_activities")
      .update({ body: editBody.trim() || null, outcome: a.kind === "call" || a.kind === "whatsapp" ? editOutcome || null : null })
      .eq("id", a.id)
      .select();
    setBusy(false);
    if (error) return setError(error.message);
    if (!data?.length) return setError("This entry can no longer be edited (only within 24 hours of writing it).");
    setItems((xs) => (xs ?? []).map((x) => (x.id === a.id ? data[0] : x)));
    setEditingId(null);
  }

  async function remove(a: Activity) {
    if (!confirm("Delete this entry from the timeline?")) return;
    setError("");
    setBusy(true);
    const { data, error } = await supabase.from("lead_activities").delete().eq("id", a.id).select("id");
    setBusy(false);
    if (error) return setError(error.message);
    if (!data?.length) return setError("This entry can't be deleted. You can delete your own entries within 24 hours; admins can delete any.");
    setItems((xs) => (xs ?? []).filter((x) => x.id !== a.id));
  }

  if (!items) return <Spinner />;

  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}

      {canWrite && (
        <form onSubmit={add} className="space-y-2 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-md ring-1 ring-slate-300" role="group" aria-label="Entry type">
              {MANUAL_KINDS.map((k) => (
                <button
                  key={k.key}
                  type="button"
                  onClick={() => setKind(k.key)}
                  className={`px-3 py-1.5 text-xs font-medium first:rounded-l-md last:rounded-r-md ${kind === k.key ? "bg-indigo-600 text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`}
                >
                  {k.label}
                </button>
              ))}
            </div>
            {hasOutcome && (
              <Select className="!w-auto !py-1.5 text-xs" value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="How did it go?">
                <option value="">How did it go?</option>
                {OUTCOMES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </Select>
            )}
          </div>
          <Textarea
            rows={2}
            maxLength={5000}
            placeholder={
              kind === "remark" ? "e.g. Asked for the pricing PDF, call back after Diwali"
              : kind === "meeting" ? "Where you met and what was agreed"
              : "Optional note about the conversation"
            }
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          {!closed && (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-slate-600">
                Next follow-up{" "}
                <span className="font-normal text-slate-500">(now: {followUpAt ? whenLabel(followUpAt) : "none"})</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { key: "keep", label: "Keep as is" },
                  ...QUICK_PICKS,
                  { key: "custom", label: "Pick date & time" },
                  ...(followUpAt ? [{ key: "clear", label: "No follow-up" }] : []),
                ].map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => {
                      setNext(o.key);
                      if (o.key === "custom" && !custom) setCustom(toLocalInput(followUpAt ?? QUICK_PICKS[1].at()));
                    }}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${next === o.key ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {next === "custom" && (
                <input
                  type="datetime-local"
                  className="block rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm"
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                />
              )}
            </div>
          )}
          <div className="flex justify-end">
            <Button disabled={busy}>{busy ? "Saving…" : `Add ${MANUAL_KINDS.find((k) => k.key === kind)!.label.toLowerCase()}`}</Button>
          </div>
        </form>
      )}

      {items.length ? (
        <ol className="relative space-y-3 border-l border-slate-200 pl-5">
          {items.map((a) => {
            const style = KIND_STYLE[a.kind] ?? KIND_STYLE.created;
            const manual = isManual(a.kind);
            const mine = a.created_by === me;
            const fresh = Date.now() - new Date(a.created_at).getTime() < EDIT_WINDOW_MS;
            const canEdit = canWrite && manual && mine && fresh;
            const canDelete = canWrite && manual && ((mine && fresh) || isAdmin);
            const author = a.created_by ? nameOf(people, a.created_by) || "A former member" : "System";
            const editing = editingId === a.id;
            return (
              <li key={a.id} className="relative">
                <span className={`absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-white ${style.dot}`} />
                {manual ? (
                  <div className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold text-slate-800">{style.label}</span>
                        {a.outcome && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">{OUTCOME_LABEL[a.outcome] ?? a.outcome}</span>}
                        <span className="text-slate-500">by {author}</span>
                      </div>
                      <span className="text-slate-500" title={dateTime(a.created_at)}>
                        {ago(a.created_at)}{a.edited_at ? " · edited" : ""}
                      </span>
                    </div>
                    {editing ? (
                      <div className="mt-2 space-y-2">
                        {(a.kind === "call" || a.kind === "whatsapp") && (
                          <Select className="!w-auto !py-1.5 text-xs" value={editOutcome} onChange={(e) => setEditOutcome(e.target.value)} aria-label="How did it go?">
                            <option value="">No outcome</option>
                            {OUTCOMES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                          </Select>
                        )}
                        <Textarea rows={2} maxLength={5000} value={editBody} onChange={(e) => setEditBody(e.target.value)} />
                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="secondary" onClick={() => setEditingId(null)}>Cancel</Button>
                          <Button type="button" disabled={busy} onClick={() => saveEdit(a)}>Save</Button>
                        </div>
                      </div>
                    ) : (
                      a.body && <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-slate-800">{a.body}</p>
                    )}
                    {!editing && (canEdit || canDelete) && (
                      <div className="mt-2 flex gap-3 text-xs">
                        {canEdit && (
                          <button
                            type="button"
                            className="font-medium text-indigo-600 hover:underline"
                            onClick={() => {
                              setEditingId(a.id);
                              setEditBody(a.body ?? "");
                              setEditOutcome(a.outcome ?? "");
                            }}
                          >
                            Edit
                          </button>
                        )}
                        {canDelete && (
                          <button type="button" className="font-medium text-red-600 hover:underline" onClick={() => remove(a)}>Delete</button>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-slate-600">
                    <span className="text-slate-800">{describe(a, people, forms)}</span>
                    <span className="text-slate-400"> · </span>
                    {a.created_by && <span>{author} · </span>}
                    <span title={dateTime(a.created_at)}>{ago(a.created_at)}</span>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="py-4 text-center text-sm text-slate-500">Nothing logged yet.</p>
      )}
    </div>
  );
}
