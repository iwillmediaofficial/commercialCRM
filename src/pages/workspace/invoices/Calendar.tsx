import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { useWorkspace } from "../../../lib/workspace";
import { inr } from "../../../lib/format";
import { Alert, Button, Card, Empty, Spinner } from "../../../components/ui";
import { addDays, clientName, InvoiceView, InvoicingGate, monthStart, nextMonthStart, todayIso, useBillingBasics, type InvoiceRow } from "./shared";

type Pay = { id: string; amount: number; paid_on: string; invoice_id: string; invoices: { invoice_number: string | null; client_id: string } | null };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const TILE: Record<string, string> = {
  paid: "bg-green-100 text-green-800 ring-green-200",
  pending: "bg-amber-100 text-amber-900 ring-amber-200",
  overdue: "bg-red-100 text-red-800 ring-red-200",
  draft: "bg-slate-100 text-slate-600 ring-slate-200",
};

export default function BillingCalendar() {
  return (
    <InvoicingGate>
      <CalendarPage />
    </InvoicingGate>
  );
}

function prevMonthStart(iso: string) {
  const d = new Date(monthStart(iso) + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 10);
}

function CalendarPage() {
  const { workspace } = useWorkspace();
  const { settings, clients } = useBillingBasics();
  const [month, setMonth] = useState(monthStart(todayIso()));
  const [invoices, setInvoices] = useState<InvoiceRow[] | null>(null);
  const [payments, setPayments] = useState<Pay[]>([]);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<{ id: string; pay: boolean } | null>(null);

  // Grid runs Monday to Sunday, covering the whole month.
  const days = useMemo(() => {
    const first = new Date(month + "T00:00:00Z");
    const start = addDays(month, -((first.getUTCDay() + 6) % 7));
    const end = addDays(nextMonthStart(month), -1);
    const out: string[] = [];
    for (let d = start; d <= end || out.length % 7 !== 0; d = addDays(d, 1)) out.push(d);
    return out;
  }, [month]);
  const gridStart = days[0];
  const gridEnd = days[days.length - 1];

  const load = useCallback(async () => {
    const [{ data, error }, { data: pays, error: e2 }] = await Promise.all([
      supabase
        .from("invoices_with_status")
        .select("*")
        .eq("workspace_id", workspace.id)
        .neq("status", "cancelled")
        .gte("due_date", gridStart)
        .lte("due_date", gridEnd)
        .order("due_date"),
      supabase
        .from("invoice_payments")
        .select("id, amount, paid_on, invoice_id, invoices(invoice_number, client_id)")
        .eq("workspace_id", workspace.id)
        .gte("paid_on", gridStart)
        .lte("paid_on", gridEnd),
    ]);
    setError(error?.message || e2?.message || "");
    setInvoices(data ?? []);
    setPayments((pays ?? []) as Pay[]);
  }, [workspace.id, gridStart, gridEnd]);

  useEffect(() => {
    load();
  }, [load]);

  const byDay = useMemo(() => {
    const m = new Map<string, { inv: InvoiceRow[]; pay: Pay[] }>();
    for (const d of days) m.set(d, { inv: [], pay: [] });
    for (const i of invoices ?? []) m.get(i.due_date!)?.inv.push(i);
    for (const p of payments) m.get(p.paid_on)?.pay.push(p);
    return m;
  }, [days, invoices, payments]);

  // Month totals (only days inside the month).
  const inMonth = (d: string) => d.startsWith(month.slice(0, 7));
  const monthInv = (invoices ?? []).filter((i) => inMonth(i.due_date!));
  const dueTotal = monthInv.filter((i) => i.status !== "draft").reduce((s, i) => s + Number(i.total ?? 0), 0);
  const overdueTotal = monthInv.filter((i) => i.display_status === "overdue").reduce((s, i) => s + Number(i.balance_due ?? 0), 0);
  const collectedTotal = payments.filter((p) => inMonth(p.paid_on)).reduce((s, p) => s + Number(p.amount), 0);

  const today = todayIso();
  const label = new Date(month + "T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  function invoiceTile(i: InvoiceRow) {
    const st = i.display_status ?? "pending";
    return (
      <button
        key={i.id}
        type="button"
        onClick={() => setOpen({ id: i.id!, pay: false })}
        className={`block w-full truncate rounded px-1.5 py-0.5 text-left text-xs ring-1 hover:brightness-95 ${TILE[st] ?? TILE.pending}`}
        title={`${i.invoice_number} · ${clientName(clients, i.client_id)} · ${inr(i.total)} (${st})`}
      >
        {clientName(clients, i.client_id) || i.invoice_number} · {inr(st === "paid" ? i.total : i.balance_due)}
      </button>
    );
  }
  function payTile(p: Pay) {
    return (
      <button
        key={p.id}
        type="button"
        onClick={() => setOpen({ id: p.invoice_id, pay: false })}
        className="block w-full truncate rounded px-1.5 py-0.5 text-left text-xs text-green-800 ring-1 ring-green-300 hover:bg-green-50"
        title={`Payment received for ${p.invoices?.invoice_number ?? "invoice"}`}
      >
        ✓ {inr(p.amount)} received
      </button>
    );
  }

  return (
    <>
      {error && <Alert>{error}</Alert>}
      <Card
        title="Billing calendar"
        actions={
          <div className="flex items-center gap-1">
            <Button variant="secondary" onClick={() => setMonth(prevMonthStart(month))} aria-label="Previous month">‹</Button>
            <Button variant="secondary" onClick={() => setMonth(monthStart(today))}>Today</Button>
            <Button variant="secondary" onClick={() => setMonth(nextMonthStart(month))} aria-label="Next month">›</Button>
          </div>
        }
      >
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-lg font-semibold">{label}</div>
          <div className="flex flex-wrap gap-3 text-xs text-slate-600">
            <span>Billed: <b>{inr(dueTotal)}</b></span>
            <span className="text-red-700">Overdue: <b>{inr(overdueTotal)}</b></span>
            <span className="text-green-700">Collected: <b>{inr(collectedTotal)}</b></span>
          </div>
        </div>
        <div className="mb-3 flex flex-wrap gap-3 text-xs text-slate-600">
          <Legend tone={TILE.paid} label="Paid" />
          <Legend tone={TILE.pending} label="Pending / upcoming" />
          <Legend tone={TILE.overdue} label="Overdue" />
          <Legend tone={TILE.draft} label="Draft" />
          <Legend tone="ring-green-300 bg-white" label="Payment received" />
        </div>

        {invoices === null ? (
          <Spinner />
        ) : (
          <>
            {/* Month grid on tablets and up */}
            <div className="hidden sm:block">
              <div className="grid grid-cols-7 gap-px rounded-md bg-slate-200 text-xs ring-1 ring-slate-200">
                {WEEKDAYS.map((w) => (
                  <div key={w} className="bg-slate-50 px-2 py-1 font-medium text-slate-500">{w}</div>
                ))}
                {days.map((d) => {
                  const cell = byDay.get(d)!;
                  return (
                    <div key={d} className={`min-h-24 space-y-1 p-1 ${inMonth(d) ? "bg-white" : "bg-slate-50 text-slate-400"}`}>
                      <div className={`text-right text-xs ${d === today ? "font-bold text-indigo-600" : ""}`}>
                        {d === today ? <span className="rounded-full bg-indigo-600 px-1.5 text-white">{Number(d.slice(8))}</span> : Number(d.slice(8))}
                      </div>
                      {cell.inv.map((i) => invoiceTile(i))}
                      {cell.pay.map((p) => payTile(p))}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Agenda list on phones */}
            <div className="sm:hidden">
              {days.filter((d) => inMonth(d) && (byDay.get(d)!.inv.length || byDay.get(d)!.pay.length)).length === 0 ? (
                <Empty>Nothing due or collected this month.</Empty>
              ) : (
                <ul className="space-y-3">
                  {days
                    .filter((d) => inMonth(d) && (byDay.get(d)!.inv.length || byDay.get(d)!.pay.length))
                    .map((d) => (
                      <li key={d}>
                        <div className={`mb-1 text-sm font-medium ${d === today ? "text-indigo-600" : ""}`}>
                          {new Date(d + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}
                        </div>
                        <div className="space-y-1">
                          {byDay.get(d)!.inv.map((i) => invoiceTile(i))}
                          {byDay.get(d)!.pay.map((p) => payTile(p))}
                        </div>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          </>
        )}
      </Card>

      {open && (
        <InvoiceView
          key={open.id}
          invoiceId={open.id}
          settings={settings}
          clients={clients}
          startWith={open.pay ? "pay" : "view"}
          onClose={() => setOpen(null)}
          onChanged={load}
        />
      )}
    </>
  );
}

function Legend({ tone, label }: { tone: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`inline-block h-3 w-3 rounded ring-1 ${tone}`} />
      {label}
    </span>
  );
}
