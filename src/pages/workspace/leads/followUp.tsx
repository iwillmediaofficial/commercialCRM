import { useState } from "react";
import { Alert, Button, Field, Input, Modal, Select } from "../../../components/ui";

// Follow-up helpers shared by the lead window, the board and the Follow-ups page.

export const LOST_REASONS = ["Not interested", "Budget too low", "Chose a competitor", "Not reachable", "Other"];

// Value for <input type="datetime-local"> in the browser's time, and back.
export function toLocalInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fromLocalInput(v: string) {
  return v ? new Date(v).toISOString() : null;
}

function atTime(daysAhead: number, hour = 10) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

export type QuickPick = { key: string; label: string; at: () => string };
export const QUICK_PICKS: QuickPick[] = [
  { key: "1h", label: "In 1 hour", at: () => new Date(Date.now() + 3600_000).toISOString() },
  { key: "tomorrow", label: "Tomorrow", at: () => atTime(1) },
  { key: "3d", label: "In 3 days", at: () => atTime(3) },
  { key: "week", label: "Next week", at: () => atTime(7) },
];

function startOfDay(offset = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d.getTime();
}

export type FollowUpState = "overdue" | "today" | "upcoming" | "later" | null;
export function followUpState(iso: string | null | undefined): FollowUpState {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (t < Date.now()) return "overdue";
  if (t < startOfDay(1)) return "today";
  if (t < startOfDay(8)) return "upcoming";
  return "later";
}

export function followUpTone(iso: string | null | undefined) {
  const s = followUpState(iso);
  return s === "overdue" ? "text-red-600" : s === "today" ? "text-amber-700" : "text-slate-500";
}

// "Today, 3:00 pm", "Tomorrow, 10:00 am", "18 Nov, 10:00 am"
export function whenLabel(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  const t = d.getTime();
  if (t >= startOfDay(0) && t < startOfDay(1)) return `Today, ${time}`;
  if (t >= startOfDay(1) && t < startOfDay(2)) return `Tomorrow, ${time}`;
  if (t >= startOfDay(-1) && t < startOfDay(0)) return `Yesterday, ${time}`;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${d.toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) })}, ${time}`;
}

// Phone links. Indian 10-digit numbers get the +91 country code for WhatsApp.
function digits(phone: string) {
  return phone.replace(/[^\d+]/g, "");
}
export function telLink(phone: string | null | undefined) {
  return phone ? `tel:${digits(phone)}` : null;
}
export function waLink(phone: string | null | undefined) {
  if (!phone) return null;
  let d = digits(phone).replace(/^\+/, "");
  if (d.startsWith("0")) d = d.replace(/^0+/, "");
  if (d.length === 10) d = `91${d}`;
  return d.length >= 8 ? `https://wa.me/${d}` : null;
}

// Asks why a lead was lost before moving it to Lost.
export function LostReasonModal({ name, onCancel, onConfirm }: { name: string; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [pick, setPick] = useState("");
  const [other, setOther] = useState("");
  const [error, setError] = useState("");
  function confirm() {
    const reason = pick === "Other" ? other.trim() || "Other" : pick;
    if (!reason) return setError("Pick a reason.");
    onConfirm(reason);
  }
  return (
    <Modal title={`Why was "${name}" lost?`} onClose={onCancel}>
      <div className="space-y-3">
        {error && <Alert>{error}</Alert>}
        <Field label="Reason">
          <Select value={pick} onChange={(e) => setPick(e.target.value)} autoFocus>
            <option value="">Pick a reason</option>
            {LOST_REASONS.map((r) => <option key={r}>{r}</option>)}
          </Select>
        </Field>
        {pick === "Other" && (
          <Field label="What happened?">
            <Input maxLength={200} value={other} onChange={(e) => setOther(e.target.value)} />
          </Field>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button type="button" onClick={confirm}>Mark as lost</Button>
        </div>
      </div>
    </Modal>
  );
}
