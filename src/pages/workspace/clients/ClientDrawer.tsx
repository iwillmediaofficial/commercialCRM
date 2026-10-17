import { useEffect, useState, type ReactNode } from "react";
import { supabase, type Tables } from "../../../lib/supabase";
import { useWorkspace } from "../../../lib/workspace";
import { useAuth } from "../../../lib/auth";
import { useMembers, nameOf } from "../../../lib/members";
import { Attachments, StoredImage } from "../../../components/Files";
import { MODE_LABEL, date, inr } from "../../../lib/format";
import { Badge, Button, Drawer, Empty, Spinner } from "../../../components/ui";
import { platformLabel } from "./platforms";

type Client = Tables<"clients">;
type Tab = "details" | "work" | "invoices" | "adfunds" | "leads";

export default function ClientDrawer({ client, onClose, onEdit }: { client: Client; onClose: () => void; onEdit?: () => void }) {
  const { hasModule, isAdmin: admin, role } = useWorkspace();
  // The Super Admin's read-only support view (role null) may see admin-only data too.
  const isAdmin = admin || role === null;
  const tabs: [Tab, string][] = [["details", "Details"]];
  if (hasModule("work")) tabs.push(["work", "Work"]);
  if (hasModule("invoicing") && isAdmin) tabs.push(["invoices", "Invoices & payments"]);
  if (hasModule("ad_funds") && isAdmin && client.is_dm_client) tabs.push(["adfunds", "Ad spend"]);
  if (hasModule("leads")) tabs.push(["leads", "Leads"]);
  const [tab, setTab] = useState<Tab>("details");

  return (
    <Drawer title={client.company_name} onClose={onClose}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {client.logo_path && (
          <StoredImage storageKey={client.logo_path} alt="" className="h-10 w-10 rounded-md object-cover ring-1 ring-slate-200" />
        )}
        <Badge tone={client.status === "active" ? "bg-green-100 text-green-700" : undefined}>
          {client.status === "active" ? "Active" : "Inactive"}
        </Badge>
        {client.is_dm_client && <Badge tone="bg-indigo-100 text-indigo-700">Digital marketing</Badge>}
        {onEdit && (
          <Button variant="secondary" className="ml-auto" onClick={onEdit}>Edit</Button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              tab === key ? "border-indigo-600 font-medium text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "details" && (
        <>
          <Details client={client} />
          <div className="mt-5 border-t border-slate-100 pt-4">
            <ClientFiles clientId={client.id} />
          </div>
        </>
      )}
      {tab === "work" && <WorkTab clientId={client.id} />}
      {tab === "invoices" && <InvoicesTab clientId={client.id} />}
      {tab === "adfunds" && <AdFundsTab client={client} />}
      {tab === "leads" && <LeadsTab clientId={client.id} />}
    </Drawer>
  );
}

function ClientFiles({ clientId }: { clientId: string }) {
  const { workspace, canWrite, isAdmin } = useWorkspace();
  const { session } = useAuth();
  const me = session?.user.id;
  return (
    <Attachments
      workspaceId={workspace.id}
      entityType="client"
      entityId={clientId}
      canUpload={canWrite}
      canDelete={(f) => canWrite && (f.uploaded_by === me || isAdmin)}
    />
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words">{children || <span className="text-slate-400">—</span>}</dd>
    </div>
  );
}

function Details({ client: c }: { client: Client }) {
  const site = c.website ? (/^https?:\/\//.test(c.website) ? c.website : `https://${c.website}`) : "";
  return (
    <dl className="divide-y divide-slate-100">
      <Row label="Contact">{c.contact_person}</Row>
      <Row label="Phone">{c.phone && <a className="text-indigo-600" href={`tel:${c.phone}`}>{c.phone}</a>}</Row>
      <Row label="Email">{c.email && <a className="text-indigo-600" href={`mailto:${c.email}`}>{c.email}</a>}</Row>
      <Row label="Website">{site && <a className="text-indigo-600" href={site} target="_blank" rel="noreferrer">{c.website}</a>}</Row>
      <Row label="Address"><span className="whitespace-pre-line">{c.address}</span></Row>
      <Row label="GSTIN">{c.gstin}</Row>
      {c.is_dm_client && (
        <>
          <Row label="Monthly ad target">{inr(c.monthly_ad_target)}</Row>
          <Row label="Ad platforms">{c.ad_platforms.map(platformLabel).join(", ")}</Row>
        </>
      )}
      <Row label="Notes"><span className="whitespace-pre-line">{c.notes}</span></Row>
      <Row label="Added on">{date(c.created_at)}</Row>
    </dl>
  );
}

// Small hook: run a query once for this tab and hold its result.
function useOnce<T>(fn: () => PromiseLike<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let cancelled = false;
    setData(null);
    Promise.resolve(fn()).then((d) => !cancelled && setData(d));
    return () => {
      cancelled = true;
    };
  }, deps);
  return data;
}

const WORK_STATUS: Record<string, [string, string]> = {
  backlog: ["Backlog", "bg-slate-100 text-slate-700"],
  in_progress: ["In progress", "bg-sky-100 text-sky-700"],
  under_review: ["Under review", "bg-amber-100 text-amber-800"],
  completed: ["Completed", "bg-green-100 text-green-700"],
};

function WorkTab({ clientId }: { clientId: string }) {
  const { workspace } = useWorkspace();
  const people = useMembers(workspace.id);
  const rows = useOnce(async () => {
    const { data } = await supabase
      .from("work_items")
      .select("id, title, status, priority, due_date, work_item_assignees(user_id)")
      .eq("workspace_id", workspace.id)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(100);
    return data ?? [];
  }, [workspace.id, clientId]);
  if (!rows) return <Spinner />;
  if (rows.length === 0) return <Empty>No work items for this client yet.</Empty>;
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((w) => {
        const [label, tone] = WORK_STATUS[w.status] ?? [w.status, undefined];
        const who = w.work_item_assignees.map((a) => nameOf(people, a.user_id)).filter(Boolean).join(", ");
        return (
          <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <div className="min-w-0">
              <div className="text-sm font-medium">{w.title}</div>
              <div className="text-xs text-slate-500">
                <span className="capitalize">{w.priority}</span> priority
                {w.due_date && ` · due ${date(w.due_date)}`}
                {who && ` · ${who}`}
              </div>
            </div>
            <Badge tone={tone}>{label}</Badge>
          </li>
        );
      })}
    </ul>
  );
}

const INVOICE_STATUS: Record<string, [string, string]> = {
  draft: ["Draft", "bg-slate-100 text-slate-700"],
  pending: ["Pending", "bg-amber-100 text-amber-800"],
  overdue: ["Overdue", "bg-red-100 text-red-700"],
  paid: ["Paid", "bg-green-100 text-green-700"],
  cancelled: ["Cancelled", "bg-slate-100 text-slate-500"],
};

function InvoicesTab({ clientId }: { clientId: string }) {
  const { workspace } = useWorkspace();
  const data = useOnce(async () => {
    const { data: inv } = await supabase
      .from("invoices_with_status")
      .select("id, invoice_number, issue_date, due_date, total, amount_paid, balance_due, display_status")
      .eq("workspace_id", workspace.id)
      .eq("client_id", clientId)
      .order("issue_date", { ascending: false })
      .limit(100);
    const ids = (inv ?? []).map((i) => i.id!).filter(Boolean);
    const { data: pay } = ids.length
      ? await supabase
          .from("invoice_payments")
          .select("id, invoice_id, amount, paid_on, method, reference_no")
          .eq("workspace_id", workspace.id)
          .in("invoice_id", ids)
          .order("paid_on", { ascending: false })
      : { data: [] };
    return { inv: inv ?? [], pay: pay ?? [] };
  }, [workspace.id, clientId]);
  if (!data) return <Spinner />;
  const live = data.inv.filter((i) => i.display_status !== "cancelled" && i.display_status !== "draft");
  const billed = live.reduce((s, i) => s + Number(i.total ?? 0), 0);
  const paid = live.reduce((s, i) => s + Number(i.amount_paid ?? 0), 0);
  const due = live.reduce((s, i) => s + Number(i.balance_due ?? 0), 0);
  const numberOf = (id: string) => data.inv.find((i) => i.id === id)?.invoice_number ?? "";

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Billed" value={inr(billed)} />
        <Stat label="Received" value={inr(paid)} />
        <Stat label="Outstanding" value={inr(due)} tone={due > 0 ? "text-red-600" : undefined} />
      </div>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Invoices</h3>
        {data.inv.length === 0 ? (
          <Empty>No invoices for this client yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="py-1 pr-2 font-medium">Number</th>
                  <th className="py-1 pr-2 font-medium">Issued</th>
                  <th className="py-1 pr-2 font-medium">Due</th>
                  <th className="py-1 pr-2 text-right font-medium">Total</th>
                  <th className="py-1 pr-2 text-right font-medium">Balance</th>
                  <th className="py-1 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.inv.map((i) => {
                  const [label, tone] = INVOICE_STATUS[i.display_status ?? ""] ?? [i.display_status ?? "", undefined];
                  return (
                    <tr key={i.id}>
                      <td className="py-2 pr-2 font-medium whitespace-nowrap">{i.invoice_number}</td>
                      <td className="py-2 pr-2 whitespace-nowrap">{date(i.issue_date)}</td>
                      <td className="py-2 pr-2 whitespace-nowrap">{date(i.due_date)}</td>
                      <td className="py-2 pr-2 text-right whitespace-nowrap">{inr(i.total)}</td>
                      <td className="py-2 pr-2 text-right whitespace-nowrap">{inr(i.balance_due)}</td>
                      <td className="py-2"><Badge tone={tone}>{label}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Payment history</h3>
        {data.pay.length === 0 ? (
          <Empty>No payments recorded yet.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {data.pay.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <div className="font-medium">{inr(p.amount)}</div>
                  <div className="text-xs text-slate-500">
                    {date(p.paid_on)} · {MODE_LABEL[p.method]}
                    {p.reference_no && ` · Ref ${p.reference_no}`}
                  </div>
                </div>
                <span className="text-xs text-slate-500">{numberOf(p.invoice_id)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const PAYER_LABEL: Record<string, string> = {
  company: "Company",
  personal: "Personal",
  client: "Client paid directly",
  unused_fund: "From unused fund",
};

function AdFundsTab({ client }: { client: Client }) {
  const { workspace } = useWorkspace();
  const rows = useOnce(async () => {
    const { data } = await supabase
      .from("ad_fund_uploads")
      .select("amount, platform, payer_type, upload_date")
      .eq("workspace_id", workspace.id)
      .eq("client_id", client.id);
    return data ?? [];
  }, [workspace.id, client.id]);
  if (!rows) return <Spinner />;

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonthStart = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-01`;
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  const thisMonth = rows.filter((r) => r.upload_date >= monthStart && r.upload_date < nextMonthStart).reduce((s, r) => s + Number(r.amount), 0);
  const group = (key: "platform" | "payer_type") => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r[key], (m.get(r[key]) ?? 0) + Number(r.amount));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const target = Number(client.monthly_ad_target || 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Spent this month" value={inr(thisMonth)} />
        <Stat label="Monthly target" value={target ? inr(target) : "Not set"} />
        <Stat label="Spent in total" value={inr(total)} />
      </div>
      {target > 0 && (
        <div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full ${thisMonth > target ? "bg-red-500" : "bg-indigo-500"}`}
              style={{ width: `${Math.min(100, (thisMonth / target) * 100)}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-slate-500">{Math.round((thisMonth / target) * 100)}% of this month's target used.</p>
        </div>
      )}
      {rows.length === 0 ? (
        <Empty>No ad spend recorded for this client yet.</Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Breakdown title="By platform" rows={group("platform").map(([k, v]) => [platformLabel(k), v])} />
          <Breakdown title="Who paid" rows={group("payer_type").map(([k, v]) => [PAYER_LABEL[k] ?? k, v])} />
        </div>
      )}
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: [string, number][] }) {
  return (
    <section>
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      <ul className="divide-y divide-slate-100 text-sm">
        {rows.map(([k, v]) => (
          <li key={k} className="flex justify-between py-1.5">
            <span>{k}</span>
            <span>{inr(v)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const STAGE_LABEL: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  proposal_sent: "Proposal sent",
  won: "Won",
  lost: "Lost",
};

function LeadsTab({ clientId }: { clientId: string }) {
  const { workspace } = useWorkspace();
  const rows = useOnce(async () => {
    const { data } = await supabase
      .from("leads")
      .select("id, name, source, stage, value, created_at")
      .eq("workspace_id", workspace.id)
      .eq("converted_client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(50);
    return data ?? [];
  }, [workspace.id, clientId]);
  if (!rows) return <Spinner />;
  if (rows.length === 0) return <Empty>No leads have been converted into this client.</Empty>;
  return (
    <ul className="divide-y divide-slate-100 text-sm">
      {rows.map((l) => (
        <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
          <div>
            <div className="font-medium">{l.name}</div>
            <div className="text-xs text-slate-500">
              {l.source} · added {date(l.created_at)}
              {l.value != null && ` · ${inr(l.value)}`}
            </div>
          </div>
          <Badge>{STAGE_LABEL[l.stage] ?? l.stage}</Badge>
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-md bg-slate-50 p-3 ring-1 ring-slate-200">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-0.5 text-base font-semibold ${tone ?? ""}`}>{value}</div>
    </div>
  );
}
