import { useEffect, useState } from "react";
import { Link } from "react-router";
import { supabase, type Tables } from "../../lib/supabase";
import { useWorkspace } from "../../lib/workspace";
import { useMembers, nameOf } from "../../lib/members";
import { inr } from "../../lib/format";
import { Card, Empty } from "../../components/ui";

type Kpi = { label: string; value: string; to: string };
type Month = { key: string; label: string; total: number };

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

// Last six months, oldest first.
function lastMonths(n = 6): Month[] {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1);
    return { key: monthKey(d), label: d.toLocaleDateString("en-IN", { month: "short" }), total: 0 };
  });
}

export default function Dashboard() {
  const { workspace, isAdmin, role, canWrite, hasModule } = useWorkspace();
  const people = useMembers(workspace.id);
  const admin = isAdmin || role === null;
  const showMoney = hasModule("invoicing") && admin;
  const [kpis, setKpis] = useState<Kpi[] | null>(null);
  const [months, setMonths] = useState<Month[]>([]);
  const [billing, setBilling] = useState<{ label: string; count: number; amount: number; tone: string }[]>([]);
  const [activity, setActivity] = useState<Tables<"activity_logs">[]>([]);

  useEffect(() => {
    const ws = workspace.id;
    const count = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then((r) => r.count ?? 0);
    const from = `${lastMonths()[0].key}-01`;
    (async () => {
      const [clients, work, leads, invoices, payments, logs] = await Promise.all([
        count(supabase.from("clients").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("status", "active")),
        hasModule("work")
          ? count(supabase.from("work_items").select("id", { count: "exact", head: true }).eq("workspace_id", ws).neq("status", "completed"))
          : Promise.resolve(null),
        hasModule("leads")
          ? count(supabase.from("leads").select("id", { count: "exact", head: true }).eq("workspace_id", ws).not("stage", "in", "(won,lost)"))
          : Promise.resolve(null),
        showMoney
          ? supabase.from("invoices_with_status").select("display_status, balance_due, total").eq("workspace_id", ws).neq("status", "cancelled").then((r) => r.data ?? [])
          : Promise.resolve([]),
        showMoney
          ? supabase.from("invoice_payments").select("amount, paid_on").eq("workspace_id", ws).gte("paid_on", from).then((r) => r.data ?? [])
          : Promise.resolve([]),
        !admin ? Promise.resolve([]) : supabase.from("activity_logs").select("*").eq("workspace_id", ws).order("created_at", { ascending: false }).limit(15).then((r) => r.data ?? []),
      ]);

      const m = lastMonths();
      for (const p of payments) {
        const bucket = m.find((x) => x.key === p.paid_on.slice(0, 7));
        if (bucket) bucket.total += Number(p.amount);
      }
      const open = invoices.filter((i) => i.display_status === "pending" || i.display_status === "overdue");
      const list: Kpi[] = [{ label: "Active clients", value: String(clients), to: "clients" }];
      if (work !== null) list.push({ label: "Ongoing work items", value: String(work), to: "work" });
      if (leads !== null) list.push({ label: "Active leads", value: String(leads), to: "leads" });
      if (showMoney) {
        list.push({ label: "Pending invoices", value: `${open.length} · ${inr(open.reduce((s, i) => s + Number(i.balance_due), 0))}`, to: "invoices" });
        list.push({ label: "Collected this month", value: inr(m[m.length - 1].total), to: "invoices" });
      }
      const group = (s: string) => invoices.filter((i) => i.display_status === s);
      setBilling(
        [
          ["paid", "Paid", "bg-green-600"],
          ["pending", "Pending", "bg-amber-500"],
          ["overdue", "Overdue", "bg-red-600"],
          ["draft", "Draft", "bg-slate-400"],
        ].map(([s, label, tone]) => ({
          label,
          tone,
          count: group(s).length,
          amount: group(s).reduce((sum, i) => sum + Number(s === "paid" ? i.total : i.balance_due), 0),
        })),
      );
      setKpis(list);
      setMonths(m);
      setActivity(logs);
    })();
  }, [workspace.id, hasModule, showMoney, admin]);

  const actions = [
    { label: "Log a lead", to: "leads", show: hasModule("leads") },
    { label: "Create a task", to: "work", show: hasModule("work") && admin },
    { label: "Upload ad funds", to: "ad-funds", show: hasModule("ad_funds") && admin },
    { label: "Create an invoice", to: "invoices", show: showMoney },
  ].filter((a) => a.show && canWrite);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {(kpis ?? []).map((k) => (
          <Link key={k.label} to={k.to} className="rounded-lg bg-white p-4 shadow-sm ring-1 ring-slate-200 hover:ring-indigo-300">
            <div className="text-xs text-slate-500">{k.label}</div>
            <div className="mt-1 text-xl font-semibold">{k.value}</div>
          </Link>
        ))}
        {!kpis && <div className="col-span-full text-sm text-slate-500">Loading…</div>}
      </div>

      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <Link key={a.label} to={a.to} className="rounded-full bg-white px-3 py-1.5 text-sm text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-50">
              + {a.label}
            </Link>
          ))}
        </div>
      )}

      {showMoney && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card title="Revenue collected, last 6 months">
              <RevenueBars months={months} />
            </Card>
          </div>
          <Card title="Invoices by status">
            <ul className="space-y-2 text-sm">
              {billing.map((b) => (
                <li key={b.label} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${b.tone}`} aria-hidden />
                    {b.label} <span className="text-slate-500">({b.count})</span>
                  </span>
                  <span className="font-medium">{inr(b.amount)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      {admin && (
      <Card title="Recent activity">
        {activity.length === 0 ? (
          <Empty>Nothing yet. Activity shows up here as your team works.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {activity.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{nameOf(people, a.actor_id) || "Someone"}</span>{" "}
                  {describe(a)}
                </span>
                <span className="text-xs text-slate-400">{new Date(a.created_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      )}
    </>
  );
}

const ENTITY: Record<string, string> = {
  lead: "lead",
  client: "client",
  work_item: "task",
  invoice: "invoice",
  payment: "payment",
  timer: "timer",
  ad_fund: "ad fund upload",
};

function describe(a: Tables<"activity_logs">) {
  const thing = ENTITY[a.entity_type] ?? a.entity_type;
  const what = a.summary ? ` “${a.summary.replace(/_/g, " ")}”` : "";
  switch (a.action) {
    case "created":
      return a.entity_type === "payment" ? "logged a payment" : `added ${thing}${what}`;
    case "deleted":
      return `deleted ${thing}${what}`;
    case "status_changed":
      return `moved ${thing}${what}`;
    case "timer_stopped":
      return "stopped a timer";
    default:
      return `${a.action.replace(/_/g, " ")} ${thing}${what}`;
  }
}

// Single-series bar chart: one hue, rounded tops, hover shows the exact amount.
function RevenueBars({ months }: { months: Month[] }) {
  const max = Math.max(...months.map((m) => m.total), 1);
  return (
    <div>
      <div className="flex h-40 items-end gap-3 border-b border-slate-200" role="img" aria-label="Revenue collected per month">
        {months.map((m, i) => (
          <div key={m.key} className="group relative flex h-full flex-1 flex-col justify-end">
            <div
              className="mx-auto w-full max-w-10 rounded-t bg-indigo-600 transition-opacity group-hover:opacity-80"
              style={{ height: `${(m.total / max) * 100}%`, minHeight: m.total ? 2 : 0 }}
            />
            <div className="pointer-events-none absolute -top-7 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-0.5 text-xs text-white group-hover:block">
              {m.label}: {inr(m.total)}
            </div>
            {i === months.length - 1 && m.total > 0 && (
              <div className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs text-slate-600 group-hover:hidden">{inr(m.total)}</div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-3">
        {months.map((m) => (
          <div key={m.key} className="flex-1 text-center text-xs text-slate-500">{m.label}</div>
        ))}
      </div>
      <table className="sr-only">
        <tbody>
          {months.map((m) => (
            <tr key={m.key}><td>{m.label}</td><td>{inr(m.total)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
