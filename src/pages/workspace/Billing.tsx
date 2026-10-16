import { useCallback, useEffect, useState, type FormEvent } from "react";
import { supabase, type Tables } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { useWorkspace } from "../../lib/workspace";
import { StatusBadge } from "../../lib/status";
import { Alert, Button, Card, Field, Input, Select } from "../../components/ui";

const PERIODS = [
  ["monthly", "Monthly", "price_monthly"],
  ["quarterly", "Quarterly", "price_quarterly"],
  ["half_yearly", "Half-yearly", "price_half_yearly"],
  ["yearly", "Yearly", "price_yearly"],
] as const;
type Period = (typeof PERIODS)[number][0];
type PaymentMode = Tables<"renewal_requests">["payment_mode"];

// Subscription status, how to pay, and a form to tell the Super Admin you paid.
export default function Billing() {
  const { workspace, plan, status } = useWorkspace();
  const { session } = useAuth();
  const [settings, setSettings] = useState<Tables<"platform_settings"> | null>(null);
  const [requests, setRequests] = useState<Tables<"renewal_requests">[]>([]);
  const available = PERIODS.filter(([, , k]) => plan?.[k] != null);
  const [period, setPeriod] = useState<Period | "">("");
  const [mode, setMode] = useState<PaymentMode>("upi");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    const [{ data: s }, { data: r }] = await Promise.all([
      supabase.from("platform_settings").select("*").maybeSingle(),
      supabase.from("renewal_requests").select("*").eq("workspace_id", workspace.id).order("created_at", { ascending: false }),
    ]);
    setSettings(s);
    setRequests(r ?? []);
  }, [workspace.id]);
  useEffect(() => {
    load();
  }, [load]);

  const chosen = (period || available[0]?.[0]) as Period | undefined;
  const price = chosen ? plan?.[PERIODS.find((p) => p[0] === chosen)![2]] : null;
  const pending = requests.some((r) => r.status === "pending");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!chosen || !plan) return;
    setMessage(null);
    const { error } = await supabase.from("renewal_requests").insert({
      workspace_id: workspace.id,
      plan_id: plan.id,
      period: chosen,
      amount: Number(price ?? 0), // the database sets the real amount from the plan
      payment_mode: mode,
      reference_no: reference || null,
      note: note || null,
      requested_by: session?.user.id,
    });
    if (error) return setMessage({ tone: "error", text: error.message });
    setMessage({ tone: "success", text: "Sent. The Super Admin will confirm your payment and extend the subscription." });
    setReference("");
    setNote("");
    load();
  }

  return (
    <>
      <Card title="Subscription">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-medium">{plan?.name}</span>
          <StatusBadge status={status} />
          <span className="text-slate-500">Valid until {new Date(workspace.valid_until).toLocaleDateString()}</span>
        </div>
      </Card>

      {settings && (settings.upi_id || settings.bank_account_number) && (
        <Card title="How to pay">
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {settings.upi_id && (<><dt className="text-slate-500">UPI</dt><dd className="font-mono">{settings.upi_id}</dd></>)}
            {settings.bank_account_name && (<><dt className="text-slate-500">Account name</dt><dd>{settings.bank_account_name}</dd></>)}
            {settings.bank_name && (<><dt className="text-slate-500">Bank</dt><dd>{settings.bank_name}</dd></>)}
            {settings.bank_account_number && (<><dt className="text-slate-500">Account number</dt><dd className="font-mono">{settings.bank_account_number}</dd></>)}
            {settings.bank_ifsc && (<><dt className="text-slate-500">IFSC</dt><dd className="font-mono">{settings.bank_ifsc}</dd></>)}
          </dl>
          {settings.payment_note && <p className="mt-3 text-sm text-slate-600">{settings.payment_note}</p>}
        </Card>
      )}

      <Card title="I have paid">
        {available.length === 0 ? (
          <p className="text-sm text-slate-500">Your plan's price is set by the Super Admin. Contact them to renew.</p>
        ) : pending ? (
          <Alert tone="info">Your last payment is waiting for confirmation.</Alert>
        ) : (
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
            <Field label="Period">
              <Select value={chosen} onChange={(e) => setPeriod(e.target.value as Period)}>
                {available.map(([v, label, k]) => (
                  <option key={v} value={v}>{label} · ₹{Number(plan?.[k]).toLocaleString("en-IN")}</option>
                ))}
              </Select>
            </Field>
            <Field label="Paid by">
              <Select value={mode} onChange={(e) => setMode(e.target.value as PaymentMode)}>
                <option value="upi">UPI</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="cheque">Cheque</option>
                <option value="cash">Cash</option>
                <option value="other">Other</option>
              </Select>
            </Field>
            <Field label="Reference / UTR number"><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
            <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <div className="sm:col-span-2"><Button>Send for confirmation</Button></div>
          </form>
        )}
        {message && <div className="mt-3"><Alert tone={message.tone}>{message.text}</Alert></div>}
      </Card>

      {requests.length > 0 && (
        <Card title="History">
          <ul className="divide-y divide-slate-100 text-sm">
            {requests.map((r) => (
              <li key={r.id} className="flex justify-between py-2">
                <span>{new Date(r.created_at).toLocaleDateString()} · {r.period.replace("_", " ")} · ₹{Number(r.amount).toLocaleString("en-IN")}</span>
                <span className="capitalize">{r.status}{r.admin_note && ` · ${r.admin_note}`}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
