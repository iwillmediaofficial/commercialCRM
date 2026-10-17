import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { supabase, type Tables } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { useWorkspace } from "../../lib/workspace";
import { StatusBadge } from "../../lib/status";
import { MAX_FILE_MB, uploadFile, useUpiQr } from "../../lib/files";
import { PERIOD_LABEL, date, inr } from "../../lib/format";
import { Alert, Button, Card, Field, Input, Select } from "../../components/ui";

const PERIODS = [
  ["monthly", "Monthly", "price_monthly"],
  ["quarterly", "Quarterly", "price_quarterly"],
  ["half_yearly", "Half-yearly", "price_half_yearly"],
  ["yearly", "Yearly", "price_yearly"],
] as const;
type Period = (typeof PERIODS)[number][0];
type PaymentMode = Tables<"renewal_requests">["payment_mode"];
type SubPayment = Tables<"subscription_payments"> & { plan: { name: string } | null };
type Plan = Tables<"plans">;
type Request = Tables<"renewal_requests"> & { plan: { name: string } | null };

// Subscription status, how to pay, and a form to tell the Super Admin you paid.
export default function Billing() {
  const { workspace, plan, status, isAdmin } = useWorkspace();
  const { session } = useAuth();
  const [settings, setSettings] = useState<Tables<"platform_settings"> | null>(null);
  const [requests, setRequests] = useState<Request[]>([]);
  const [payments, setPayments] = useState<SubPayment[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  // Renew on the current plan, or pick another one to upgrade or change.
  const [planId, setPlanId] = useState("");
  const sellable = plans.filter((p) => PERIODS.some(([, , k]) => p[k] != null));
  const chosenPlan = sellable.find((p) => p.id === planId) ?? sellable.find((p) => p.id === plan?.id) ?? sellable[0];
  const available = PERIODS.filter(([, , k]) => chosenPlan?.[k] != null);
  const [period, setPeriod] = useState<Period | "">("");
  const qr = useUpiQr(settings?.upi_qr_path);
  const [mode, setMode] = useState<PaymentMode>("upi");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [receipt, setReceipt] = useState<File | null>(null);
  const [receiptKey, setReceiptKey] = useState(0); // resets the file input
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    const [{ data: s }, { data: r }, { data: p }, { data: pl }] = await Promise.all([
      supabase.from("platform_settings").select("*").maybeSingle(),
      supabase.from("renewal_requests").select("*, plan:plans(name)").eq("workspace_id", workspace.id).order("created_at", { ascending: false }),
      // Only owners and admins can read these; others get an empty list.
      isAdmin
        ? supabase
            .from("subscription_payments")
            .select("*, plan:plans(name)")
            .eq("workspace_id", workspace.id)
            .order("paid_on", { ascending: false })
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] }),
      supabase.from("plans").select("*").eq("is_active", true).order("sort_order").order("name"),
    ]);
    setSettings(s);
    setPlans(pl ?? []);
    setRequests((r ?? []) as Request[]);
    setPayments((p ?? []) as SubPayment[]);
  }, [workspace.id, isAdmin]);
  useEffect(() => {
    load();
  }, [load]);

  const chosen = (available.some(([v]) => v === period) ? period : available[0]?.[0]) as Period | undefined;
  const price = chosen ? chosenPlan?.[PERIODS.find((p) => p[0] === chosen)![2]] : null;
  const pending = requests.some((r) => r.status === "pending");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!chosen || !chosenPlan) return;
    setMessage(null);
    setSending(true);
    let receiptPath: string | null = null;
    if (receipt) {
      if (!receipt.type.startsWith("image/") && receipt.type !== "application/pdf") {
        setSending(false);
        return setMessage({ tone: "error", text: "The receipt should be an image or a PDF." });
      }
      const up = await uploadFile({ workspaceId: workspace.id, entityType: "renewal", file: receipt });
      if (!up.ok) {
        setSending(false);
        return setMessage({ tone: "error", text: `Receipt: ${up.message}` });
      }
      receiptPath = up.file.r2_key;
    }
    const { error } = await supabase.from("renewal_requests").insert({
      workspace_id: workspace.id,
      plan_id: chosenPlan.id,
      period: chosen,
      amount: Number(price ?? 0), // the database sets the real amount from the plan
      payment_mode: mode,
      reference_no: reference || null,
      note: note || null,
      receipt_path: receiptPath,
      requested_by: session?.user.id,
    });
    setSending(false);
    if (error) {
      const text = error.code === "42501" ? "You can't send a renewal for this company right now." : error.message;
      return setMessage({ tone: "error", text });
    }
    setMessage({ tone: "success", text: "Sent. The Super Admin will confirm your payment and extend the subscription." });
    setReference("");
    setNote("");
    setReceipt(null);
    setReceiptKey((k) => k + 1);
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

      {settings && (settings.upi_id || settings.bank_account_number || settings.upi_qr_path) && (
        <Card title="How to pay">
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {settings.upi_id && (<><dt className="text-slate-500">UPI</dt><dd className="font-mono">{settings.upi_id}</dd></>)}
            {settings.bank_account_name && (<><dt className="text-slate-500">Account name</dt><dd>{settings.bank_account_name}</dd></>)}
            {settings.bank_name && (<><dt className="text-slate-500">Bank</dt><dd>{settings.bank_name}</dd></>)}
            {settings.bank_account_number && (<><dt className="text-slate-500">Account number</dt><dd className="font-mono">{settings.bank_account_number}</dd></>)}
            {settings.bank_ifsc && (<><dt className="text-slate-500">IFSC</dt><dd className="font-mono">{settings.bank_ifsc}</dd></>)}
          </dl>
          {settings.payment_note && <p className="mt-3 text-sm text-slate-600">{settings.payment_note}</p>}
          {qr && (
            <div className="mt-3">
              <img src={qr} alt="UPI QR code" className="h-44 w-44 rounded-lg bg-white object-contain ring-1 ring-slate-200" />
              <p className="mt-1 text-xs text-slate-500">Scan with any UPI app.</p>
            </div>
          )}
        </Card>
      )}

      <Card title="I have paid">
        {!isAdmin ? (
          <p className="text-sm text-slate-500">Only the company owner or an admin can renew.</p>
        ) : status === "suspended" ? (
          <p className="text-sm text-slate-500">This company is suspended. Contact the Super Admin to renew.</p>
        ) : available.length === 0 ? (
          <p className="text-sm text-slate-500">No plan has an online price yet. Contact the Super Admin to renew.</p>
        ) : pending ? (
          <Alert tone="info">Your last payment is waiting for confirmation.</Alert>
        ) : (
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
            {sellable.length > 1 && (
              <div className="sm:col-span-2">
                <Field
                  label="Plan"
                  hint={chosenPlan && chosenPlan.id !== plan?.id ? "The Super Admin moves you to this plan when they confirm the payment." : undefined}
                >
                  <Select value={chosenPlan?.id} onChange={(e) => setPlanId(e.target.value)}>
                    {sellable.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.id === plan?.id ? " (current plan)" : ""} · {p.staff_limit ? `${p.staff_limit} seats` : "unlimited seats"} ·{" "}
                        {p.client_limit ? `${p.client_limit} clients` : "unlimited clients"}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            )}
            <Field label="Period">
              <Select value={chosen} onChange={(e) => setPeriod(e.target.value as Period)}>
                {available.map(([v, label, k]) => (
                  <option key={v} value={v}>{label} · ₹{Number(chosenPlan?.[k]).toLocaleString("en-IN")}</option>
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
            <div className="sm:col-span-2">
                <Field label="Payment screenshot (optional)" hint={`An image or PDF, up to ${MAX_FILE_MB} MB.`}>
                  <input
                    key={receiptKey}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,application/pdf"
                    className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-slate-200"
                    onChange={(e) => setReceipt(e.target.files?.[0] ?? null)}
                  />
                </Field>
              </div>
            <div className="sm:col-span-2"><Button disabled={sending}>{sending ? "Sending…" : "Send for confirmation"}</Button></div>
          </form>
        )}
        {message && <div className="mt-3"><Alert tone={message.tone}>{message.text}</Alert></div>}
      </Card>

      {isAdmin && (
        <Card title="Payments and invoices">
          {payments.length === 0 ? (
            <p className="text-sm text-slate-500">No payments yet. Once a payment is confirmed, its invoice shows up here.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-slate-500">
                  <tr><th className="py-2">Paid on</th><th>Plan</th><th>Period</th><th className="text-right">Amount</th><th className="pl-4">Invoice</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td className="py-2">{date(p.paid_on)}</td>
                      <td>{p.plan?.name}</td>
                      <td>
                        {p.period ? PERIOD_LABEL[p.period] : ""}
                        <div className="text-xs text-slate-500">{date(p.valid_from)} to {date(p.valid_until)}</div>
                      </td>
                      <td className="text-right">{inr(p.amount)}</td>
                      <td className="whitespace-nowrap pl-4">
                        {p.invoice_no ? (
                          <Link className="text-indigo-600 hover:underline" to={`/invoice/subscription/${p.id}`}>{p.invoice_no}</Link>
                        ) : (
                          <span className="text-xs text-slate-400">Not available</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {requests.length > 0 && (
        <Card title="History">
          <ul className="divide-y divide-slate-100 text-sm">
            {requests.map((r) => (
              <li key={r.id} className="flex justify-between py-2">
                <span>{new Date(r.created_at).toLocaleDateString()} · {r.plan?.name ? `${r.plan.name} · ` : ""}{r.period.replace("_", " ")} · ₹{Number(r.amount).toLocaleString("en-IN")}</span>
                <span className="capitalize">{r.status}{r.admin_note && ` · ${r.admin_note}`}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
