import { useState, type FormEvent } from "react";
import { supabase, type Tables } from "../../../lib/supabase";
import { useWorkspace } from "../../../lib/workspace";
import { nameOf, type Person } from "../../../lib/members";
import { date } from "../../../lib/format";
import { Alert, Button, Field, Input, Modal, Select, Textarea } from "../../../components/ui";
import { Attachments } from "../../../components/Files";
import { SOURCES, STAGES, answerText, humanize, type FormField, type Stage } from "./leadShared";
import LeadTimeline, { ago } from "./LeadTimeline";
import { useContactLog } from "./ContactPrompt";
import { LOST_REASONS, fromLocalInput, telLink, toLocalInput, waLink } from "./followUp";

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
  // Inside the lead drawer: no popup frame and no tab strip of its own; the drawer's tabs drive `tab`.
  bare?: boolean;
  tab?: "details" | "timeline";
  onTabChange?: (tab: "details" | "timeline") => void;
};

export default function LeadModal({ lead, people, me, formFields, onClose, onSaved, onDeleted, onConvert, bare, tab: tabProp, onTabChange }: Props) {
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
    follow_up_at: toLocalInput(lead?.follow_up_at),
    lost_pick: lead?.lost_reason ? (LOST_REASONS.includes(lead.lost_reason) ? lead.lost_reason : "Other") : "",
    lost_other: lead?.lost_reason && !LOST_REASONS.includes(lead.lost_reason) ? lead.lost_reason : "",
    first_remark: "",
  });
  const [ownTab, setOwnTab] = useState<"details" | "timeline">("details");
  const tab = tabProp ?? ownTab;
  const setTab = (t: "details" | "timeline") => (onTabChange ? onTabChange(t) : setOwnTab(t));
  const { logContact } = useContactLog();
  // Values the timeline changed (a call can move the lead on, or set the next follow-up).
  const [live, setLive] = useState<Partial<Lead>>({});
  const current = lead ? { ...lead, ...live } : null;
  const tel = telLink(current?.phone);
  const wa = waLink(current?.phone);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // A call or the timeline changed the lead (stage, next follow-up).
  function applyPatch(patch: Partial<Lead>) {
    setLive((x) => ({ ...x, ...patch }));
    // Keep the Details form in step so saving it later doesn't undo the change.
    setV((f) => ({
      ...f,
      ...(patch.stage ? { stage: patch.stage as Stage } : {}),
      ...("follow_up_at" in patch ? { follow_up_at: toLocalInput(patch.follow_up_at) } : {}),
    }));
  }
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
    if (!v.name.trim()) return setError("Enter the contact's name.");
    const score = v.score === "" ? null : Number(v.score);
    if (score != null && (score < 0 || score > 100)) return setError("Score must be between 0 and 100.");
    const lostReason = v.stage === "lost" ? (v.lost_pick === "Other" ? v.lost_other.trim() || "Other" : v.lost_pick) : null;
    if (v.stage === "lost" && !lostReason) return setError("Pick why the lead was lost.");
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
      follow_up_at: fromLocalInput(v.follow_up_at),
      lost_reason: lostReason,
    };
    setBusy(true);
    const res = lead
      ? await supabase.from("leads").update(row).eq("workspace_id", workspace.id).eq("id", lead.id).select().single()
      : await supabase.from("leads").insert({ ...row, workspace_id: workspace.id, created_by: me }).select().single();
    if (res.error) {
      setBusy(false);
      return setError(res.error.message);
    }
    let saved = res.data;
    if (!lead && v.first_remark.trim()) {
      const r = await supabase
        .from("lead_activities")
        .insert({ workspace_id: workspace.id, lead_id: saved.id, kind: "remark", body: v.first_remark.trim(), created_by: me });
      if (r.error) {
        setBusy(false);
        return setError(`The lead was added, but the remark wasn't saved: ${r.error.message}`);
      }
      saved = { ...saved, last_remark: v.first_remark.trim().slice(0, 300), last_remark_at: new Date().toISOString() };
    }
    setBusy(false);
    onSaved(saved, lead ? (lead.stage as Stage) : null);
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

  const body = (
    <>
      {lead && (tel || wa) && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {tel && (
            <a
              href={tel}
              onClick={() => {
                setTab("timeline");
                logContact(lead, "call", applyPatch);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-700"
            >
              Call {current?.phone}
            </a>
          )}
          {wa && (
            <a
              href={wa}
              target="_blank"
              rel="noreferrer"
              onClick={() => {
                setTab("timeline");
                logContact(lead, "whatsapp", applyPatch);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-green-700"
            >
              WhatsApp
            </a>
          )}
          <span className="text-xs text-slate-500">Tapping these logs the contact. You'll be asked how it went.</span>
        </div>
      )}
      {lead && !bare && (
        <div className="mb-4 flex gap-1 border-b border-slate-200" role="tablist">
          {([["details", "Details"], ["timeline", "Timeline"]] as const).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {lead && tab === "timeline" ? (
        <div className="space-y-4">
          <LeadTimeline
            leadId={lead.id}
            stage={current!.stage}
            followUpAt={current!.follow_up_at}
            onLeadChanged={applyPatch}
            people={people}
            me={me}
            forms={formFields}
          />
          <div className="flex justify-end">
            <Button type="button" variant="secondary" onClick={onClose}>Close</Button>
          </div>
        </div>
      ) : (
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
          {v.stage === "lost" ? (
            <Field label="Why was it lost?">
              <Select value={v.lost_pick} onChange={set("lost_pick")}>
                <option value="">Pick a reason</option>
                {LOST_REASONS.map((r) => <option key={r}>{r}</option>)}
              </Select>
            </Field>
          ) : (
            <Field label="Next follow-up" hint={v.stage === "won" ? "Won leads don't need follow-ups." : undefined}>
              <Input type="datetime-local" value={v.follow_up_at} onChange={set("follow_up_at")} disabled={v.stage === "won"} />
            </Field>
          )}
          {v.stage === "lost" && v.lost_pick === "Other" && (
            <Field label="What happened?">
              <Input maxLength={200} value={v.lost_other} onChange={set("lost_other")} />
            </Field>
          )}
          {!lead && (
            <div className="sm:col-span-2">
              <Field label="First remark" hint="Optional. It goes on the lead's timeline, where you can add more later.">
                <Textarea rows={3} maxLength={5000} value={v.first_remark} onChange={set("first_remark")} />
              </Field>
            </div>
          )}
        </fieldset>

        {current?.last_remark && (
          <button
            type="button"
            onClick={() => setTab("timeline")}
            className="block w-full rounded-md bg-brand-50/60 p-3 text-left ring-1 ring-brand-100 hover:bg-brand-50"
          >
            <span className="mb-1 block text-xs font-medium text-brand-700">
              Latest remark{current.last_remark_at ? ` · ${ago(current.last_remark_at)}` : ""} · see timeline
            </span>
            <span className="line-clamp-2 whitespace-pre-wrap break-words text-sm text-slate-800">{current.last_remark}</span>
          </button>
        )}

        {lead && (lead.form_id || answers.length > 0) && (
          <div className="rounded-md bg-slate-50 p-3 ring-1 ring-slate-200">
            <div className="mb-2 text-sm font-medium text-slate-700">
              Form answers{form ? ` from "${form.title}"` : lead.import_id ? " (imported)" : ""}
            </div>
            {answers.length ? (
              <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
                {answers.map(([k, a]) => (
                  <div key={k}>
                    <dt className="text-xs text-slate-500">{labelFor(k)}</dt>
                    <dd className="whitespace-pre-wrap break-words">{answerText(a)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-slate-500">No extra answers.</p>
            )}
          </div>
        )}

        {lead && (
          <Attachments
            workspaceId={workspace.id}
            entityType="lead"
            entityId={lead.id}
            canUpload={canWrite}
            canDelete={(f) => canWrite && (f.uploaded_by === me || isAdmin)}
          />
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
      )}
    </>
  );

  if (bare) return body;
  return (
    <Modal title={lead ? (readOnly ? lead.name : `Lead: ${lead.name}`) : "Add lead"} onClose={onClose} wide>
      {body}
    </Modal>
  );
}
