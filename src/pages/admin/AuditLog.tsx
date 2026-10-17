import { useEffect, useState } from "react";
import { supabase, type Tables } from "../../lib/supabase";
import { inr } from "../../lib/format";
import { Button, Card } from "../../components/ui";

type Row = Tables<"admin_audit_log"> & { workspace: { name: string } | null };
type Details = Record<string, unknown>;

const PAGE = 100;

const ACTION_LABEL: Record<string, string> = {
  workspace_created: "Created company",
  demo_workspace_created: "Created demo company",
  subscription_updated: "Changed subscription",
  payment_recorded: "Recorded payment",
  renewal_approved: "Approved renewal",
  renewal_rejected: "Rejected renewal",
  pin_issued: "Issued PIN",
  support_view: "Opened workspace",
  plans_insert: "Created plan",
  plans_update: "Changed plan",
  platform_settings_update: "Changed settings",
};

function describe(action: string, d: Details) {
  const parts: string[] = [];
  if (d.name) parts.push(String(d.name));
  if (d.amount != null) parts.push(inr(d.amount as number));
  if (d.add_days) parts.push(`${Number(d.add_days) > 0 ? "+" : ""}${d.add_days} days`);
  if (d.state) parts.push(`state ${d.state}`);
  if (d.purpose) parts.push(`${d.role ?? ""} ${d.purpose} PIN`.trim());
  if (d.valid_until) parts.push(`until ${new Date(String(d.valid_until)).toLocaleDateString()}`);
  if (d.reason) parts.push(`“${d.reason}”`);
  if (d.note) parts.push(`“${d.note}”`);
  return parts.join(" · ") || (action === "support_view" ? "Read-only" : "");
}

export default function AuditLog() {
  const [rows, setRows] = useState<Row[]>([]);
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [more, setMore] = useState(false);

  async function load(offset: number) {
    const { data } = await supabase
      .from("admin_audit_log")
      .select("*, workspace:workspaces(name)")
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE - 1);
    const list = (data ?? []) as Row[];
    setRows((prev) => (offset ? [...prev, ...list] : list));
    setMore(list.length === PAGE);
    const ids = [...new Set(list.map((r) => r.actor_id).filter((x): x is string => !!x))];
    if (ids.length) {
      const { data: people } = await supabase.from("profiles").select("id, email").in("id", ids);
      setEmails((prev) => ({ ...prev, ...Object.fromEntries((people ?? []).map((p) => [p.id, p.email])) }));
    }
  }
  useEffect(() => {
    load(0);
  }, []);

  return (
    <Card title="Audit log">
      <p className="mb-3 text-sm text-slate-500">Everything done from the Super Admin area, newest first.</p>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-500">
              <tr><th className="py-2">When</th><th>Who</th><th>What</th><th>Company</th><th>Details</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap py-2">{new Date(r.created_at).toLocaleString()}</td>
                  <td>{(r.actor_id && emails[r.actor_id]) || "System"}</td>
                  <td>{ACTION_LABEL[r.action] ?? r.action}</td>
                  <td>{r.workspace?.name}</td>
                  <td className="text-slate-600">{describe(r.action, r.details as Details)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {more && <Button className="mt-3" variant="secondary" onClick={() => load(rows.length)}>Load more</Button>}
    </Card>
  );
}
