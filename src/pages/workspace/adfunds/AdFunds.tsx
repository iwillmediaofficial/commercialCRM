import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { useWorkspace } from "../../../lib/workspace";
import { downloadCsv, inr } from "../../../lib/format";
import { Alert, Button, Card, Empty, Input, Spinner } from "../../../components/ui";
import { addMonths, clientLedger, clientMonth, currentMonth, monthLabel, monthOf, totalRow, type MonthRow } from "./adFundMath";
import { CollectionModal, UploadModal, type Adjustment, type Client, type Collection, type Upload } from "./AdFundModals";
import AdFundDrawer from "./AdFundDrawer";

const PAGE = 1000;

// Supabase returns at most 1000 rows per request, so page through everything.
async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

function groupBy<T extends { client_id: string }>(rows: T[]) {
  const m = new Map<string, T[]>();
  for (const r of rows) m.set(r.client_id, [...(m.get(r.client_id) ?? []), r]);
  return m;
}

// Grid columns: [label, key, short help].
const COLS: [string, keyof MonthRow, string][] = [
  ["Monthly target", "target", "The client's monthly ad budget."],
  ["Previous unused", "previousUnused", "Unused fund carried in from earlier months, plus Original Fund entries for this month."],
  ["Original fund", "originalFund", "(Monthly target + previous unused) − uploads paid from unused fund this month."],
  ["Company", "company", "Uploads paid from the company account this month."],
  ["Personal", "personal", "Uploads paid personally by someone this month."],
  ["Paid by client", "client", "Uploads the client paid for directly this month."],
  ["From unused", "unusedFund", "Uploads paid from the client's unused fund this month."],
  ["Total spent", "totalSpent", "All uploads this month, whoever paid."],
  ["To collect", "toCollect", "Company + personal uploads so far, minus money collected so far (balance at month end)."],
  ["Collected", "collected", "Money received from the client this month."],
  ["Unused this month", "unusedThisMonth", "Original fund − company, personal and client-paid uploads. Carried to next month."],
];

export default function AdFunds() {
  const { workspace, isAdmin, role, canWrite, hasModule } = useWorkspace();
  const [month, setMonth] = useState(currentMonth());
  const [clients, setClients] = useState<Client[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openClient, setOpenClient] = useState<string | null>(null);
  const [uploadModal, setUploadModal] = useState<{ upload?: Upload; client?: string } | null>(null);
  const [collectionModal, setCollectionModal] = useState<{ collection?: Collection; client?: string } | null>(null);
  const [search, setSearch] = useState("");
  const allowed = isAdmin || role === null;

  const load = useCallback(async () => {
    setError("");
    try {
      const ws = workspace.id;
      const [c, u, col, adj] = await Promise.all([
        fetchAll<Client>((a, b) => supabase.from("clients").select("*").eq("workspace_id", ws).eq("is_dm_client", true).order("company_name").order("id").range(a, b)),
        fetchAll<Upload>((a, b) => supabase.from("ad_fund_uploads").select("*").eq("workspace_id", ws).order("upload_date").order("id").range(a, b)),
        fetchAll<Collection>((a, b) => supabase.from("ad_fund_collections").select("*").eq("workspace_id", ws).order("received_on").order("id").range(a, b)),
        fetchAll<Adjustment>((a, b) => supabase.from("ad_fund_adjustments").select("*").eq("workspace_id", ws).order("year_month").order("id").range(a, b)),
      ]);
      setClients(c);
      setUploads(u);
      setCollections(col);
      setAdjustments(adj);
    } catch (e) {
      setError((e as Error).message);
    }
    setLoading(false);
  }, [workspace.id]);

  useEffect(() => {
    if (allowed) load();
  }, [load, allowed]);

  const byClient = useMemo(
    () => ({ u: groupBy(uploads), c: groupBy(collections), a: groupBy(adjustments) }),
    [uploads, collections, adjustments],
  );

  const rows = useMemo(
    () => clients.map((cl) => ({
      client: cl,
      row: clientMonth(Number(cl.monthly_ad_target), byClient.u.get(cl.id) ?? [], byClient.c.get(cl.id) ?? [], byClient.a.get(cl.id) ?? [], month),
    })),
    [clients, byClient, month],
  );
  const visible = rows.filter((r) => !search.trim() || r.client.company_name.toLowerCase().includes(search.trim().toLowerCase()));
  const total = totalRow(visible.map((r) => r.row), month);

  // Unused fund still free for a client in a month (previous unused − unused-fund uploads already that month).
  const available = useCallback((clientId: string, m: string, excludeUploadId?: string) => {
    const cl = clients.find((c) => c.id === clientId);
    if (!cl) return 0;
    const ups = (byClient.u.get(clientId) ?? []).filter((u) => u.id !== excludeUploadId);
    const r = clientMonth(Number(cl.monthly_ad_target), ups, byClient.c.get(clientId) ?? [], byClient.a.get(clientId) ?? [], m);
    return Math.round((r.previousUnused - r.unusedFund) * 100) / 100;
  }, [clients, byClient]);

  // What a client owes right now (all history to date).
  const owed = useCallback((clientId: string) => {
    const cl = clients.find((c) => c.id === clientId);
    if (!cl) return 0;
    const all = [...(byClient.u.get(clientId) ?? []).map((u) => monthOf(u.upload_date)), currentMonth()].sort();
    const l = clientLedger(Number(cl.monthly_ad_target), byClient.u.get(clientId) ?? [], byClient.c.get(clientId) ?? [], byClient.a.get(clientId) ?? [], all[all.length - 1]);
    return l[l.length - 1]?.toCollect ?? 0;
  }, [clients, byClient]);

  function exportCsv() {
    downloadCsv(
      `ad-funds-${month}.csv`,
      ["Client", ...COLS.map(([l]) => l), "Fronted this month"],
      [
        ...visible.map(({ client, row }) => [client.company_name, ...COLS.map(([, k]) => row[k] as number), row.fronted]),
        ["Total", ...COLS.map(([, k]) => total[k] as number), total.fronted],
      ],
    );
  }

  if (!hasModule("ad_funds")) return <Alert tone="info">Ad fund management is not part of your current plan. Upgrade on the Subscription page to use it.</Alert>;
  if (!allowed) return <Alert tone="info">Only workspace admins can see ad funds.</Alert>;
  if (loading) return <Spinner />;

  const drawerClient = clients.find((c) => c.id === openClient);
  const cell = "px-1 py-1.5 text-right align-top tabular-nums";
  const neg = (n: number) => (n < 0 ? "text-red-600" : "");

  return (
    <>
      {error && <Alert>{error}</Alert>}

      <Card
        title={`Ad funds · ${monthLabel(month)}`}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex items-center gap-1">
              <Button variant="secondary" className="!px-2" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>‹</Button>
              <Input type="month" className="!w-40" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
              <Button variant="secondary" className="!px-2" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>›</Button>
            </div>
            <Button variant="secondary" onClick={exportCsv} disabled={!visible.length}>Export CSV</Button>
            {canWrite && clients.length > 0 && (
              <>
                <Button variant="secondary" onClick={() => setCollectionModal({})}>Add collection</Button>
                <Button onClick={() => setUploadModal({})}>Add upload</Button>
              </>
            )}
          </div>
        }
      >
        {clients.length === 0 ? (
          <Empty>No digital marketing clients yet. Turn on "Digital marketing client" for a client on the Clients page and set a monthly ad target.</Empty>
        ) : (
          <>
            {clients.length > 8 && (
              <div className="mb-3 max-w-xs">
                <Input placeholder="Search clients" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] table-fixed border-collapse text-[11px] leading-tight">
                <colgroup>
                  <col className="w-[13%]" />
                  {COLS.map(([, k]) => <col key={k} />)}
                </colgroup>
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="px-1 py-1.5 text-left align-bottom font-medium">Client</th>
                    {COLS.map(([l, k, help]) => (
                      <th key={k} title={help} className={`cursor-help whitespace-normal break-words px-1 py-1.5 text-right align-bottom font-medium ${k === "toCollect" ? "text-amber-700" : ""} ${k === "unusedThisMonth" ? "text-indigo-700" : ""}`}>
                        {l}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visible.map(({ client, row }) => (
                    <tr key={client.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpenClient(client.id)}>
                      <td className="break-words px-1 py-1.5 align-top">
                        <span className="font-medium text-indigo-700 hover:underline">{client.company_name}</span>
                        {client.status === "inactive" && <span className="block text-slate-400">inactive</span>}
                        {!row.started && <span className="block text-slate-400" title="Before this client's first ad fund entry">not started</span>}
                      </td>
                      {COLS.map(([, k]) => {
                        const v = row[k] as number;
                        return (
                          <td key={k} className={`${cell} ${neg(v)} ${k === "toCollect" && v > 0 ? "font-semibold text-amber-700" : ""} ${k === "unusedThisMonth" ? "font-semibold" : ""} ${v === 0 ? "text-slate-300" : ""}`}>
                            {k === "target" && !row.started ? <span title="Not counted: before this client's first ad fund entry">{inr(client.monthly_ad_target)}*</span> : inr(v)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                    <td className="px-1 py-1.5">Total</td>
                    {COLS.map(([, k]) => (
                      <td key={k} className={`${cell} ${neg(total[k] as number)}`}>{inr(total[k] as number)}</td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Click a client for full history and the Original Fund (CRUD) ledger. Hover a column heading to see how it is worked out.
              Uploads paid by the client or from the unused fund never add to To Collect. Red means below zero (overspent).
              {rows.some((r) => !r.row.started) && " * Target not counted: this month is before the client's first ad fund entry."}
            </p>
          </>
        )}
      </Card>

      {drawerClient && (
        <AdFundDrawer
          client={drawerClient}
          uploads={byClient.u.get(drawerClient.id) ?? []}
          collections={byClient.c.get(drawerClient.id) ?? []}
          adjustments={byClient.a.get(drawerClient.id) ?? []}
          month={month}
          onClose={() => setOpenClient(null)}
          onChanged={load}
          onEditUpload={(u) => setUploadModal({ upload: u })}
          onEditCollection={(c) => setCollectionModal({ collection: c })}
          onAddUpload={() => setUploadModal({ client: drawerClient.id })}
          onAddCollection={() => setCollectionModal({ client: drawerClient.id })}
        />
      )}

      {uploadModal && (
        <UploadModal
          clients={clients}
          upload={uploadModal.upload}
          defaultClient={uploadModal.client}
          available={available}
          onClose={() => setUploadModal(null)}
          onSaved={() => { setUploadModal(null); load(); }}
        />
      )}
      {collectionModal && (
        <CollectionModal
          clients={clients}
          collection={collectionModal.collection}
          defaultClient={collectionModal.client}
          owed={owed}
          onClose={() => setCollectionModal(null)}
          onSaved={() => { setCollectionModal(null); load(); }}
        />
      )}
    </>
  );
}
