import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { supabase, type Tables } from "../../../lib/supabase";
import type { Json } from "../../../lib/database.types";
import { useWorkspace } from "../../../lib/workspace";
import { Alert, Button, Card, Field, Input, Spinner, Textarea } from "../../../components/ui";

type Settings = Tables<"workspace_settings">;

// Text fields edited as strings; empty means "not set".
const TEXT_FIELDS = [
  "company_name", "legal_name", "address", "city", "state", "postal_code", "country", "phone", "email", "website",
  "gstin", "pan", "invoice_prefix", "invoice_footer", "bank_details",
] as const;
type TextField = (typeof TEXT_FIELDS)[number];

const NUMBER_FIELDS = ["default_tax_rate", "next_invoice_number", "default_payment_terms_days", "recurring_lead_days"] as const;
type NumberField = (typeof NUMBER_FIELDS)[number];

const RULES: [string, string, string][] = [
  ["task_assigned", "Task assigned", "Tell people when a work item is assigned to them."],
  ["due_date_reminders", "Due date reminders", "Remind assignees about work items due soon."],
  ["lead_assigned", "Lead assigned", "Tell people when a lead is assigned to them."],
  ["billing_alerts", "Billing alerts", "Tell admins about overdue invoices and new recurring invoices."],
  ["renewal_reminders", "Subscription renewal reminders", "Remind admins before the CRM subscription ends."],
];

type Form = Record<TextField, string> & Record<NumberField, string> & { rules: Record<string, boolean> };

function toForm(s: Settings): Form {
  const f = {} as Form;
  for (const k of TEXT_FIELDS) f[k] = (s[k] as string | null) ?? "";
  for (const k of NUMBER_FIELDS) f[k] = String(s[k] ?? "");
  const stored = (s.notification_rules && typeof s.notification_rules === "object" && !Array.isArray(s.notification_rules)
    ? s.notification_rules
    : {}) as Record<string, unknown>;
  // Rules are on unless switched off.
  f.rules = Object.fromEntries(RULES.map(([k]) => [k, stored[k] !== false]));
  return f;
}

export default function WorkspaceSettings() {
  const { workspace, isAdmin, role, canWrite } = useWorkspace();
  const supportView = role === null;
  const [settings, setSettings] = useState<Settings | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isAdmin && !supportView) return;
    (async () => {
      const { data, error } = await supabase.from("workspace_settings").select("*").eq("workspace_id", workspace.id).maybeSingle();
      if (error) setError(error.message);
      setSettings(data);
      if (data) setForm(toForm(data));
      setLoading(false);
    })();
  }, [workspace.id, isAdmin, supportView]);

  if (!isAdmin && !supportView) {
    return (
      <Card title="Settings">
        <Alert tone="info">Workspace settings are managed by your company's owner and admins. Ask them if something needs changing.</Alert>
      </Card>
    );
  }
  if (loading) return <Spinner />;
  if (!settings || !form) return <Alert>{error || "Settings for this workspace could not be found."}</Alert>;

  const readOnly = !canWrite;
  const set = (k: TextField | NumberField, v: string) => {
    setSaved(false);
    setForm({ ...form, [k]: v });
  };
  const text = (k: TextField, label: string, props: { type?: string; hint?: string; maxLength?: number; placeholder?: string } = {}) => (
    <Field label={label} hint={props.hint}>
      <Input
        type={props.type ?? "text"}
        maxLength={props.maxLength}
        placeholder={props.placeholder}
        disabled={readOnly}
        value={form[k]}
        onChange={(e) => set(k, e.target.value)}
      />
    </Field>
  );
  const num = (k: NumberField, label: string, props: { min?: number; max?: number; step?: string; hint?: string } = {}) => (
    <Field label={label} hint={props.hint}>
      <Input
        type="number"
        required
        min={props.min}
        max={props.max}
        step={props.step ?? "1"}
        disabled={readOnly}
        value={form[k]}
        onChange={(e) => set(k, e.target.value)}
      />
    </Field>
  );

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form || !settings) return;
    setError("");
    setSaved(false);
    setSaving(true);
    const blank = (s: string) => s.trim() || null;
    const existing = (settings.notification_rules && typeof settings.notification_rules === "object" && !Array.isArray(settings.notification_rules)
      ? settings.notification_rules
      : {}) as Record<string, unknown>;
    const { data, error } = await supabase
      .from("workspace_settings")
      .update({
        company_name: blank(form.company_name),
        legal_name: blank(form.legal_name),
        address: blank(form.address),
        city: blank(form.city),
        state: blank(form.state),
        postal_code: blank(form.postal_code),
        country: blank(form.country),
        phone: blank(form.phone),
        email: blank(form.email),
        website: blank(form.website),
        gstin: blank(form.gstin.toUpperCase()),
        pan: blank(form.pan.toUpperCase()),
        default_tax_rate: Number(form.default_tax_rate),
        invoice_prefix: form.invoice_prefix.trim(),
        next_invoice_number: Number(form.next_invoice_number),
        default_payment_terms_days: Number(form.default_payment_terms_days),
        invoice_footer: blank(form.invoice_footer),
        bank_details: blank(form.bank_details),
        recurring_lead_days: Number(form.recurring_lead_days),
        notification_rules: { ...existing, ...form.rules } as Json,
      })
      .eq("workspace_id", workspace.id)
      .select()
      .single();
    setSaving(false);
    if (error) return setError(error.message);
    setSettings(data);
    setForm(toForm(data));
    setSaved(true);
  }

  return (
    <form className="space-y-4" onSubmit={save}>
      {readOnly && (
        <Alert tone="warning">
          {supportView ? "Support view: settings are read-only." : "Settings are read-only until the subscription is renewed."}
        </Alert>
      )}

      <Section title="Company profile" hint="Shown on your invoices.">
        {text("company_name", "Company name")}
        {text("legal_name", "Legal name", { hint: "If different from the company name" })}
        <div className="sm:col-span-2">
          <Field label="Address">
            <Textarea rows={2} disabled={readOnly} value={form.address} onChange={(e) => set("address", e.target.value)} />
          </Field>
        </div>
        {text("city", "City")}
        {text("state", "State")}
        {text("postal_code", "PIN code", { maxLength: 10 })}
        {text("country", "Country")}
        {text("phone", "Phone", { type: "tel" })}
        {text("email", "Email", { type: "email" })}
        {text("website", "Website", { placeholder: "example.com" })}
        <div>
          <span className="mb-1 block text-sm font-medium text-slate-700">Logo</span>
          <p className="text-xs text-slate-500">File uploads arrive with file storage.</p>
        </div>
      </Section>

      <Section title="Tax (GST)">
        {text("gstin", "GSTIN", { maxLength: 15, placeholder: "22AAAAA0000A1Z5" })}
        {text("pan", "PAN", { maxLength: 10, placeholder: "AAAAA0000A" })}
        {num("default_tax_rate", "Default GST rate (%)", { min: 0, max: 100, step: "0.01", hint: "Used for new invoice lines." })}
        <Field label="Currency" hint="All amounts are in Indian Rupees.">
          <Input disabled value={`${settings.currency} (₹)`} />
        </Field>
      </Section>

      <Section title="Invoicing">
        {text("invoice_prefix", "Invoice number prefix", { placeholder: "INV-" })}
        {num("next_invoice_number", "Next invoice number", {
          min: 1,
          hint: `Next invoice: ${form.invoice_prefix}${form.next_invoice_number || 1}`,
        })}
        {num("default_payment_terms_days", "Payment due in (days)", { min: 0, hint: "Default due date for new invoices." })}
        {num("recurring_lead_days", "Create recurring invoices (days before)", {
          min: 0,
          max: 60,
          hint: "How many days before the billing date a recurring invoice is prepared.",
        })}
        <div className="sm:col-span-2">
          <Field label="Bank details for payment" hint="Account name, number, IFSC, UPI ID. Printed on invoices.">
            <Textarea rows={3} disabled={readOnly} value={form.bank_details} onChange={(e) => set("bank_details", e.target.value)} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Invoice footer" hint="For example: thank-you note or terms.">
            <Textarea rows={2} disabled={readOnly} value={form.invoice_footer} onChange={(e) => set("invoice_footer", e.target.value)} />
          </Field>
        </div>
      </Section>

      <Card title="In-app notifications">
        <p className="mb-3 text-sm text-slate-500">Choose which alerts appear in the bell for your team. Nothing is sent by email.</p>
        <div className="space-y-3">
          {RULES.map(([key, label, hint]) => (
            <label key={key} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                disabled={readOnly}
                checked={form.rules[key]}
                onChange={(e) => {
                  setSaved(false);
                  setForm({ ...form, rules: { ...form.rules, [key]: e.target.checked } });
                }}
              />
              <span>
                <span className="font-medium text-slate-700">{label}</span>
                <span className="block text-xs text-slate-500">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </Card>

      {error && <Alert>{error}</Alert>}
      {saved && <Alert tone="success">Settings saved.</Alert>}
      {!readOnly && (
        <div className="flex justify-end">
          <Button disabled={saving}>{saving ? "Saving…" : "Save settings"}</Button>
        </div>
      )}
    </form>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Card title={title}>
      {hint && <p className="-mt-2 mb-3 text-sm text-slate-500">{hint}</p>}
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </Card>
  );
}
