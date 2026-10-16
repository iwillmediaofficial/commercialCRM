import { useEffect, useState } from "react";
import { supabase, type Tables } from "../../lib/supabase";
import { Alert, Button, Card } from "../../components/ui";

type Row = Tables<"renewal_requests"> & { workspace: { name: string } | null; plan: { name: string } | null };

export default function Renewals() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");

  async function load() {
    const { data } = await supabase
      .from("renewal_requests")
      .select("*, workspace:workspaces(name), plan:plans(name)")
      .order("created_at", { ascending: false })
      .limit(100);
    setRows((data ?? []) as Row[]);
  }
  useEffect(() => {
    load();
  }, []);

  async function approve(id: string) {
    setError("");
    const { error } = await supabase.rpc("approve_renewal", { p_request_id: id });
    if (error) setError(error.message);
    load();
  }
  async function reject(id: string) {
    const reason = window.prompt("Reason for rejecting (the company will see it):") ?? "";
    setError("");
    const { error } = await supabase.rpc("reject_renewal", { p_request_id: id, p_reason: reason });
    if (error) setError(error.message);
    load();
  }

  return (
    <Card title="Renewal requests">
      {error && <div className="mb-3"><Alert>{error}</Alert></div>}
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">No renewal requests yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-500">
              <tr><th className="py-2">Company</th><th>Plan</th><th>Period</th><th>Amount</th><th>Paid by</th><th>Status</th><th></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-2">{r.workspace?.name}<div className="text-xs text-slate-500">{new Date(r.created_at).toLocaleString()}</div></td>
                  <td>{r.plan?.name}</td>
                  <td className="capitalize">{r.period.replace("_", " ")}</td>
                  <td>₹{Number(r.amount).toLocaleString("en-IN")}</td>
                  <td className="uppercase">{r.payment_mode}{r.reference_no && <div className="text-xs normal-case text-slate-500">Ref {r.reference_no}</div>}</td>
                  <td className="capitalize">{r.status}</td>
                  <td className="space-x-2 text-right">
                    {r.status === "pending" && (
                      <>
                        <Button onClick={() => approve(r.id)}>Approve</Button>
                        <Button variant="danger" onClick={() => reject(r.id)}>Reject</Button>
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
