import { useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { useWorkspace } from "../../../lib/workspace";
import { date, inr, MODE_LABEL } from "../../../lib/format";
import { Alert, Badge, Button, Drawer, Empty } from "../../../components/ui";
import { clientLedger, currentMonth, monthLabel, monthOf, PAYER_LABEL, type PayerType } from "./adFundMath";
import { ADJ_LABEL, AdjustmentModal, platformName, type Adjustment, type Client, type Collection, type Upload } from "./AdFundModals";

type Tab = "uploads" | "collections" | "fund";

const PAYER_TONE: Record<string, string> = {
  company: "bg-indigo-50 text-indigo-700",
  personal: "bg-amber-50 text-amber-800",
  client: "bg-green-50 text-green-700",
  unused_fund: "bg-sky-50 text-sky-700",
};

const neg = (n: number) => (n < 0 ? "text-red-600" : "");

export default function AdFundDrawer({ client, uploads, collections, adjustments, month, onClose, onChanged, onEditUpload, onEditCollection, onAddUpload, onAddCollection }: {
  client: Client;
  uploads: Upload[];
  collections: Collection[];
  adjustments: Adjustment[];
  month: string;
  onClose: () => void;
  onChanged: () => void;
  onEditUpload: (u: Upload) => void;
  onEditCollection: (c: Collection) => void;
  onAddUpload: () => void;
  onAddCollection: () => void;
}) {
  const { workspace, canWrite } = useWorkspace();
  const [tab, setTab] = useState<Tab>("uploads");
  const [error, setError] = useState("");
  const [adj, setAdj] = useState<Adjustment | "new" | null>(null);

  // Ledger to the later of the selected month and this month, so nothing recorded is hidden.
  const until = [month, currentMonth(), ...uploads.map((u) => monthOf(u.upload_date)), ...adjustments.map((a) => monthOf(a.year_month))].sort().pop()!;
  const ledger = useMemo(
    () => clientLedger(Number(client.monthly_ad_target), uploads, collections, adjustments, until),
    [client.monthly_ad_target, uploads, collections, adjustments, until],
  );
  const now = ledger.find((r) => r.month === month);

  // To Collect running balance: fronted uploads add, collections subtract, in date order.
  const cashEvents = useMemo(() => {
    const ev = [
      ...uploads.filter((u) => u.payer_type === "company" || u.payer_type === "personal").map((u) => ({
        id: u.id, day: u.upload_date, at: u.created_at, label: `${platformName(u.platform)} upload · ${PAYER_LABEL[u.payer_type as PayerType]}${u.payer_name ? ` (${u.payer_name})` : ""}`,
        change: Number(u.amount), collection: undefined as Collection | undefined,
      })),
      ...collections.map((c) => ({
        id: c.id, day: c.received_on, at: c.created_at, label: `Received · ${MODE_LABEL[c.method]}${c.reference_no ? ` · ${c.reference_no}` : ""}`,
        change: -Number(c.amount), collection: c,
      })),
    ].sort((a, b) => a.day.localeCompare(b.day) || a.at.localeCompare(b.at));
    let bal = 0;
    return ev.map((e) => ({ ...e, balance: (bal = Math.round((bal + e.change) * 100) / 100) })).reverse();
  }, [uploads, collections]);

  const sortedUploads = useMemo(
    () => [...uploads].sort((a, b) => b.upload_date.localeCompare(a.upload_date) || b.created_at.localeCompare(a.created_at)),
    [uploads],
  );
  const sortedAdj = useMemo(() => {
    const asc = [...adjustments].sort((a, b) => a.year_month.localeCompare(b.year_month) || a.created_at.localeCompare(b.created_at));
    let bal = 0;
    return asc.map((a) => ({ ...a, running: (bal = Math.round((bal + Number(a.amount)) * 100) / 100) })).reverse();
  }, [adjustments]);

  async function remove(table: "ad_fund_uploads" | "ad_fund_collections" | "ad_fund_adjustments", id: string, what: string) {
    if (!confirm(`Delete this ${what}? This cannot be undone.`)) return;
    setError("");
    const { error } = await supabase.from(table).delete().eq("workspace_id", workspace.id).eq("id", id);
    if (error) return setError(error.message);
    onChanged();
  }

  const tabs: [Tab, string][] = [["uploads", `Uploads (${uploads.length})`], ["collections", `Collections (${collections.length})`], ["fund", "Original Fund (CRUD)"]];
  const small = "text-xs text-slate-500";

  return (
    <Drawer title={client.company_name} onClose={onClose}>
      <div className="mb-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Stat label="Monthly target" value={inr(client.monthly_ad_target)} />
        <Stat label={`Unused end of ${monthLabel(month)}`} value={inr(now?.unusedThisMonth ?? 0)} tone={neg(now?.unusedThisMonth ?? 0)} />
        <Stat label="To collect now" value={inr(ledger[ledger.length - 1]?.toCollect ?? 0)} tone={(ledger[ledger.length - 1]?.toCollect ?? 0) > 0 ? "text-amber-700" : ""} />
        <Stat label="Platforms" value={client.ad_platforms.length ? client.ad_platforms.map(platformName).join(", ") : "None set"} />
      </div>

      {error && <div className="mb-3"><Alert>{error}</Alert></div>}

      <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
        {tabs.map(([k, l]) => (
          <button
            key={k}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}
            onClick={() => setTab(k)}
          >
            {l}
          </button>
        ))}
      </div>

      {tab === "uploads" && (
        <>
          {canWrite && <div className="mb-3 flex justify-end"><Button onClick={onAddUpload}>Add upload</Button></div>}
          {sortedUploads.length === 0 ? <Empty>No ad uploads yet.</Empty> : (
            <ul className="divide-y divide-slate-100">
              {sortedUploads.map((u) => (
                <li key={u.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <div className="font-medium">{inr(u.amount)} <span className="font-normal text-slate-600">on {platformName(u.platform)}</span></div>
                    <div className={small}>
                      {date(u.upload_date)} · <Badge tone={PAYER_TONE[u.payer_type]}>{PAYER_LABEL[u.payer_type as PayerType] ?? u.payer_type}</Badge>
                      {u.payer_name && ` · ${u.payer_name}`}
                    </div>
                    {u.notes && <div className={`${small} mt-0.5 whitespace-pre-wrap`}>{u.notes}</div>}
                  </div>
                  {canWrite && (
                    <div className="flex gap-2">
                      <Button variant="secondary" className="!px-2 !py-1 text-xs" onClick={() => onEditUpload(u)}>Edit</Button>
                      <Button variant="danger" className="!px-2 !py-1 text-xs" onClick={() => remove("ad_fund_uploads", u.id, "upload")}>Delete</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {tab === "collections" && (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className={small}>Company and personal uploads add to To Collect; money received reduces it. Newest first.</p>
            {canWrite && <Button onClick={onAddCollection}>Add collection</Button>}
          </div>
          {cashEvents.length === 0 ? <Empty>Nothing fronted or collected yet.</Empty> : (
            <table className="w-full table-fixed text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="w-24 py-1.5 font-medium">Date</th>
                  <th className="py-1.5 font-medium">Entry</th>
                  <th className="w-24 py-1.5 text-right font-medium">Amount</th>
                  <th className="w-24 py-1.5 text-right font-medium">To collect</th>
                  {canWrite && <th className="w-20" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cashEvents.map((e) => (
                  <tr key={e.id} className="align-top">
                    <td className="py-2 text-xs">{date(e.day)}</td>
                    <td className="break-words py-2 text-xs">{e.label}{e.collection?.notes && <div className="text-slate-500">{e.collection.notes}</div>}</td>
                    <td className={`py-2 text-right text-xs ${e.change < 0 ? "text-green-700" : ""}`}>{e.change < 0 ? `− ${inr(-e.change)}` : `+ ${inr(e.change)}`}</td>
                    <td className="py-2 text-right text-xs font-medium">{inr(e.balance)}</td>
                    {canWrite && (
                      <td className="py-1.5 text-right">
                        {e.collection && (
                          <div className="flex justify-end gap-1">
                            <button className="text-xs text-indigo-600 hover:underline" onClick={() => onEditCollection(e.collection!)}>Edit</button>
                            <button className="text-xs text-red-600 hover:underline" onClick={() => remove("ad_fund_collections", e.id, "collection")}>Delete</button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {tab === "fund" && (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className={small}>Opening balances and offline carryovers add to the unused fund carried into their month. Use a minus amount to reduce it.</p>
            {canWrite && <Button onClick={() => setAdj("new")}>Add entry</Button>}
          </div>
          {sortedAdj.length === 0 ? <Empty>No entries yet. Add an opening balance to bring in unused money from before you started using this.</Empty> : (
            <table className="mb-6 w-full table-fixed text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="w-28 py-1.5 font-medium">Month</th>
                  <th className="py-1.5 font-medium">Type</th>
                  <th className="w-24 py-1.5 text-right font-medium">Amount</th>
                  <th className="w-24 py-1.5 text-right font-medium">Running</th>
                  {canWrite && <th className="w-20" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedAdj.map((a) => (
                  <tr key={a.id} className="align-top">
                    <td className="py-2 text-xs">{monthLabel(monthOf(a.year_month))}</td>
                    <td className="break-words py-2 text-xs">{ADJ_LABEL[a.kind] ?? a.kind}{a.notes && <div className="text-slate-500">{a.notes}</div>}</td>
                    <td className={`py-2 text-right text-xs ${neg(Number(a.amount))}`}>{inr(a.amount)}</td>
                    <td className={`py-2 text-right text-xs font-medium ${neg(a.running)}`}>{inr(a.running)}</td>
                    {canWrite && (
                      <td className="py-1.5 text-right">
                        <div className="flex justify-end gap-1">
                          <button className="text-xs text-indigo-600 hover:underline" onClick={() => setAdj(a)}>Edit</button>
                          <button className="text-xs text-red-600 hover:underline" onClick={() => remove("ad_fund_adjustments", a.id, "entry")}>Delete</button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3 className="mb-2 text-sm font-semibold">Month by month</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] table-fixed text-xs">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="w-24 py-1.5 font-medium">Month</th>
                  <th className="py-1.5 text-right font-medium">Carried in</th>
                  <th className="py-1.5 text-right font-medium">Target</th>
                  <th className="py-1.5 text-right font-medium">Original fund</th>
                  <th className="py-1.5 text-right font-medium">Spent</th>
                  <th className="py-1.5 text-right font-medium">Unused</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[...ledger].reverse().filter((r) => r.started).map((r) => (
                  <tr key={r.month} className={r.month === month ? "bg-indigo-50/60" : ""}>
                    <td className="py-1.5">{monthLabel(r.month)}</td>
                    <td className={`py-1.5 text-right ${neg(r.previousUnused)}`}>{inr(r.previousUnused)}</td>
                    <td className="py-1.5 text-right">{inr(r.target)}</td>
                    <td className={`py-1.5 text-right ${neg(r.originalFund)}`}>{inr(r.originalFund)}</td>
                    <td className="py-1.5 text-right">{inr(r.totalSpent)}</td>
                    <td className={`py-1.5 text-right font-medium ${neg(r.unusedThisMonth)}`}>{inr(r.unusedThisMonth)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={`${small} mt-2`}>The target used for every month is the client's current monthly target ({inr(client.monthly_ad_target)}).</p>
        </>
      )}

      {adj && (
        <AdjustmentModal
          clientId={client.id}
          adjustment={adj === "new" ? undefined : adj}
          defaultMonth={month}
          onClose={() => setAdj(null)}
          onSaved={() => { setAdj(null); onChanged(); }}
        />
      )}
    </Drawer>
  );
}

function Stat({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`break-words font-semibold ${tone}`}>{value}</div>
    </div>
  );
}
