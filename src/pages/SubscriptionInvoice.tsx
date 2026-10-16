import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { supabase } from "../lib/supabase";
import { MODE_LABEL, date, inr, rupeesInWords, type PaymentMode } from "../lib/format";
import { Button, Spinner } from "../components/ui";

// The frozen invoice snapshot saved on subscription_payments.invoice at payment time.
type Party = {
  name?: string | null;
  product?: string | null;
  address?: string | null;
  state?: string | null;
  state_code?: string | null;
  gstin?: string | null;
  pan?: string | null;
  email?: string | null;
  phone?: string | null;
};
type Snapshot = {
  date: string;
  registered: boolean;
  seller: Party;
  buyer: Party;
  line: { description: string; period_from?: string | null; period_to?: string | null; sac?: string | null };
  rate: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  payment_mode?: string | null;
  reference_no?: string | null;
};

const PRINT_CSS = `
@media print {
  @page { size: A4; margin: 12mm; }
  html, body { background: #fff !important; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}`;

// Printable invoice for a subscription payment, for the Super Admin and the company's admins.
export default function SubscriptionInvoice() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [row, setRow] = useState<{ invoice_no: string | null; invoice: Snapshot | null } | null | undefined>(undefined);

  useEffect(() => {
    if (!id) return setRow(null);
    supabase
      .from("subscription_payments")
      .select("invoice_no, invoice")
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => setRow(data ? { invoice_no: data.invoice_no, invoice: data.invoice as unknown as Snapshot | null } : null));
  }, [id]);

  useEffect(() => {
    if (row?.invoice_no) document.title = `Invoice ${row.invoice_no}`;
  }, [row]);

  function back() {
    if (window.history.length > 1) navigate(-1);
    else navigate("/");
  }

  if (row === undefined) return <Spinner />;
  if (!row || !row.invoice) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-md space-y-3 rounded-lg bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
          <h1 className="text-lg font-semibold">Invoice not found</h1>
          <p className="text-sm text-slate-600">
            {row
              ? "This payment doesn't have an invoice yet."
              : "This invoice doesn't exist, or your account can't see it. Only the company's owner and admins can open subscription invoices."}
          </p>
          <Button variant="secondary" onClick={back}>Back</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-6 print:bg-white print:p-0">
      <style>{PRINT_CSS}</style>
      <div className="mx-auto mb-4 flex max-w-[210mm] items-center justify-between gap-2 print:hidden">
        <Button variant="secondary" onClick={back}>Back</Button>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-slate-500 sm:inline">Choose "Save as PDF" in the print window to get a PDF.</span>
          <Button onClick={() => window.print()}>Print / Save as PDF</Button>
        </div>
      </div>
      <div className="mx-auto max-w-[210mm] overflow-x-auto rounded-lg bg-white p-8 shadow-sm ring-1 ring-slate-200 print:max-w-none print:overflow-visible print:rounded-none print:p-0 print:shadow-none print:ring-0">
        <div className="min-w-[560px] print:min-w-0">
          <InvoiceDoc no={row.invoice_no ?? ""} inv={row.invoice} />
        </div>
      </div>
    </div>
  );
}

function InvoiceDoc({ no, inv }: { no: string; inv: Snapshot }) {
  const { seller, buyer, line } = inv;
  const half = Number(inv.rate) / 2;
  const interState = Number(inv.igst) > 0;
  const mode = inv.payment_mode ? (MODE_LABEL[inv.payment_mode as PaymentMode] ?? inv.payment_mode) : "";
  const stateLine = (p: Party) => [p.state, p.state_code && `State code ${p.state_code}`].filter(Boolean).join(", ");

  return (
    <div className="text-sm text-slate-800 print:text-[11pt]">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-300 pb-4">
        <div className="max-w-[60%]">
          <div className="text-xl font-bold">{seller.name}</div>
          {seller.product && seller.product !== seller.name && <div className="text-slate-600">{seller.product}</div>}
          {seller.address && <div className="whitespace-pre-line text-slate-600">{seller.address}</div>}
          {stateLine(seller) && <div className="text-slate-600">{stateLine(seller)}</div>}
          {[seller.phone, seller.email].filter(Boolean).length > 0 && (
            <div className="text-slate-600">{[seller.phone, seller.email].filter(Boolean).join(" · ")}</div>
          )}
          {seller.gstin && <div className="mt-1">GSTIN: <span className="font-medium">{seller.gstin}</span></div>}
          {seller.pan && <div>PAN: {seller.pan}</div>}
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold uppercase tracking-wide text-slate-700">{inv.registered ? "Tax Invoice" : "Invoice"}</div>
          <div className="mt-1">Invoice no: <span className="font-medium">{no}</span></div>
          <div>Date: {date(inv.date)}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 py-4">
        <div>
          <div className="text-xs font-semibold uppercase text-slate-500">Bill to</div>
          <div className="font-medium">{buyer.name}</div>
          {buyer.address && <div className="whitespace-pre-line text-slate-600">{buyer.address}</div>}
          {[buyer.phone, buyer.email].filter(Boolean).length > 0 && (
            <div className="text-slate-600">{[buyer.phone, buyer.email].filter(Boolean).join(" · ")}</div>
          )}
          {buyer.gstin && <div>GSTIN: {buyer.gstin}</div>}
        </div>
        {(buyer.state || buyer.state_code) && (
          <div className="text-right">
            <div className="text-xs font-semibold uppercase text-slate-500">Place of supply</div>
            <div>{stateLine(buyer)}</div>
          </div>
        )}
      </div>

      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-y border-slate-300 bg-slate-50 text-xs uppercase text-slate-600">
            <th className="px-2 py-2">#</th>
            <th className="px-2 py-2">Description</th>
            <th className="px-2 py-2">SAC</th>
            <th className="px-2 py-2 text-right">{inv.registered ? "Taxable value" : "Amount"}</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-slate-200 align-top">
            <td className="px-2 py-2">1</td>
            <td className="px-2 py-2">
              {line.description}
              {line.period_from && (
                <div className="text-xs text-slate-500">Service period: {date(line.period_from)} to {date(line.period_to)}</div>
              )}
            </td>
            <td className="px-2 py-2">{line.sac}</td>
            <td className="px-2 py-2 text-right">{inr(inv.registered ? inv.taxable : inv.total)}</td>
          </tr>
        </tbody>
      </table>

      <div className="mt-4 flex justify-between gap-6">
        <div className="max-w-sm flex-1 space-y-3">
          <div>
            <div className="text-xs font-semibold uppercase text-slate-500">Amount in words</div>
            <div className="italic">{rupeesInWords(Number(inv.total))}</div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase text-slate-500">Payment</div>
            <div>
              {mode}
              {inv.reference_no && <> · Ref {inv.reference_no}</>}
            </div>
            <div className="font-medium text-green-700">Paid in full</div>
          </div>
        </div>
        <div className="w-full max-w-xs space-y-1">
          {inv.registered && (
            <>
              <Line label="Taxable value" value={inr(inv.taxable)} />
              {interState ? (
                <Line label={`IGST @ ${Number(inv.rate)}%`} value={inr(inv.igst)} />
              ) : (
                <>
                  <Line label={`CGST @ ${half}%`} value={inr(inv.cgst)} />
                  <Line label={`SGST @ ${half}%`} value={inr(inv.sgst)} />
                </>
              )}
            </>
          )}
          <div className="flex justify-between border-t border-slate-300 pt-1 text-base font-bold">
            <span>Total</span>
            <span>{inr(inv.total)}</span>
          </div>
          <Line label="Amount paid" value={inr(inv.total)} />
          <Line label="Balance due" value={inr(0)} />
        </div>
      </div>

      {!inv.registered && (
        <p className="mt-4 text-xs text-slate-500">The supplier is not registered under GST, so no GST is charged on this invoice.</p>
      )}

      <div className="mt-10 border-t border-slate-200 pt-3 text-center text-xs text-slate-500">
        This is a computer-generated invoice.
      </div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-600">{label}</span>
      <span>{value}</span>
    </div>
  );
}
