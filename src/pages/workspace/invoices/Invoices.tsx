import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { useWorkspace } from "../../../lib/workspace";
import { date, downloadCsv, inr } from "../../../lib/format";
import { Alert, Button, Card, Empty, Input, Select, Spinner } from "../../../components/ui";
import {
  clientName,
  InvoiceEditor,
  InvoiceView,
  InvoicingGate,
  monthStart,
  nextMonthStart,
  Stat,
  STATUS_LABEL,
  StatusBadge,
  todayIso,
  useBillingBasics,
  type DisplayStatus,
  type InvoiceRow,
} from "./shared";

export default function Invoices() {
  return (
    <InvoicingGate>
      <InvoiceList />
    </InvoicingGate>
  );
}

function InvoiceList() {
  const { workspace, canWrite, isAdmin } = useWorkspace();
  const canEdit = canWrite && isAdmin;
  const { settings, clients, loaded } = useBillingBasics();
  const [rows, setRows] = useState<InvoiceRow[] | null>(null);
  const [collected, setCollected] = useState(0);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({ status: "", client: "", month: "" });
  const [viewing, setViewing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const today = todayIso();
    const [{ data, error }, { data: pays }] = await Promise.all([
      supabase
        .from("invoices_with_status")
        .select("*")
        .eq("workspace_id", workspace.id)
        .order("issue_date", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase
        .from("invoice_payments")
        .select("amount")
        .eq("workspace_id", workspace.id)
        .gte("paid_on", monthStart(today))
        .lt("paid_on", nextMonthStart(today)),
    ]);
    if (error) setError(error.message);
    setRows(data ?? []);
    setCollected((pays ?? []).reduce((s, p) => s + Number(p.amount), 0));
  }, [workspace.id]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = useMemo(() => {
    let outstanding = 0;
    let overdue = 0;
    for (const r of rows ?? []) {
      if (r.display_status === "pending" || r.display_status === "overdue") outstanding += Number(r.balance_due ?? 0);
      if (r.display_status === "overdue") overdue += Number(r.balance_due ?? 0);
    }
    return { outstanding, overdue };
  }, [rows]);

  const shown = (rows ?? []).filter(
    (r) =>
      (!filters.status || r.display_status === filters.status) &&
      (!filters.client || r.client_id === filters.client) &&
      (!filters.month || (r.issue_date ?? "").startsWith(filters.month)),
  );

  function exportCsv() {
    downloadCsv(
      "invoices.csv",
      ["Invoice no", "Client", "Issue date", "Due date", "Status", "Subtotal", "GST", "Discount", "Total", "Paid", "Balance due"],
      shown.map((r) => [
        r.invoice_number,
        clientName(clients, r.client_id),
        r.issue_date,
        r.due_date,
        STATUS_LABEL[r.display_status as DisplayStatus] ?? r.display_status,
        r.subtotal,
        r.tax_total,
        r.discount_amount,
        r.total,
        r.amount_paid,
        r.balance_due,
      ]),
    );
  }

  return (
    <>
      {error && <Alert>{error}</Alert>}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Stat label="Outstanding" value={inr(totals.outstanding)} />
        <Stat label="Overdue" value={inr(totals.overdue)} tone={totals.overdue > 0 ? "text-red-600" : undefined} />
        <Stat label="Collected this month" value={inr(collected)} tone="text-green-700" />
      </div>

      <Card
        title="Invoices"
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={exportCsv} disabled={!shown.length}>Export CSV</Button>
            {canEdit && (
              <Button onClick={() => setCreating(true)} disabled={!loaded}>New invoice</Button>
            )}
          </div>
        }
      >
        <div className="mb-4 grid gap-2 sm:grid-cols-3">
          <Select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} aria-label="Status">
            <option value="">All statuses</option>
            {(Object.keys(STATUS_LABEL) as DisplayStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </Select>
          <Select value={filters.client} onChange={(e) => setFilters({ ...filters, client: e.target.value })} aria-label="Client">
            <option value="">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.company_name}</option>
            ))}
          </Select>
          <Input type="month" value={filters.month} onChange={(e) => setFilters({ ...filters, month: e.target.value })} aria-label="Month issued" title="Month issued" />
        </div>

        {rows === null ? (
          <Spinner />
        ) : !shown.length ? (
          <Empty>{rows.length ? "No invoices match these filters." : "No invoices yet. Create your first one with New invoice."}</Empty>
        ) : (
          <>
            {/* Phones: cards */}
            <ul className="divide-y divide-slate-100 sm:hidden">
              {shown.map((r) => (
                <li key={r.id} className="cursor-pointer py-3" onClick={() => setViewing(r.id!)}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{r.invoice_number}</span>
                    <StatusBadge status={r.display_status} />
                  </div>
                  <div className="text-sm">{clientName(clients, r.client_id)}</div>
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>Due {date(r.due_date)}</span>
                    <span>{inr(r.total)}{Number(r.balance_due) > 0 && r.display_status !== "cancelled" ? ` · ${inr(r.balance_due)} due` : ""}</span>
                  </div>
                </li>
              ))}
            </ul>
            {/* Larger screens: table */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-500">
                  <tr className="border-b border-slate-200">
                    <th className="py-2 pr-2">Invoice</th>
                    <th className="py-2 pr-2">Client</th>
                    <th className="py-2 pr-2">Issued</th>
                    <th className="py-2 pr-2">Due</th>
                    <th className="py-2 pr-2">Status</th>
                    <th className="py-2 pr-2 text-right">Total</th>
                    <th className="py-2 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shown.map((r) => (
                    <tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setViewing(r.id!)}>
                      <td className="py-2 pr-2 font-medium text-indigo-700">{r.invoice_number}</td>
                      <td className="py-2 pr-2">{clientName(clients, r.client_id)}</td>
                      <td className="py-2 pr-2 whitespace-nowrap">{date(r.issue_date)}</td>
                      <td className="py-2 pr-2 whitespace-nowrap">{date(r.due_date)}</td>
                      <td className="py-2 pr-2"><StatusBadge status={r.display_status} /></td>
                      <td className="py-2 pr-2 text-right">{inr(r.total)}</td>
                      <td className="py-2 text-right">{r.display_status === "cancelled" ? "—" : inr(r.balance_due)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {creating && (
        <InvoiceEditor
          invoiceId={null}
          settings={settings}
          clients={clients}
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false);
            load();
            setViewing(id);
          }}
        />
      )}
      {viewing && (
        <InvoiceView invoiceId={viewing} settings={settings} clients={clients} onClose={() => setViewing(null)} onChanged={load} />
      )}
    </>
  );
}
