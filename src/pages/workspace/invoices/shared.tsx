import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { supabase, type Tables } from "../../../lib/supabase";
import type { Database } from "../../../lib/database.types";
import { useAuth } from "../../../lib/auth";
import { useWorkspace } from "../../../lib/workspace";
import { date, inr, MODE_LABEL, MODES, type PaymentMode } from "../../../lib/format";
import { useFileUrl } from "../../../lib/files";
import { Attachments } from "../../../components/Files";
import { Alert, Badge, Button, Card, Drawer, Empty, Field, Input, Modal, Select, Spinner, Textarea } from "../../../components/ui";

// ---------------------------------------------------------------------------
// Types and small helpers
// ---------------------------------------------------------------------------
export type InvoiceRow = Database["public"]["Views"]["invoices_with_status"]["Row"];
export type Settings = Tables<"workspace_settings">;
export type Client = Pick<Tables<"clients">, "id" | "company_name" | "contact_person" | "email" | "phone" | "address" | "gstin" | "status">;
export type Item = Tables<"invoice_items">;
export type Payment = Tables<"invoice_payments">;
export type DisplayStatus = "draft" | "pending" | "paid" | "overdue" | "cancelled";

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  draft: "Draft",
  pending: "Pending",
  paid: "Paid",
  overdue: "Overdue",
  cancelled: "Cancelled",
};
export const STATUS_TONE: Record<DisplayStatus, string> = {
  draft: "bg-slate-100 text-slate-700",
  pending: "bg-amber-100 text-amber-800",
  paid: "bg-green-100 text-green-700",
  overdue: "bg-red-100 text-red-700",
  cancelled: "bg-slate-100 text-slate-500 line-through",
};

export function StatusBadge({ status }: { status: string | null }) {
  const s = (status ?? "draft") as DisplayStatus;
  return <Badge tone={STATUS_TONE[s] ?? STATUS_TONE.draft}>{STATUS_LABEL[s] ?? s}</Badge>;
}

// Local calendar dates as YYYY-MM-DD.
export function todayIso() {
  return new Date().toLocaleDateString("en-CA");
}
export function addDays(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function monthStart(iso: string) {
  return iso.slice(0, 7) + "-01";
}
export function nextMonthStart(iso: string) {
  const d = new Date(monthStart(iso) + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function friendlyError(message: string) {
  if (/invoices_workspace_id_invoice_number_key|duplicate key/.test(message)) return "That invoice number is already used. Pick another or leave it empty.";
  return message;
}

// Indian numbering: lakh and crore.
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function two(n: number) {
  return n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "");
}
function three(n: number) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? ONES[h] + " Hundred" : "", r ? two(r) : ""].filter(Boolean).join(" ");
}
function indian(n: number): string {
  if (n === 0) return "";
  const crore = Math.floor(n / 1e7);
  const lakh = Math.floor(n / 1e5) % 100;
  const thousand = Math.floor(n / 1000) % 100;
  const rest = n % 1000;
  return [
    crore ? indian(crore) + " Crore" : "",
    lakh ? two(lakh) + " Lakh" : "",
    thousand ? two(thousand) + " Thousand" : "",
    rest ? three(rest) : "",
  ].filter(Boolean).join(" ");
}
export function amountInWords(amount: number) {
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  const r = rupees ? `Rupees ${indian(rupees)}` : "Rupees Zero";
  return paise ? `${r} and ${two(paise)} Paise Only` : `${r} Only`;
}

// ---------------------------------------------------------------------------
// Data hooks
// ---------------------------------------------------------------------------
export function useBillingBasics() {
  const { workspace } = useWorkspace();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Bumped by reload() so the invoice-number hint picks up the new next number after a save.
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: s }, { data: c }] = await Promise.all([
        supabase.from("workspace_settings").select("*").eq("workspace_id", workspace.id).maybeSingle(),
        supabase
          .from("clients")
          .select("id, company_name, contact_person, email, phone, address, gstin, status")
          .eq("workspace_id", workspace.id)
          .order("company_name"),
      ]);
      if (cancelled) return;
      setSettings(s);
      setClients(c ?? []);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [workspace.id, version]);
  return { settings, clients, loaded, reload };
}

export function clientName(clients: Client[], id: string | null | undefined) {
  return clients.find((c) => c.id === id)?.company_name ?? "";
}

// Admin-only guard used by every page in this folder.
export function InvoicingGate({ children }: { children: ReactNode }) {
  const { isAdmin, role, hasModule } = useWorkspace();
  if (!hasModule("invoicing"))
    return (
      <Card title="Invoicing">
        <p className="text-sm text-slate-500">Invoicing is not part of your current plan. Upgrade from the Subscription page to use it.</p>
      </Card>
    );
  if (!isAdmin && role !== null)
    return (
      <Card title="Invoicing">
        <p className="text-sm text-slate-500">Only company admins can see invoices and billing.</p>
      </Card>
    );
  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// Invoice editor (new or existing)
// ---------------------------------------------------------------------------
type ItemDraft = { id?: string; description: string; hsn_sac: string; quantity: string; rate: string; tax_rate: string };

export function InvoiceEditor({
  invoiceId,
  settings,
  clients,
  defaultClientId,
  onClose,
  onSaved,
}: {
  invoiceId: string | null;
  settings: Settings | null;
  clients: Client[];
  defaultClientId?: string;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { workspace } = useWorkspace();
  const { session } = useAuth();
  const terms = settings?.default_payment_terms_days ?? 15;
  const taxDefault = String(settings?.default_tax_rate ?? 18);
  const blankItem = (): ItemDraft => ({ description: "", hsn_sac: "", quantity: "1", rate: "", tax_rate: taxDefault });

  const [loading, setLoading] = useState(!!invoiceId);
  const [status, setStatus] = useState<string>("draft");
  const [form, setForm] = useState({
    client_id: defaultClientId ?? "",
    invoice_number: "",
    issue_date: todayIso(),
    due_date: addDays(todayIso(), terms),
    place_of_supply: settings?.state ?? "",
    discount_amount: "",
    notes: "",
    terms: "",
  });
  const [dueTouched, setDueTouched] = useState(false);
  const [items, setItems] = useState<ItemDraft[]>([blankItem()]);
  const [originalIds, setOriginalIds] = useState<string[]>([]);
  // Set once a new invoice's header is inserted, so a retry after a line-item failure updates it instead of inserting a second invoice.
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!invoiceId) return;
    (async () => {
      const [{ data: inv, error: e1 }, { data: its }] = await Promise.all([
        supabase.from("invoices").select("*").eq("workspace_id", workspace.id).eq("id", invoiceId).single(),
        supabase.from("invoice_items").select("*").eq("workspace_id", workspace.id).eq("invoice_id", invoiceId).order("position"),
      ]);
      if (e1 || !inv) {
        setError(e1?.message ?? "Invoice not found.");
        setLoading(false);
        return;
      }
      setStatus(inv.status);
      setDueTouched(true);
      setForm({
        client_id: inv.client_id,
        invoice_number: inv.invoice_number ?? "",
        issue_date: inv.issue_date,
        due_date: inv.due_date,
        place_of_supply: inv.place_of_supply ?? "",
        discount_amount: Number(inv.discount_amount) ? String(inv.discount_amount) : "",
        notes: inv.notes ?? "",
        terms: inv.terms ?? "",
      });
      const rows = (its ?? []).map((i) => ({
        id: i.id,
        description: i.description,
        hsn_sac: i.hsn_sac ?? "",
        quantity: String(i.quantity),
        rate: String(i.rate),
        tax_rate: String(i.tax_rate),
      }));
      setItems(rows.length ? rows : [blankItem()]);
      setOriginalIds(rows.map((r) => r.id!));
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId, workspace.id]);

  // Live preview; the database recalculates the real totals with the same rules.
  const lines = items.map((i) => {
    const amount = round2((Number(i.quantity) || 0) * (Number(i.rate) || 0));
    return { amount, tax: round2((amount * (Number(i.tax_rate) || 0)) / 100) };
  });
  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const tax = round2(lines.reduce((s, l) => s + l.tax, 0));
  const discount = Number(form.discount_amount) || 0;
  const total = Math.max(0, round2(subtotal + tax - discount));

  function setItem(idx: number, patch: Partial<ItemDraft>) {
    setItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  async function save(markSent: boolean) {
    setError("");
    const filled = items.filter((i) => i.description.trim());
    if (!form.client_id) return setError("Choose a client.");
    if (!filled.length) return setError("Add at least one line item with a description.");
    if (filled.some((i) => !(Number(i.quantity) > 0))) return setError("Quantity must be more than 0 on every line.");
    if (form.due_date < form.issue_date) return setError("Due date cannot be before the issue date.");
    setBusy(true);
    const header = {
      client_id: form.client_id,
      issue_date: form.issue_date,
      due_date: form.due_date,
      place_of_supply: form.place_of_supply.trim() || null,
      notes: form.notes.trim() || null,
      terms: form.terms.trim() || null,
      discount_amount: discount,
    };
    let id = invoiceId ?? createdId;
    if (!id) {
      const { data, error } = await supabase
        .from("invoices")
        .insert({
          ...header,
          workspace_id: workspace.id,
          invoice_number: form.invoice_number.trim() || null,
          status: markSent ? "pending" : "draft",
          created_by: session?.user.id ?? null,
        })
        .select("id")
        .single();
      if (error || !data) {
        setBusy(false);
        return setError(friendlyError(error?.message ?? "Could not save."));
      }
      id = data.id;
      setCreatedId(data.id);
      setStatus(markSent ? "pending" : "draft");
    } else {
      const { error } = await supabase
        .from("invoices")
        .update({
          ...header,
          ...(form.invoice_number.trim() ? { invoice_number: form.invoice_number.trim() } : {}),
          ...(markSent && status === "draft" ? { status: "pending" } : {}),
        })
        .eq("workspace_id", workspace.id)
        .eq("id", id);
      if (error) {
        setBusy(false);
        return setError(friendlyError(error.message));
      }
    }

    const keep = filled.filter((i) => i.id).map((i) => i.id!);
    const removed = originalIds.filter((x) => !keep.includes(x));
    if (removed.length) {
      const { error } = await supabase.from("invoice_items").delete().eq("workspace_id", workspace.id).in("id", removed);
      if (error) {
        setBusy(false);
        return setError(error.message);
      }
    }
    const row = (i: ItemDraft, position: number) => ({
      description: i.description.trim(),
      hsn_sac: i.hsn_sac.trim() || null,
      quantity: Number(i.quantity) || 1,
      rate: Number(i.rate) || 0,
      tax_rate: Number(i.tax_rate) || 0,
      position,
    });
    for (const [pos, i] of filled.entries()) {
      if (!i.id) continue;
      const { error } = await supabase.from("invoice_items").update(row(i, pos)).eq("workspace_id", workspace.id).eq("id", i.id);
      if (error) {
        setBusy(false);
        return setError(error.message);
      }
    }
    const fresh = filled
      .map((i, pos) => ({ i, pos }))
      .filter(({ i }) => !i.id)
      .map(({ i, pos }) => ({ ...row(i, pos), invoice_id: id!, workspace_id: workspace.id }));
    if (fresh.length) {
      const { error } = await supabase.from("invoice_items").insert(fresh);
      if (error) {
        setBusy(false);
        return setError(error.message);
      }
    }
    setBusy(false);
    onSaved(id!);
  }

  const title = invoiceId ? `Edit invoice ${form.invoice_number}` : "New invoice";
  if (loading)
    return (
      <Drawer title={title} onClose={onClose}>
        <Spinner />
      </Drawer>
    );

  return (
    <Drawer title={title} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save(false);
        }}
      >
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Client">
            <Select required value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
              <option value="">Choose a client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company_name}
                  {c.status !== "active" ? " (inactive)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Invoice number" hint={invoiceId ? undefined : `Leave empty to use the next number (${settings?.invoice_prefix ?? "INV-"}${String(settings?.next_invoice_number ?? 1).padStart(4, "0")}).`}>
            <Input value={form.invoice_number} onChange={(e) => setForm({ ...form, invoice_number: e.target.value })} placeholder="Automatic" />
          </Field>
          <Field label="Issue date">
            <Input
              type="date"
              required
              value={form.issue_date}
              onChange={(e) =>
                setForm({ ...form, issue_date: e.target.value, due_date: dueTouched || !e.target.value ? form.due_date : addDays(e.target.value, terms) })
              }
            />
          </Field>
          <Field label="Due date" hint={`Default: ${terms} days after the issue date.`}>
            <Input
              type="date"
              required
              value={form.due_date}
              onChange={(e) => {
                setDueTouched(true);
                setForm({ ...form, due_date: e.target.value });
              }}
            />
          </Field>
          <Field label="Place of supply" hint="State where the service is supplied, for GST.">
            <Input value={form.place_of_supply} onChange={(e) => setForm({ ...form, place_of_supply: e.target.value })} placeholder="e.g. Maharashtra" />
          </Field>
          <Field label="Discount (₹)">
            <Input type="number" min="0" step="0.01" value={form.discount_amount} onChange={(e) => setForm({ ...form, discount_amount: e.target.value })} />
          </Field>
        </div>

        <div>
          <div className="mb-2 text-sm font-medium text-slate-700">Line items</div>
          <div className="space-y-3">
            {items.map((it, idx) => (
              <div key={it.id ?? `new-${idx}`} className="rounded-md bg-slate-50 p-3 ring-1 ring-slate-200">
                <div className="grid gap-2 sm:grid-cols-6">
                  <div className="sm:col-span-4">
                    <Input placeholder="Description (e.g. Social media management – October)" value={it.description} onChange={(e) => setItem(idx, { description: e.target.value })} />
                  </div>
                  <div className="sm:col-span-2">
                    <Input placeholder="HSN/SAC" value={it.hsn_sac} onChange={(e) => setItem(idx, { hsn_sac: e.target.value })} />
                  </div>
                  <label className="text-xs text-slate-500 sm:col-span-1">
                    Qty
                    <Input type="number" min="0.001" step="any" value={it.quantity} onChange={(e) => setItem(idx, { quantity: e.target.value })} />
                  </label>
                  <label className="text-xs text-slate-500 sm:col-span-2">
                    Rate (₹)
                    <Input type="number" min="0" step="0.01" value={it.rate} onChange={(e) => setItem(idx, { rate: e.target.value })} />
                  </label>
                  <label className="text-xs text-slate-500 sm:col-span-1">
                    GST %
                    <Input type="number" min="0" max="100" step="0.01" value={it.tax_rate} onChange={(e) => setItem(idx, { tax_rate: e.target.value })} />
                  </label>
                  <div className="flex items-end justify-between gap-2 sm:col-span-2">
                    <div className="pb-2 text-sm">
                      <span className="text-slate-500">Amount </span>
                      <span className="font-medium">{inr(lines[idx].amount)}</span>
                    </div>
                    {items.length > 1 && (
                      <button type="button" className="pb-2 text-sm text-red-600 hover:underline" onClick={() => setItems(items.filter((_, i) => i !== idx))}>
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <Button type="button" variant="secondary" className="mt-2" onClick={() => setItems([...items, blankItem()])}>
            + Add line
          </Button>
        </div>

        <div className="ml-auto max-w-xs space-y-1 text-sm">
          <Row label="Subtotal" value={inr(subtotal)} />
          <Row label="GST" value={inr(tax)} />
          {discount > 0 && <Row label="Discount" value={`− ${inr(discount)}`} />}
          <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-semibold">
            <span>Total</span>
            <span>{inr(total)}</span>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Notes for the client">
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
          <Field label="Terms">
            <Textarea value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} placeholder="e.g. Payment within 15 days. Late payment attracts interest." />
          </Field>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>Close</Button>
          {status === "draft" ? (
            <>
              <Button type="submit" variant="secondary" disabled={busy}>Save as draft</Button>
              <Button type="button" disabled={busy} onClick={() => save(true)}>Save and mark as sent</Button>
            </>
          ) : (
            <Button type="submit" disabled={busy}>Save changes</Button>
          )}
        </div>
      </form>
    </Drawer>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Record payment
// ---------------------------------------------------------------------------
export function PaymentModal({ invoice, onClose, onSaved }: { invoice: InvoiceRow; onClose: () => void; onSaved: () => void }) {
  const { workspace } = useWorkspace();
  const { session } = useAuth();
  const balance = Number(invoice.balance_due ?? 0);
  const [form, setForm] = useState({
    amount: balance ? String(balance) : "",
    paid_on: todayIso(),
    method: "bank_transfer" as PaymentMode,
    reference_no: "",
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    const amount = Number(form.amount);
    if (!(amount > 0)) return setError("Enter an amount above zero.");
    setBusy(true);
    const { error } = await supabase.from("invoice_payments").insert({
      invoice_id: invoice.id!,
      workspace_id: workspace.id,
      amount,
      paid_on: form.paid_on,
      method: form.method,
      reference_no: form.reference_no.trim() || null,
      notes: form.notes.trim() || null,
      recorded_by: session?.user.id ?? null,
    });
    setBusy(false);
    if (error) return setError(error.message);
    onSaved();
  }

  const over = Number(form.amount) > balance && balance > 0;
  return (
    <Modal title={`Record payment · ${invoice.invoice_number}`} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {error && <Alert>{error}</Alert>}
        <p className="text-sm text-slate-500">
          Total {inr(invoice.total)} · Paid {inr(invoice.amount_paid)} · <span className="font-medium text-slate-700">Balance {inr(balance)}</span>
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amount (₹)" hint={over ? "This is more than the balance due." : undefined}>
            <Input type="number" min="0.01" step="0.01" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </Field>
          <Field label="Paid on">
            <Input type="date" required value={form.paid_on} onChange={(e) => setForm({ ...form, paid_on: e.target.value })} />
          </Field>
          <Field label="Payment method">
            <Select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value as PaymentMode })}>
              {MODES.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </Field>
          <Field label="UTR / reference no.">
            <Input value={form.reference_no} onChange={(e) => setForm({ ...form, reference_no: e.target.value })} placeholder="e.g. UTR or cheque number" />
          </Field>
        </div>
        <Field label="Notes">
          <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
        <p className="text-xs text-slate-500">Got a receipt or screenshot? Attach it to the invoice under Files.</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>Save payment</Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Printable invoice document
// ---------------------------------------------------------------------------
export function InvoiceDocument({
  invoice,
  items,
  client,
  settings,
  logoUrl,
}: {
  invoice: InvoiceRow;
  items: Item[];
  client: Client | undefined;
  settings: Settings | null;
  logoUrl?: string | null;
}) {
  const intra =
    !invoice.place_of_supply || !settings?.state || invoice.place_of_supply.trim().toLowerCase() === settings.state.trim().toLowerCase();
  const taxTotal = Number(invoice.tax_total ?? 0);
  // Split so the two halves always add back to the tax total.
  const cgst = Math.floor((taxTotal * 100) / 2) / 100;
  const sgst = round2(taxTotal - cgst);
  const addr = [settings?.address, [settings?.city, settings?.state, settings?.postal_code].filter(Boolean).join(", "), settings?.country]
    .filter(Boolean)
    .join("\n");
  const balance = Number(invoice.balance_due ?? 0);
  return (
    <div className="invoice-doc bg-white text-sm text-slate-800">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-300 pb-4">
        <div>
          {logoUrl && <img src={logoUrl} alt="" className="mb-2 max-h-16 max-w-[180px] object-contain" />}
          <div className="text-xl font-bold">{settings?.legal_name || settings?.company_name}</div>
          {addr && <div className="whitespace-pre-line text-slate-600">{addr}</div>}
          <div className="text-slate-600">
            {[settings?.phone, settings?.email, settings?.website].filter(Boolean).join(" · ")}
          </div>
          {settings?.gstin && <div className="mt-1">GSTIN: <span className="font-medium">{settings.gstin}</span></div>}
          {settings?.pan && <div>PAN: {settings.pan}</div>}
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold tracking-wide text-slate-700">TAX INVOICE</div>
          <div className="mt-1">Invoice no: <span className="font-medium">{invoice.invoice_number}</span></div>
          <div>Date: {date(invoice.issue_date)}</div>
          <div>Due: {date(invoice.due_date)}</div>
          {invoice.period_start && (
            <div className="text-slate-600">Period: {date(invoice.period_start)} – {date(invoice.period_end)}</div>
          )}
        </div>
      </div>

      <div className="grid gap-4 py-4 sm:grid-cols-2">
        <div>
          <div className="text-xs font-semibold uppercase text-slate-500">Bill to</div>
          <div className="font-medium">{client?.company_name}</div>
          {client?.contact_person && <div>{client.contact_person}</div>}
          {client?.address && <div className="whitespace-pre-line text-slate-600">{client.address}</div>}
          {[client?.phone, client?.email].filter(Boolean).length > 0 && (
            <div className="text-slate-600">{[client?.phone, client?.email].filter(Boolean).join(" · ")}</div>
          )}
          {client?.gstin && <div>GSTIN: {client.gstin}</div>}
        </div>
        {invoice.place_of_supply && (
          <div className="sm:text-right">
            <div className="text-xs font-semibold uppercase text-slate-500">Place of supply</div>
            <div>{invoice.place_of_supply}</div>
          </div>
        )}
      </div>

      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-y border-slate-300 bg-slate-50 text-xs uppercase text-slate-600">
            <th className="px-2 py-2">#</th>
            <th className="px-2 py-2">Description</th>
            <th className="px-2 py-2">HSN/SAC</th>
            <th className="px-2 py-2 text-right">Qty</th>
            <th className="px-2 py-2 text-right">Rate</th>
            <th className="px-2 py-2 text-right">GST</th>
            <th className="px-2 py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i, n) => (
            <tr key={i.id} className="border-b border-slate-200 align-top">
              <td className="px-2 py-2">{n + 1}</td>
              <td className="px-2 py-2">{i.description}</td>
              <td className="px-2 py-2">{i.hsn_sac}</td>
              <td className="px-2 py-2 text-right">{Number(i.quantity)}</td>
              <td className="px-2 py-2 text-right">{inr(i.rate)}</td>
              <td className="px-2 py-2 text-right">{Number(i.tax_rate)}%</td>
              <td className="px-2 py-2 text-right">{inr(i.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 flex flex-wrap justify-between gap-6">
        <div className="max-w-sm flex-1 space-y-3">
          <div>
            <div className="text-xs font-semibold uppercase text-slate-500">Amount in words</div>
            <div className="italic">{amountInWords(Number(invoice.total ?? 0))}</div>
          </div>
          {settings?.bank_details && (
            <div>
              <div className="text-xs font-semibold uppercase text-slate-500">Bank details</div>
              <div className="whitespace-pre-line">{settings.bank_details}</div>
            </div>
          )}
        </div>
        <div className="w-full max-w-xs space-y-1">
          <Row label="Subtotal" value={inr(invoice.subtotal)} />
          {intra ? (
            <>
              <Row label="CGST" value={inr(cgst)} />
              <Row label="SGST" value={inr(sgst)} />
            </>
          ) : (
            <Row label="IGST" value={inr(taxTotal)} />
          )}
          {Number(invoice.discount_amount) > 0 && <Row label="Discount" value={`− ${inr(invoice.discount_amount)}`} />}
          <div className="flex justify-between border-t border-slate-300 pt-1 text-base font-bold">
            <span>Total</span>
            <span>{inr(invoice.total)}</span>
          </div>
          {Number(invoice.amount_paid) > 0 && (
            <>
              <Row label="Paid" value={inr(invoice.amount_paid)} />
              <div className="flex justify-between font-semibold">
                <span>Balance due</span>
                <span>{inr(balance)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {(invoice.notes || invoice.terms) && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {invoice.notes && (
            <div>
              <div className="text-xs font-semibold uppercase text-slate-500">Notes</div>
              <div className="whitespace-pre-line">{invoice.notes}</div>
            </div>
          )}
          {invoice.terms && (
            <div>
              <div className="text-xs font-semibold uppercase text-slate-500">Terms</div>
              <div className="whitespace-pre-line">{invoice.terms}</div>
            </div>
          )}
        </div>
      )}

      <div className="mt-8 flex justify-end">
        <div className="text-center">
          <div className="h-12" />
          <div className="border-t border-slate-400 px-6 pt-1 text-xs">For {settings?.legal_name || settings?.company_name}<br />Authorised signatory</div>
        </div>
      </div>
      {settings?.invoice_footer && <div className="mt-6 border-t border-slate-200 pt-3 text-center text-xs text-slate-500 whitespace-pre-line">{settings.invoice_footer}</div>}
    </div>
  );
}

const PRINT_CSS = `
#invoice-print-root { display: none; }
@media print {
  @page { size: A4; margin: 12mm; }
  body > *:not(#invoice-print-root) { display: none !important; }
  #invoice-print-root { display: block !important; }
  #invoice-print-root .invoice-doc { font-size: 11pt; }
  #invoice-print-root * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}`;

function PrintModal(props: { invoice: InvoiceRow; items: Item[]; client: Client | undefined; settings: Settings | null; onClose: () => void }) {
  // One signed link for both copies; the logo shows once it has loaded, then Print includes it.
  const logoKey = props.settings?.logo_path;
  const logoUrl = useFileUrl(logoKey);
  const logoLoading = !!logoKey && !logoUrl;
  return (
    <Modal wide title={`Invoice ${props.invoice.invoice_number}`} onClose={props.onClose}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          Use Print, then choose “Save as PDF” to get a PDF.{logoLoading && " Loading your logo…"}
        </p>
        <Button onClick={() => window.print()}>Print / Save PDF</Button>
      </div>
      <div className="overflow-x-auto rounded-md p-4 ring-1 ring-slate-200">
        <div className="min-w-[560px]">
          <InvoiceDocument {...props} logoUrl={logoUrl} />
        </div>
      </div>
      {createPortal(
        <div id="invoice-print-root">
          <style>{PRINT_CSS}</style>
          <InvoiceDocument {...props} logoUrl={logoUrl} />
        </div>,
        document.body,
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Invoice view: summary, payments and every action, in one modal.
// Used from the invoice list, recurring page and the calendar.
// ---------------------------------------------------------------------------
export function InvoiceView({
  invoiceId,
  settings,
  clients,
  onClose,
  onChanged,
  startWith = "view",
}: {
  invoiceId: string;
  settings: Settings | null;
  clients: Client[];
  onClose: () => void;
  onChanged: () => void;
  startWith?: "view" | "pay";
}) {
  const { workspace, canWrite, isAdmin } = useWorkspace();
  const canEdit = canWrite && isAdmin;
  const [mode, setMode] = useState<"view" | "edit" | "pay" | "print">(startWith);
  const [invoice, setInvoice] = useState<InvoiceRow | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [{ data: inv, error: e }, { data: its }, { data: pays }] = await Promise.all([
      supabase.from("invoices_with_status").select("*").eq("workspace_id", workspace.id).eq("id", invoiceId).single(),
      supabase.from("invoice_items").select("*").eq("workspace_id", workspace.id).eq("invoice_id", invoiceId).order("position"),
      supabase.from("invoice_payments").select("*").eq("workspace_id", workspace.id).eq("invoice_id", invoiceId).order("paid_on"),
    ]);
    if (e) setError(e.message);
    setInvoice(inv);
    setItems(its ?? []);
    setPayments(pays ?? []);
  }, [invoiceId, workspace.id]);

  useEffect(() => {
    load();
  }, [load]);

  const changed = () => {
    load();
    onChanged();
  };

  if (!invoice)
    return (
      <Modal title="Invoice" onClose={onClose}>
        {error ? <Alert>{error}</Alert> : <Spinner />}
      </Modal>
    );

  const client = clients.find((c) => c.id === invoice.client_id);
  const st = invoice.display_status as DisplayStatus;
  const editable = canEdit && (invoice.status === "draft" || invoice.status === "pending");

  if (mode === "edit")
    return (
      <InvoiceEditor
        invoiceId={invoice.id!}
        settings={settings}
        clients={clients}
        onClose={() => setMode("view")}
        onSaved={() => {
          changed();
          setMode("view");
        }}
      />
    );
  if (mode === "pay")
    return (
      <PaymentModal
        invoice={invoice}
        onClose={() => (startWith === "pay" ? onClose() : setMode("view"))}
        onSaved={() => {
          changed();
          setMode("view");
        }}
      />
    );
  if (mode === "print") return <PrintModal invoice={invoice} items={items} client={client} settings={settings} onClose={() => setMode("view")} />;

  async function setStatus(status: "pending" | "cancelled") {
    if (status === "cancelled" && !confirm(`Cancel invoice ${invoice!.invoice_number}? It stays in your records but no longer counts as due.`)) return;
    setError("");
    const { error } = await supabase.from("invoices").update({ status }).eq("workspace_id", workspace.id).eq("id", invoiceId);
    if (error) return setError(error.message);
    changed();
  }

  async function deleteDraft() {
    if (!confirm(`Delete draft ${invoice!.invoice_number}? This cannot be undone.`)) return;
    const { error } = await supabase.from("invoices").delete().eq("workspace_id", workspace.id).eq("id", invoiceId);
    if (error) return setError(error.message);
    onChanged();
    onClose();
  }

  async function deletePayment(p: Payment) {
    if (!confirm(`Delete the payment of ${inr(p.amount)} from ${date(p.paid_on)}?`)) return;
    setError("");
    const { error } = await supabase.from("invoice_payments").delete().eq("workspace_id", workspace.id).eq("id", p.id);
    if (error) return setError(error.message);
    changed();
  }

  return (
    <Modal wide title={`Invoice ${invoice.invoice_number}`} onClose={onClose}>
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-medium">{client?.company_name ?? "Client"}</div>
            <div className="text-sm text-slate-500">
              Issued {date(invoice.issue_date)} · Due {date(invoice.due_date)}
              {invoice.recurring_bill_id && " · Recurring"}
            </div>
          </div>
          <StatusBadge status={st} />
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="Total" value={inr(invoice.total)} />
          <Stat label="Paid" value={inr(invoice.amount_paid)} />
          <Stat label="Balance due" value={inr(invoice.balance_due)} tone={st === "overdue" ? "text-red-600" : undefined} />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="py-1">Item</th>
                <th className="py-1 text-right">Qty</th>
                <th className="py-1 text-right">Rate</th>
                <th className="py-1 text-right">GST</th>
                <th className="py-1 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((i) => (
                <tr key={i.id}>
                  <td className="py-1.5">{i.description}{i.hsn_sac && <span className="text-xs text-slate-400"> · {i.hsn_sac}</span>}</td>
                  <td className="py-1.5 text-right">{Number(i.quantity)}</td>
                  <td className="py-1.5 text-right">{inr(i.rate)}</td>
                  <td className="py-1.5 text-right">{Number(i.tax_rate)}%</td>
                  <td className="py-1.5 text-right">{inr(i.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!items.length && <Empty>No line items yet.</Empty>}
        </div>

        <div>
          <div className="mb-1 text-sm font-medium">Payments</div>
          {payments.length ? (
            <ul className="divide-y divide-slate-100 text-sm">
              {payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <span className="font-medium">{inr(p.amount)}</span>
                    <span className="text-slate-500"> · {date(p.paid_on)} · {MODE_LABEL[p.method]}</span>
                    {p.reference_no && <span className="text-slate-500"> · Ref {p.reference_no}</span>}
                    {p.notes && <div className="text-xs text-slate-500">{p.notes}</div>}
                  </div>
                  {canEdit && (
                    <button className="text-xs text-red-600 hover:underline" onClick={() => deletePayment(p)}>
                      Delete
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No payments recorded yet.</p>
          )}
        </div>

        {isAdmin && (
          <Attachments
            workspaceId={workspace.id}
            entityType="invoice"
            entityId={invoice.id!}
            canUpload={canEdit}
            canDelete={() => canEdit}
          />
        )}

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
          <Button variant="secondary" onClick={() => setMode("print")}>Print / PDF</Button>
          {editable && <Button variant="secondary" onClick={() => setMode("edit")}>Edit</Button>}
          {canEdit && invoice.status === "draft" && <Button variant="secondary" onClick={() => setStatus("pending")}>Mark as sent</Button>}
          {canEdit && invoice.status === "draft" && !payments.length && <Button variant="danger" onClick={deleteDraft}>Delete draft</Button>}
          {editable && <Button variant="danger" onClick={() => setStatus("cancelled")}>Cancel invoice</Button>}
          {canEdit && invoice.status !== "cancelled" && Number(invoice.balance_due) > 0 && (
            <Button onClick={() => setMode("pay")}>Record payment</Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="rounded-md bg-slate-50 p-2 ring-1 ring-slate-200">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-sm font-semibold sm:text-base ${tone ?? ""}`}>{value}</div>
    </div>
  );
}
