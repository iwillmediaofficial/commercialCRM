import { useCallback, useEffect, useState } from "react";
import { supabase, type Tables } from "../../lib/supabase";
import { fileUrl } from "../../lib/files";
import { useLiveTable } from "../../lib/realtime";
import { MODE_LABEL, PERIOD_LABEL, inr } from "../../lib/format";
import { Alert, Button, Card, Select } from "../../components/ui";

type Row = Tables<"renewal_requests"> & {
  workspace: Pick<Tables<"workspaces">, "name" | "owner_name" | "owner_email" | "owner_phone"> | null;
  plan: { name: string } | null;
};

// Open the tab first so pop-up blockers allow it, then point it at the signed link.
async function viewReceipt(key: string) {
  const tab = window.open("", "_blank");
  const url = await fileUrl({ key });
  if (url && tab) tab.location.href = url;
  else {
    tab?.close();
    if (!url) alert("Couldn't open the receipt. Try again.");
  }
}

export default function Renewals() {
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const load = useCallback(async () => {
    let query = supabase
      .from("renewal_requests")
      .select("*, workspace:workspaces(name, owner_name, owner_email, owner_phone), plan:plans(name)")
      .order("created_at", { ascending: filter === "pending" })
      .limit(200);
    if (filter === "pending") query = query.eq("status", "pending");
    const { data } = await query;
    setRows((data ?? []) as Row[]);
  }, [filter]);
  useEffect(() => {
    load();
  }, [load]);
  useLiveTable("renewal_requests", undefined, load);

  async function approve(r: Row) {
    const note = window.prompt(`Approve ${inr(r.amount)} from ${r.workspace?.name}? Add a note if you like (optional):`, "");
    if (note === null) return;
    setError("");
    setDone("");
    const { data, error } = await supabase.rpc("approve_renewal", { p_request_id: r.id, p_admin_note: note.trim() || undefined });
    if (error) setError(error.message);
    else setDone(`${r.workspace?.name} is active until ${new Date((data as { valid_until: string }).valid_until).toLocaleDateString()}.`);
    load();
  }
  async function reject(r: Row) {
    const reason = window.prompt("Reason for rejecting (the company will see it):");
    if (reason === null) return;
    setError("");
    setDone("");
    const { error } = await supabase.rpc("reject_renewal", { p_request_id: r.id, p_reason: reason.trim() || "Please contact support." });
    if (error) setError(error.message);
    load();
  }

  return (
    <Card
      title="Renewal requests"
      actions={
        <Select className="w-auto" value={filter} onChange={(e) => setFilter(e.target.value as "pending" | "all")}>
          <option value="pending">Waiting for you</option>
          <option value="all">All requests</option>
        </Select>
      }
    >
      <p className="mb-3 text-sm text-slate-500">Check your bank or UPI app for the payment before you approve. Approving extends the company from its current end date (or from today if it has lapsed).</p>
      {error && <div className="mb-3"><Alert>{error}</Alert></div>}
      {done && <div className="mb-3"><Alert tone="success">{done}</Alert></div>}
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{filter === "pending" ? "Nothing waiting." : "No renewal requests yet."}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-500">
              <tr><th className="py-2">Company</th><th>Plan</th><th>Period</th><th>Amount</th><th>Paid by</th><th>Requested</th><th>Status</th><th></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="py-2">
                    <div className="font-medium">{r.workspace?.name}</div>
                    <div className="text-xs text-slate-500">
                      {r.workspace?.owner_name}
                      {r.workspace?.owner_phone && ` · ${r.workspace.owner_phone}`}
                      {r.workspace?.owner_email && <div>{r.workspace.owner_email}</div>}
                    </div>
                  </td>
                  <td className="py-2">{r.plan?.name}</td>
                  <td className="py-2">{PERIOD_LABEL[r.period]}</td>
                  <td className="py-2">{inr(r.amount)}</td>
                  <td className="py-2">
                    {MODE_LABEL[r.payment_mode]}
                    {r.reference_no && <div className="text-xs text-slate-500">UTR {r.reference_no}</div>}
                    {r.receipt_path && (
                      <div>
                        <button type="button" className="text-xs text-indigo-600 hover:underline" onClick={() => viewReceipt(r.receipt_path!)}>
                          View receipt
                        </button>
                      </div>
                    )}
                    {r.note && <div className="text-xs text-slate-500">“{r.note}”</div>}
                  </td>
                  <td className="py-2">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="py-2 capitalize">
                    {r.status}
                    {r.admin_note && <div className="text-xs normal-case text-slate-500">{r.admin_note}</div>}
                  </td>
                  <td className="space-x-2 whitespace-nowrap py-2 text-right">
                    {r.status === "pending" && (
                      <>
                        <Button onClick={() => approve(r)}>Approve &amp; activate</Button>
                        <Button variant="danger" onClick={() => reject(r)}>Reject</Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
