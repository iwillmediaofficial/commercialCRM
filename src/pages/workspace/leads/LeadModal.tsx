import { useState, type FormEvent } from "react";
import { supabase, type Tables } from "../../../lib/supabase";
import { useWorkspace } from "../../../lib/workspace";
import { nameOf, type Person } from "../../../lib/members";
import { date } from "../../../lib/format";
import { Alert, Button, Field, Input, Modal, Select, Textarea } from "../../../components/ui";
import { SOURCES, STAGES, humanize, type FormField, type Stage } from "./leadShared";

export type Lead = Tables<"leads">;

type Props = {
  lead: Lead | null; // null = new lead
  people: Person[];
  me: string;
  formFields: Record<string, { title: string; fields: FormField[] }>;
  onClose: () => void;
  onSaved: (lead: Lead, prevStage: Stage | null) => void;
  onDeleted: (id: string) => void;
  onConvert: (lead: Lead) => void;
};

export default function LeadModal({ lead, people, me, formFields, onClose, onSaved, onDeleted, onConvert }: Props) {
  const { workspace, isAdmin, canWrite } = useWorkspace();
  const [v, setV] = useState({
    name: lead?.name ?? "",
    phone: lead?.phone ?? "",
    email: lead?.email ?? "",
    company: lead?.company ?? "",
    source: lead?.source ?? "Other",
    stage: (lead?.stage ?? "new") as Stage,
    value: lead?.value != null ? String(lead.value) : "",
    score: lead?.score != null ? String(lead.score) : "",
    assigned_to: lead ? lead.assigned_to ?? "" : me,
    follow_up_date: lead?.follow_up_date ?? "",
    notes: lead?.notes ?? "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });

  // Staff can only keep a lead with themselves (or leave it unassigned).
  const assignable = isAdmin
    ? people.filter((p) => p.is_active || p.user_id === v.assigned_to)
    : people.filter((p) => p.user_id === me || p.user_id === v.assigned_to);
  const sources = SOURCES.includes(v.source) ? SOURCES : [...SOURCES, v.source];
  const readOnly = !canWrite;

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    const score = v.score === "" ? null : Number(v.score);
    if (score != null && (score < 0 || score > 100)) return setError("Score must be between 0 and 100.");
    const row = {
      name: v.name.trim(),
      phone: v.phone.trim() || null,
      email: v.email.trim().toLowerCase() || null,
      company: v.company.trim() || null,
      source: v.source,
      stage: v.stage,
      value: v.value === "" ? null : Number(v.value),
      score: score == null ? null : Math.round(score),
      assigned_to: v.assigned_to || null,
      follow_up_date: v.follow_up_date || null,
      notes: v.notes.trim() || null,
    };
    setBusy(true);
    const res = lead
      ? await supabase.from("leads").update(row).eq("workspace_id", workspace.id).eq("id", lead.id).select().single()
      : await supabase.from("leads").insert({ ...row, workspace_id: workspace.id, created_by: me }).select().single();
    setBusy(false);
    if (res.error) return setError(res.error.message);
    onSaved(res.data, lead ? (lead.stage as Stage) : null);
  }

  async function remove() {
    if (!lead || !confirm(`Delete the lead "${lead.name}"? This cannot be undone.`)) return;
    setBusy(true);
    const { error } = await supabase.from("leads").delete().eq("workspace_id", workspace.id).eq("id", lead.id);
    setBusy(false);
    if (error) return setError(error.message);
    onDeleted(lead.id);
  }

  const answers = lead?.form_answers && typeof lead.form_answers === "object" && !Array.isArray(lead.form_answers)
    ? Object.entries(lead.form_answers).filter(([, a]) => a !== null && a !== "")
    : [];
  const form = lead?.form_id ? formFields[lead.form_id] : undefined;
  const labelFor = (k: string) => form?.fields.find((f) => f.key === k)?.label ?? humanize(k);

  return (
    <Modal title={lead ? (readOnly ? lead.name : "Edit lead") : "Add lead"} onClose={onClose} wide>
      <form className="space-y-4" onSubmit={save}>
        {error && <Alert>{error}</Alert>}
        {lead?.converted_client_id && <Alert tone="success">This lead is already a client.</Alert>}
        <fieldset disabled={readOnly || busy} className="grid gap-3 sm:grid-cols-2">
          <Field label="Contact name">
            <Input required value={v.name} onChange={set("name")} />
          </Field>
          <Field label="Company">
            <Input value={v.company} onChange={set("company")} />
          </Field>
          <Field label="Phone">
            <Input type="tel" value={v.phone} onChange={set("phone")} />
          </Field>
          <Field label="Email">
            <Input type="email" value={v.email} onChange={set("email")} />
          </Field>
          <Field label="Where did this lead come from?">
            <Select value={v.source} onChange={set("source")}>
              {sources.map((s) => <option key={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Stage">
            <Select value={v.stage} onChange={set("stage")}>
              {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </Select>
          </Field>
          <Field label="Deal value (₹)">
            <Input type="number" min="0" step="0.01" inputMode="decimal" value={v.value} onChange={set("value")} />
          </Field>
          <Field label="Score (0 to 100)" hint="How likely is this lead to buy?">
            <Input type="number" min="0" max="100" step="1" inputMode="numeric" value={v.score} onChange={set("score")} />
          </Field>
          <Field label="Assigned to" hint={isAdmin ? undefined : "Only admins can give a lead to someone else."}>
            <Select value={v.assigned_to} onChange={set("assigned_to")} disabled={!isAdmin && v.assigned_to !== "" && v.assigned_to !== me}>
              <option value="">Nobody yet</option>
              {assignable.map((p) => (
                <option key={p.user_id} value={p.user_id}>{p.user_id === me ? `${p.full_name} (me)` : p.full_name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Follow-up date">
            <Input type="date" value={v.follow_up_date} onChange={set("follow_up_date")} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Notes">
              <Textarea rows={4} value={v.notes} onChange={set("notes")} />
            </Field>
          </div>
        </fieldset>

        {lead?.form_id !== undefined && lead?.form_id !== null && (
          <div className="rounded-md bg-slate-50 p-3 ring-1 ring-slate-200">
            <div className="mb-2 text-sm font-medium text-slate-700">
              Form answers{form ? ` from "${form.title}"` : ""}
            </div>
            {answers.length ? (
              <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
                {answers.map(([k, a]) => (
                  <div key={k}>
                    <dt className="text-xs text-slate-500">{labelFor(k)}</dt>
                    <dd className="whitespace-pre-wrap break-words">{typeof a === "object" ? JSON.stringify(a) : String(a)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-slate-500">No extra answers.</p>
            )}
          </div>
        )}

        {lead && (
          <p className="text-xs text-slate-500">
            Added {date(lead.created_at)}
            {lead.created_by ? ` by ${nameOf(people, lead.created_by) || "a team member"}` : " from a public form"}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {lead && isAdmin && canWrite && (
              <Button type="button" variant="danger" disabled={busy} onClick={remove}>Delete</Button>
            )}
            {lead && isAdmin && canWrite && !lead.converted_client_id && (
              <Button type="button" variant="secondary" disabled={busy} onClick={() => onConvert(lead)}>Make client</Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>{readOnly ? "Close" : "Cancel"}</Button>
            {!readOnly && <Button disabled={busy}>{busy ? "Saving…" : lead ? "Save" : "Add lead"}</Button>}
          </div>
        </div>
      </form>
    </Modal>
  );
}
