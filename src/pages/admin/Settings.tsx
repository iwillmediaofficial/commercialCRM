import { useEffect, useState, type FormEvent } from "react";
import { supabase, type Tables } from "../../lib/supabase";
import { INDIAN_STATES } from "../../lib/format";
import { uploadUpiQr, useUpiQr } from "../../lib/files";
import { Alert, Button, Card, Field, Input, Select, Spinner, Textarea } from "../../components/ui";

type S = Tables<"platform_settings">;

// Your payment details (shown to companies on their renewal screen) and subscription timings.
export default function Settings() {
  const [s, setS] = useState<S | null>(null);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  useEffect(() => {
    supabase.from("platform_settings").select("*").single().then(({ data }) => setS(data));
  }, []);

  if (!s) return <Spinner />;
  const text = (k: keyof S) => ({
    value: (s[k] as string | null) ?? "",
    onChange: (e: { target: { value: string } }) => setS({ ...s, [k]: e.target.value }),
  });
  const days = (k: "trial_days" | "grace_days" | "reminder_days") => ({
    type: "number",
    min: 0,
    required: true,
    value: s[k],
    onChange: (e: { target: { value: string } }) => setS({ ...s, [k]: Number(e.target.value) }),
  });

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!s) return;
    setMsg(null);
    const blank = (v: string | null) => v?.trim() || null;
    const gstin = blank(s.seller_gstin)?.toUpperCase() ?? null;
    if (gstin && !/^[0-9]{2}[A-Z0-9]{13}$/.test(gstin)) {
      return setMsg({ tone: "error", text: "GSTIN should be 15 characters: 2 digits, then 13 letters or numbers." });
    }
    const rate = Number(s.gst_rate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 28) {
      return setMsg({ tone: "error", text: "GST rate should be a number from 0 to 28." });
    }
    const { error } = await supabase
      .from("platform_settings")
      .update({
        trial_days: s.trial_days,
        grace_days: s.grace_days,
        reminder_days: s.reminder_days,
        bank_account_name: blank(s.bank_account_name),
        bank_name: blank(s.bank_name),
        bank_account_number: blank(s.bank_account_number),
        bank_ifsc: blank(s.bank_ifsc)?.toUpperCase() ?? null,
        upi_id: blank(s.upi_id),
        payment_note: blank(s.payment_note),
        product_name: s.product_name.trim() || "CRM",
        support_email: blank(s.support_email),
        support_phone: blank(s.support_phone),
        legal_updated_on: s.legal_updated_on,
        seller_legal_name: blank(s.seller_legal_name),
        seller_address: blank(s.seller_address),
        seller_state: blank(s.seller_state),
        seller_gstin: gstin,
        seller_pan: blank(s.seller_pan)?.toUpperCase() ?? null,
        sac_code: s.sac_code.trim() || "997331",
        gst_rate: rate,
        sub_invoice_prefix: s.sub_invoice_prefix.trim().toUpperCase() || "SUB",
      })
      .eq("id", true);
    setMsg(error ? { tone: "error", text: error.message } : { tone: "success", text: "Settings saved." });
  }

  return (
    <form className="space-y-4" onSubmit={save}>
      <Card title="Subscription timings">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Free trial (days)" hint="For new companies, unless you set their own.">
            <Input {...days("trial_days")} />
          </Field>
          <Field label="Grace period (days)" hint="After the end date, before going read-only.">
            <Input {...days("grace_days")} />
          </Field>
          <Field label="Reminder (days before end)" hint="Owners and admins get an in-app reminder.">
            <Input {...days("reminder_days")} />
          </Field>
        </div>
      </Card>
      <Card title="Your payment details">
        <p className="mb-3 text-sm text-slate-500">Companies see these on their Subscription page when they renew.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Account holder name"><Input {...text("bank_account_name")} /></Field>
          <Field label="Bank name"><Input {...text("bank_name")} /></Field>
          <Field label="Account number"><Input {...text("bank_account_number")} /></Field>
          <Field label="IFSC"><Input className="uppercase" {...text("bank_ifsc")} /></Field>
          <Field label="UPI ID"><Input placeholder="name@bank" {...text("upi_id")} /></Field>
          <Field label="Note for customers" hint="e.g. Send the UTR number after paying.">
            <Input {...text("payment_note")} />
          </Field>
          <div className="sm:col-span-2">
            <UpiQr path={s.upi_qr_path} onChange={(key) => setS({ ...s, upi_qr_path: key })} />
          </div>
        </div>
      </Card>
      <Card title="Product and support">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Product name" hint="Shown on the website and on subscription invoices.">
            <Input required {...text("product_name")} />
          </Field>
          <Field label="Support email"><Input type="email" placeholder="support@example.com" {...text("support_email")} /></Field>
          <Field label="Support phone"><Input placeholder="+91 98765 43210" {...text("support_phone")} /></Field>
          <Field label="Terms and privacy updated on" hint='Shows as "last updated" on the terms and privacy pages.'>
            <Input type="date" required {...text("legal_updated_on")} />
          </Field>
        </div>
      </Card>
      <Card title="Your business details for subscription invoices">
        <p className="mb-3 text-sm text-slate-500">
          Used on the invoice companies get when they pay you. Invoices already issued keep the details they were issued with.
          Without a GSTIN, invoices are issued without GST.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Legal business name"><Input {...text("seller_legal_name")} /></Field>
          <Field label="State">
            <Select {...text("seller_state")}>
              <option value="">Choose a state</option>
              {INDIAN_STATES.map(([name, code]) => <option key={code} value={name}>{name} ({code})</option>)}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Address"><Textarea {...text("seller_address")} /></Field>
          </div>
          <Field label="GSTIN" hint="Leave empty if you are not registered for GST.">
            <Input className="uppercase" maxLength={15} placeholder="27ABCDE1234F1Z5" {...text("seller_gstin")} />
          </Field>
          <Field label="PAN"><Input className="uppercase" maxLength={10} {...text("seller_pan")} /></Field>
          <Field label="SAC code" hint="Confirm the right code with your CA.">
            <Input required {...text("sac_code")} />
          </Field>
          <Field label="GST rate (%)" hint="Plan prices include GST.">
            <Input
              type="number"
              min={0}
              max={28}
              step="0.01"
              required
              value={s.gst_rate}
              onChange={(e) => setS({ ...s, gst_rate: e.target.value === "" ? ("" as unknown as number) : Number(e.target.value) })}
            />
          </Field>
          <Field label="Invoice number prefix" hint={`Invoices are numbered like ${s.sub_invoice_prefix.trim().toUpperCase() || "SUB"}/2026-27/0001.`}>
            <Input className="uppercase" required {...text("sub_invoice_prefix")} />
          </Field>
        </div>
      </Card>
      <div className="flex items-center gap-3">
        <Button>Save settings</Button>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      </div>
    </form>
  );
}

// Saved right away, like logos elsewhere.
function UpiQr({ path, onChange }: { path: string | null; onChange: (key: string | null) => void }) {
  const url = useUpiQr(path);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function pick(file: File | undefined) {
    if (!file) return;
    setError("");
    setBusy(true);
    const res = await uploadUpiQr(file);
    setBusy(false);
    if (!res.ok) return setError(res.message);
    onChange(res.key);
  }

  async function remove() {
    setError("");
    const { error } = await supabase.from("platform_settings").update({ upi_qr_path: null }).eq("id", true);
    if (error) return setError(error.message);
    onChange(null);
  }

  return (
    <div>
      <span className="mb-1 block text-sm font-medium text-slate-700">UPI QR code</span>
      <div className="flex items-center gap-3">
        <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-lg bg-slate-50 text-xs text-slate-400 ring-1 ring-slate-200">
          {path ? (url ? <img src={url} alt="UPI QR code" className="h-full w-full object-contain" /> : "Loading…") : "None"}
        </div>
        <label className="cursor-pointer rounded-lg bg-white px-3 py-2 text-sm font-medium shadow-sm ring-1 ring-slate-200 hover:bg-slate-50">
          {busy ? "Uploading…" : path ? "Replace" : "Upload"}
          <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={busy} onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        {path && <Button type="button" variant="secondary" onClick={remove}>Remove</Button>}
      </div>
      <span className="mt-1 block text-xs text-slate-500">Companies can scan it on their Subscription page. Saved right away.</span>
      {error && <div className="mt-2"><Alert>{error}</Alert></div>}
    </div>
  );
}
