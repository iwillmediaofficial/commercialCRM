import { useCallback, useEffect, useState } from "react";
import { supabase, type Tables } from "../../../lib/supabase";
import { useAuth } from "../../../lib/auth";
import { useWorkspace } from "../../../lib/workspace";
import { date, inr, PERIOD_LABEL, PERIODS, type BillingPeriod } from "../../../lib/format";
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, Select, Spinner, Textarea } from "../../../components/ui";
import {
  addDays,
  clientName,
  InvoiceView,
  InvoicingGate,
  StatusBadge,
  todayIso,
  useBillingBasics,
  type Client,
  type InvoiceRow,
  type Settings,
} from "./shared";

type Bill = Tables<"recurring_bills">;

export default function Recurring() {
  return (
    <InvoicingGate>
      <RecurringPage />
    </InvoicingGate>
  );
}

// First date on or after `from` that falls on `day` of a month.
function firstRunDate(from: string, day: number) {
  const d = new Date(from + "T00:00:00Z");
  if (d.getUTCDate() > day) d.setUTCMonth(d.getUTCMonth() + 1, 1);
  d.setUTCDate(day);
  return d.toISOString().slice(0, 10);
}

function RecurringPage() {
  const { workspace, canWrite, isAdmin } = useWorkspace();
  const canEdit = canWrite && isAdmin;
  const { settings, clients, loaded, reload: reloadBasics } = useBillingBasics();
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [unpaid, setUnpaid] = useState<InvoiceRow[]>([]);
  const [editing, setEditing] = useState<Bill | "new" | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    const [{ data, error }, { data: inv }] = await Promise.all([
      supabase.from("recurring_bills").select("*").eq("workspace_id", workspace.id).order("next_run_date"),
      supabase
        .from("invoices_with_status")
        .select("*")
        .eq("workspace_id", workspace.id)
        .not("recurring_bill_id", "is", null)
        .in("display_status", ["pending", "overdue"])
        .order("due_date"),
    ]);
    if (error) setError(error.message);
    setBills(data ?? []);
    setUnpaid(inv ?? []);
  }, [workspace.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function generate() {
    setError("");
    setNotice("");
    setRunning(true);
    const { data, error } = await supabase.rpc("run_recurring_billing", { p_workspace_id: workspace.id });
    setRunning(false);
    if (error) return setError(error.message);
    reloadBasics();
    setNotice(data ? `Created ${data} invoice${data === 1 ? "" : "s"}. You can find them below and on the Invoices page.` : "Nothing is due yet. No new invoices were needed.");
    load();
  }

  async function toggle(b: Bill) {
    setError("");
    const { error } = await supabase.from("recurring_bills").update({ is_active: !b.is_active }).eq("workspace_id", workspace.id).eq("id", b.id);
    if (error) setError(error.message);
    load();
  }

  const lead = settings?.recurring_lead_days ?? 7;
  const horizon = addDays(todayIso(), lead);
  const dueSoon = (bills ?? []).filter((b) => b.is_active && b.next_run_date <= horizon && (!b.end_date || b.next_run_date <= b.end_date));

  return (
    <>
      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <Card
        title="Recurring billing"
        actions={
          canEdit && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" disabled={running} onClick={generate}>{running ? "Generating…" : "Generate due invoices now"}</Button>
              <Button disabled={!loaded} onClick={() => setEditing("new")}>New retainer</Button>
            </div>
          )
        }
      >
        <p className="mb-4 text-sm text-slate-500">
          Invoices are created automatically every morning, {lead} day{lead === 1 ? "" : "s"} before each retainer's billing date (change this in Settings).
        </p>
        {bills === null ? (
          <Spinner />
        ) : !bills.length ? (
          <Empty>No retainers yet. Add one with New retainer.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {bills.map((b) => {
              const ended = !!b.end_date && b.next_run_date > b.end_date;
              return (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <div className="font-medium">
                      {b.title} <span className="font-normal text-slate-500">· {clientName(clients, b.client_id)}</span>
                    </div>
                    <div className="text-xs text-slate-500">
                      {inr(b.amount)} + {Number(b.tax_rate)}% GST every {PERIOD_LABEL[b.frequency]} · on day {b.billing_day}
                      {" · "}
                      {ended ? `ended ${date(b.end_date)}` : `next bill ${date(b.next_run_date)}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!b.is_active ? (
                      <Badge>Paused</Badge>
                    ) : ended ? (
                      <Badge>Ended</Badge>
                    ) : (
                      <Badge tone="bg-green-100 text-green-700">Active</Badge>
                    )}
                    {canEdit && (
                      <>
                        <Button variant="secondary" onClick={() => toggle(b)}>{b.is_active ? "Pause" : "Resume"}</Button>
                        <Button variant="secondary" onClick={() => setEditing(b)}>Edit</Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Due in the next ${lead} days`}>
          {!dueSoon.length ? (
            <Empty>No retainers are due soon.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {dueSoon.map((b) => (
                <li key={b.id} className="flex justify-between gap-2 py-2">
                  <span>
                    {b.title} <span className="text-slate-500">· {clientName(clients, b.client_id)}</span>
                  </span>
                  <span className={b.next_run_date < todayIso() ? "text-red-600" : "text-amber-700"}>{date(b.next_run_date)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Unpaid retainer invoices">
          {!unpaid.length ? (
            <Empty>All retainer invoices are paid.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {unpaid.map((r) => (
                <li key={r.id} className="flex cursor-pointer items-center justify-between gap-2 py-2 hover:bg-slate-50" onClick={() => setViewing(r.id!)}>
                  <span>
                    <span className="font-medium text-indigo-700">{r.invoice_number}</span>{" "}
                    <span className="text-slate-500">· {clientName(clients, r.client_id)} · due {date(r.due_date)}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    {inr(r.balance_due)} <StatusBadge status={r.display_status} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {editing && (
        <BillForm
          bill={editing === "new" ? null : editing}
          clients={clients}
          settings={settings}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      {viewing && <InvoiceView invoiceId={viewing} settings={settings} clients={clients} onClose={() => setViewing(null)} onChanged={load} />}
    </>
  );
}

function BillForm({ bill, clients, settings, onClose, onSaved }: { bill: Bill | null; clients: Client[]; settings: Settings | null; onClose: () => void; onSaved: () => void }) {
  const { workspace } = useWorkspace();
  const { session } = useAuth();
  const today = todayIso();
  const [form, setForm] = useState({
    client_id: bill?.client_id ?? "",
    title: bill?.title ?? "",
    description: bill?.description ?? "",
    amount: bill ? String(bill.amount) : "",
    tax_rate: String(bill?.tax_rate ?? settings?.default_tax_rate ?? 18),
    frequency: (bill?.frequency ?? "monthly") as BillingPeriod,
    billing_day: String(bill?.billing_day ?? 1),
    start_date: bill?.start_date ?? today,
    end_date: bill?.end_date ?? "",
    next_run_date: bill?.next_run_date ?? firstRunDate(today, 1),
    payment_terms_days: String(bill?.payment_terms_days ?? settings?.default_payment_terms_days ?? 15),
    is_active: bill?.is_active ?? true,
  });
  const [nextTouched, setNextTouched] = useState(!!bill);
  // True once the user types a next bill date themselves; that date then wins over recalculation.
  const [nextByHand, setNextByHand] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function patch(p: Partial<typeof form>) {
    const f = { ...form, ...p };
    if (!nextTouched && f.start_date) {
      const day = Math.min(28, Math.max(1, Number(f.billing_day) || 1));
      f.next_run_date = firstRunDate(f.start_date, day);
    } else if (bill && !nextByHand && p.billing_day !== undefined && p.billing_day !== form.billing_day && f.start_date) {
      // Existing retainer: a new billing day moves the next bill to that day, from today or the start date.
      const day = Math.min(28, Math.max(1, Number(f.billing_day) || 1));
      f.next_run_date = firstRunDate(f.start_date > today ? f.start_date : today, day);
    }
    setForm(f);
  }

  async function save() {
    setError("");
    const day = Number(form.billing_day);
    if (!form.client_id) return setError("Choose a client.");
    if (!(day >= 1 && day <= 28)) return setError("Billing day must be between 1 and 28.");
    if (form.end_date && form.end_date < form.start_date) return setError("End date cannot be before the start date.");
    if (form.next_run_date < form.start_date) return setError("Next bill date cannot be before the start date.");
    setBusy(true);
    const row = {
      client_id: form.client_id,
      title: form.title.trim(),
      description: form.description.trim() || null,
      amount: Number(form.amount) || 0,
      tax_rate: Number(form.tax_rate) || 0,
      frequency: form.frequency,
      billing_day: day,
      start_date: form.start_date,
      end_date: form.end_date || null,
      next_run_date: form.next_run_date,
      payment_terms_days: Number(form.payment_terms_days) || 0,
      is_active: form.is_active,
    };
    const { error } = bill
      ? await supabase.from("recurring_bills").update(row).eq("workspace_id", workspace.id).eq("id", bill.id)
      : await supabase.from("recurring_bills").insert({ ...row, workspace_id: workspace.id, created_by: session?.user.id ?? null });
    setBusy(false);
    if (error) return setError(error.message);
    onSaved();
  }

  return (
    <Modal wide title={bill ? `Edit retainer: ${bill.title}` : "New retainer"} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Client">
            <Select required value={form.client_id} onChange={(e) => patch({ client_id: e.target.value })}>
              <option value="">Choose a client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.company_name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Title" hint="Shown as the line item on each invoice.">
            <Input required value={form.title} onChange={(e) => patch({ title: e.target.value })} placeholder="e.g. Monthly SEO retainer" />
          </Field>
          <Field label="Amount per bill (₹, before GST)">
            <Input type="number" min="0" step="0.01" required value={form.amount} onChange={(e) => patch({ amount: e.target.value })} />
          </Field>
          <Field label="GST %">
            <Input type="number" min="0" max="100" step="0.01" value={form.tax_rate} onChange={(e) => patch({ tax_rate: e.target.value })} />
          </Field>
          <Field label="Bill every">
            <Select value={form.frequency} onChange={(e) => patch({ frequency: e.target.value as BillingPeriod })}>
              {PERIODS.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </Field>
          <Field label="Billing day of month (1–28)">
            <Input type="number" min="1" max="28" required value={form.billing_day} onChange={(e) => patch({ billing_day: e.target.value })} />
          </Field>
          <Field label="Start date">
            <Input type="date" required value={form.start_date} onChange={(e) => patch({ start_date: e.target.value })} />
          </Field>
          <Field label="End date" hint="Leave empty to keep billing until you pause it.">
            <Input type="date" value={form.end_date} onChange={(e) => patch({ end_date: e.target.value })} />
          </Field>
          <Field label="Next bill date" hint="The next invoice is dated this day.">
            <Input
              type="date"
              required
              value={form.next_run_date}
              onChange={(e) => {
                setNextTouched(true);
                setNextByHand(true);
                setForm({ ...form, next_run_date: e.target.value });
              }}
            />
          </Field>
          <Field label="Payment terms (days)" hint="Due date = bill date + these days.">
            <Input type="number" min="0" value={form.payment_terms_days} onChange={(e) => patch({ payment_terms_days: e.target.value })} />
          </Field>
        </div>
        <Field label="Description (internal)">
          <Textarea rows={2} value={form.description} onChange={(e) => patch({ description: e.target.value })} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.is_active} onChange={(e) => patch({ is_active: e.target.checked })} />
          Active (uncheck to pause billing)
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}
