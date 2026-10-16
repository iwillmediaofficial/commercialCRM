import { useEffect, useState } from "react";
import { supabase, type Tables } from "../../lib/supabase";
import { MODE_LABEL, PERIOD_LABEL, date, downloadCsv, inr } from "../../lib/format";
import { Card, Input } from "../../components/ui";

type Row = Tables<"subscription_payments"> & { workspace: { name: string } | null; plan: { name: string } | null };

// Every approved or recorded subscription payment, with revenue totals.
export default function Payments() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    supabase
      .from("subscription_payments")
      .select("*, workspace:workspaces(name), plan:plans(name)")
      .order("paid_on", { ascending: false })
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setRows((data ?? []) as Row[]);
        setLoading(false);
      });
  }, []);

  const today = new Date().toLocaleDateString("en-CA");
  const month = today.slice(0, 7);
  // Indian financial year starts on 1 April.
  const now = new Date();
  const fyStart = `${now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1}-04-01`;
  const sum = (list: Row[]) => list.reduce((s, r) => s + Number(r.amount), 0);
  const totals = [
    ["This month", sum(rows.filter((r) => r.paid_on.startsWith(month)))],
    ["This financial year", sum(rows.filter((r) => r.paid_on >= fyStart))],
    ["This calendar year", sum(rows.filter((r) => r.paid_on.startsWith(today.slice(0, 4))))],
    ["All time", sum(rows)],
  ] as const;

  const shown = rows.filter((r) => (!from || r.paid_on >= from) && (!to || r.paid_on <= to));

  function exportCsv() {
    downloadCsv(
      `subscription-payments${from ? `-from-${from}` : ""}${to ? `-to-${to}` : ""}.csv`,
      ["Paid on", "Company", "Plan", "Period", "Amount (INR)", "Paid by", "Reference", "Valid from", "Valid until", "Source"],
      shown.map((r) => [
        r.paid_on,
        r.workspace?.name,
        r.plan?.name,
        r.period ? PERIOD_LABEL[r.period] : "",
        Number(r.amount),
        MODE_LABEL[r.payment_mode],
        r.reference_no,
        r.valid_from.slice(0, 10),
        r.valid_until.slice(0, 10),
        r.renewal_request_id ? "Renewal request" : "Recorded by you",
      ]),
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {totals.map(([label, n]) => (
          <div key={label} className="rounded-lg bg-white p-3 shadow-sm ring-1 ring-slate-200">
            <div className="text-xs text-slate-500">{label}</div>
            <div className="text-xl font-semibold">{inr(n)}</div>
          </div>
        ))}
      </div>

      <Card
        title="Payments ledger"
        actions={
          <button className="text-sm text-indigo-600 hover:underline disabled:opacity-50" disabled={!shown.length} onClick={exportCsv}>
            Download CSV
          </button>
        }
      >
        <div className="mb-3 flex flex-wrap items-end gap-3 text-sm">
          <label className="text-xs text-slate-500">From<Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="text-xs text-slate-500">To<Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          {(from || to) && <span className="pb-2 text-slate-600">{shown.length} payments, {inr(sum(shown))}</span>}
        </div>
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-slate-500">No payments yet. They appear here when you approve a renewal or record a payment.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-500">
                <tr><th className="py-2">Paid on</th><th>Company</th><th>Plan</th><th>Period</th><th className="text-right">Amount</th><th>Paid by</th><th>Covers</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2">{date(r.paid_on)}</td>
                    <td>{r.workspace?.name}</td>
                    <td>{r.plan?.name}</td>
                    <td>{r.period ? PERIOD_LABEL[r.period] : ""}</td>
                    <td className="text-right">{inr(r.amount)}</td>
                    <td>{MODE_LABEL[r.payment_mode]}{r.reference_no && <div className="text-xs text-slate-500">UTR {r.reference_no}</div>}</td>
                    <td className="text-xs text-slate-500">{date(r.valid_from)} to {date(r.valid_until)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
