import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { supabase, type Tables } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { useWorkspace } from "../../lib/workspace";
import { useLiveTable } from "../../lib/realtime";
import { useMembers, nameOf } from "../../lib/members";
import { inr } from "../../lib/format";
import { Icon, type IconName } from "../../components/icons";
import { Avatar } from "../../components/AppShell";

type Month = { key: string; label: string; long: string; total: number };
type Tone = "green" | "red" | "amber" | "slate";
type Kpi = {
  label: string;
  icon: IconName;
  chip: string;
  value: string;
  aside?: string;
  badge?: { text: string; tone: Tone };
  spark?: number[];
  sparkColor: string;
  to: string;
};
type DueItem = { id: string; title: string; sub: string; tag: string; tone: string; to: string };

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const localDay = (d = new Date()) => d.toLocaleDateString("en-CA");

// Last n months, oldest first.
function lastMonths(n: number): Month[] {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1);
    return {
      key: monthKey(d),
      label: d.toLocaleDateString("en-IN", { month: "short" }),
      long: d.toLocaleDateString("en-IN", { month: "long" }),
      total: 0,
    };
  });
}

// Counts per month (last 6) of a list of dates, oldest first.
function perMonth(dates: (string | null | undefined)[], weights?: number[]) {
  const m = lastMonths(6);
  dates.forEach((d, i) => {
    const b = d && m.find((x) => x.key === d.slice(0, 7));
    if (b) b.total += weights ? weights[i] : 1;
  });
  return m.map((x) => x.total);
}

// ₹3,86,400 -> ₹3.86L, ₹1,20,00,000 -> ₹1.2Cr; small amounts stay exact.
function short(n: number) {
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${+(n / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `₹${+(n / 1e5).toFixed(2)}L`;
  if (a >= 1e4) return `₹${+(n / 1e3).toFixed(1)}K`;
  return inr(n);
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

const PIPELINE = [
  { key: "new", label: "New", color: "bg-sky-500" },
  { key: "contacted", label: "Contacted", color: "bg-indigo-500" },
  { key: "qualified", label: "Qualified", color: "bg-violet-500" },
  { key: "proposal_sent", label: "Proposal sent", color: "bg-amber-500" },
];

export default function Dashboard() {
  const { workspace, isAdmin, role, canWrite, hasModule } = useWorkspace();
  const { session } = useAuth();
  const people = useMembers(workspace.id);
  const admin = isAdmin || role === null;
  const showMoney = hasModule("invoicing") && admin;
  const me = session?.user.id;

  const [firstName, setFirstName] = useState("");
  const [kpis, setKpis] = useState<Kpi[] | null>(null);
  const [months, setMonths] = useState<Month[]>(lastMonths(12));
  const [range, setRange] = useState<3 | 6 | 12>(6);
  const [billing, setBilling] = useState<{ label: string; count: number; amount: number; color: string }[]>([]);
  const [pipeline, setPipeline] = useState<{ label: string; count: number; color: string }[]>([]);
  const [openLeads, setOpenLeads] = useState({ count: 0, value: 0 });
  const [due, setDue] = useState<DueItem[]>([]);
  const [activity, setActivity] = useState<Tables<"activity_logs">[]>([]);

  useEffect(() => {
    if (!me) return;
    supabase.from("profiles").select("full_name").eq("id", me).maybeSingle()
      .then(({ data }) => setFirstName((data?.full_name ?? "").trim().split(/\s+/)[0] ?? ""));
  }, [me]);

  const load = useCallback(async () => {
    const ws = workspace.id;
    const today = localDay();
    const weekEnd = localDay(new Date(Date.now() + 6 * 86_400_000));
    const thisMonth = monthKey(new Date());
    const sixAgo = `${lastMonths(6)[0].key}-01`;
    const yearAgo = `${lastMonths(12)[0].key}-01`;
    const rows = <T,>(q: PromiseLike<{ data: T[] | null }>) => Promise.resolve(q).then((r) => r.data ?? []);
    const none = Promise.resolve([] as never[]);

    const [clients, work, leads, leadDates, wonCount, invoices, payments, logs] = await Promise.all([
      rows(supabase.from("clients").select("status, created_at").eq("workspace_id", ws)),
      hasModule("work")
        ? rows(supabase.from("work_items").select("id, title, status, priority, due_date, created_at, client:clients(company_name)")
            .eq("workspace_id", ws).neq("status", "completed"))
        : none,
      hasModule("leads")
        ? rows(supabase.from("leads").select("id, name, company, stage, value, follow_up_date, source")
            .eq("workspace_id", ws).not("stage", "in", "(won,lost)"))
        : none,
      hasModule("leads") ? rows(supabase.from("leads").select("created_at").eq("workspace_id", ws).gte("created_at", sixAgo)) : none,
      hasModule("leads")
        ? Promise.resolve(supabase.from("leads").select("id", { count: "exact", head: true }).eq("workspace_id", ws)
            .eq("stage", "won").gte("won_at", `${thisMonth}-01`)).then((r) => r.count ?? 0)
        : Promise.resolve(0),
      showMoney
        ? rows(supabase.from("invoices_with_status").select("display_status, balance_due, total, issue_date")
            .eq("workspace_id", ws).neq("status", "cancelled"))
        : none,
      showMoney ? rows(supabase.from("invoice_payments").select("amount, paid_on, invoices!inner(status)").eq("workspace_id", ws)
          .neq("invoices.status", "cancelled").gte("paid_on", yearAgo)) : none,
      admin ? rows(supabase.from("activity_logs").select("*").eq("workspace_id", ws).order("created_at", { ascending: false }).limit(8)) : none,
    ]);

    // Revenue per month, last 12.
    const m = lastMonths(12);
    for (const p of payments) {
      const b = m.find((x) => x.key === p.paid_on.slice(0, 7));
      if (b) b.total += Number(p.amount);
    }
    const thisM = m[m.length - 1].total;
    const lastM = m[m.length - 2].total;

    const active = clients.filter((c) => c.status === "active");
    const newClients = active.filter((c) => c.created_at.startsWith(thisMonth)).length;
    const overdueWork = work.filter((w) => w.due_date && w.due_date < today).length;
    const weekWork = work.filter((w) => w.due_date && w.due_date >= today && w.due_date <= weekEnd).length;
    const leadValue = leads.reduce((s, l) => s + Number(l.value ?? 0), 0);
    const newLeads = leadDates.filter((l) => l.created_at.startsWith(thisMonth)).length;
    const open = invoices.filter((i) => i.display_status === "pending" || i.display_status === "overdue");
    const overdueAmt = invoices.filter((i) => i.display_status === "overdue").reduce((s, i) => s + Number(i.balance_due), 0);
    const change = lastM > 0 ? Math.round(((thisM - lastM) / lastM) * 100) : null;
    const lastLabel = m[m.length - 2].label;

    const list: Kpi[] = [
      {
        label: "Active clients", icon: "clients", chip: "bg-sky-50 text-sky-600", value: String(active.length),
        badge: newClients ? { text: `+${newClients} new`, tone: "green" } : { text: "No new yet", tone: "slate" },
        spark: perMonth(clients.map((c) => c.created_at)), sparkColor: "#0ea5e9", to: "clients",
      },
    ];
    if (hasModule("work"))
      list.push({
        label: "Ongoing work", icon: "work", chip: "bg-indigo-50 text-indigo-600", value: String(work.length),
        aside: `${weekWork} due this week`,
        badge: overdueWork ? { text: `${overdueWork} overdue`, tone: "red" } : { text: "On track", tone: "green" },
        spark: perMonth(work.map((w) => w.created_at)), sparkColor: "#6366f1", to: "work",
      });
    if (hasModule("leads"))
      list.push({
        label: "Active leads", icon: "leads", chip: "bg-amber-50 text-amber-600", value: String(leads.length),
        aside: leadValue ? `${short(leadValue)} value` : undefined,
        badge: { text: `+${newLeads} new`, tone: newLeads ? "green" : "slate" },
        spark: perMonth(leadDates.map((l) => l.created_at)), sparkColor: "#f59e0b", to: "leads",
      });
    if (showMoney) {
      list.push({
        label: "Pending invoices", icon: "invoice", chip: "bg-rose-50 text-rose-600",
        value: short(open.reduce((s, i) => s + Number(i.balance_due), 0)), aside: `${open.length} open`,
        badge: overdueAmt ? { text: `${short(overdueAmt)} overdue`, tone: "red" } : { text: "Nothing overdue", tone: "green" },
        spark: perMonth(invoices.map((i) => i.issue_date), invoices.map((i) => Number(i.total))), sparkColor: "#f43f5e", to: "invoices",
      });
      list.push({
        label: "Collected", icon: "rupee", chip: "bg-emerald-50 text-emerald-600", value: short(thisM), aside: "this month",
        badge: change === null ? undefined : { text: `${change >= 0 ? "+" : ""}${change}% vs ${lastLabel}`, tone: change >= 0 ? "green" : "red" },
        spark: m.slice(-6).map((x) => x.total), sparkColor: "#10b981", to: "invoices",
      });
    }

    const group = (s: string) => invoices.filter((i) => i.display_status === s);
    setBilling(
      [
        ["paid", "Paid", "#10b981"],
        ["pending", "Pending", "#f59e0b"],
        ["overdue", "Overdue", "#ef4444"],
        ["draft", "Draft", "#94a3b8"],
      ].map(([s, label, color]) => ({
        label,
        color,
        count: group(s).length,
        amount: group(s).reduce((sum, i) => sum + Number(s === "paid" ? i.total : s === "draft" ? i.total : i.balance_due), 0),
      })),
    );

    setPipeline([
      ...PIPELINE.map((p) => ({ label: p.label, color: p.color, count: leads.filter((l) => l.stage === p.key).length })),
      { label: `Won (${m[m.length - 1].label})`, color: "bg-emerald-500", count: wonCount },
    ]);
    setOpenLeads({ count: leads.length, value: leadValue });

    // Due today: open tasks due today or earlier, then lead follow-ups.
    const tasks: DueItem[] = work
      .filter((w) => w.due_date && w.due_date <= today)
      .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1))
      .map((w) => {
        const late = w.due_date! < today;
        const client = (w.client as { company_name: string } | null)?.company_name;
        return {
          id: w.id,
          title: w.title,
          sub: [client, w.status.replace(/_/g, " ")].filter(Boolean).join(" · "),
          tag: w.priority === "urgent" ? "Urgent" : late ? "Overdue" : "Today",
          tone: w.priority === "urgent" || late ? "bg-red-50 text-red-600" : "bg-indigo-50 text-indigo-600",
          to: `work?open=${w.id}`,
        };
      });
    const follow: DueItem[] = leads
      .filter((l) => l.follow_up_date && l.follow_up_date <= today)
      .map((l) => ({
        id: l.id,
        title: `Follow up ${l.name}`,
        sub: ["Lead", l.company || l.source].filter(Boolean).join(" · "),
        tag: "Follow-up",
        tone: "bg-amber-50 text-amber-700",
        to: `leads?open=${l.id}`,
      }));
    setDue([...tasks, ...follow]);

    setKpis(list);
    setMonths(m);
    setActivity(logs);
  }, [workspace.id, hasModule, showMoney, admin]);

  useEffect(() => {
    load();
  }, [load]);

  useLiveTable(["work_items", "leads", "invoices", "clients"], `workspace_id=eq.${workspace.id}`, load, { delay: 1000 });

  const actions = [
    { label: "Log a lead", to: "leads?new=1", show: hasModule("leads") },
    { label: "Create a task", to: "work?new=1", show: hasModule("work") && isAdmin },
    { label: "Upload ad funds", to: "ad-funds", show: hasModule("ad_funds") && isAdmin },
    { label: "New invoice", to: "invoices?new=1", show: showMoney && isAdmin },
  ].filter((a) => a.show && canWrite);

  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
  const shown = months.slice(-range);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[28px]">
            {greeting()}{firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="mt-1 text-sm text-slate-500">{today} · Here's how {workspace.name} is doing this month.</p>
        </div>
        {actions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {actions.map((a, i) => {
              const primary = i === actions.length - 1 && a.label === "New invoice";
              return (
                <Link
                  key={a.label}
                  to={a.to}
                  className={
                    primary
                      ? "inline-flex items-center gap-1.5 rounded-xl bg-brand-gradient px-4 py-2.5 text-sm font-semibold text-white shadow-brand transition hover:brightness-110"
                      : "inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50"
                  }
                >
                  <Icon name="plus" className="h-4 w-4" /> {a.label}
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <div className={`grid grid-cols-2 gap-3 sm:gap-4 ${kpis && kpis.length >= 5 ? "xl:grid-cols-5" : "xl:grid-cols-3"}`}>
        {(kpis ?? []).map((k) => <KpiCard key={k.label} k={k} />)}
        {!kpis && Array.from({ length: 5 }, (_, i) => <div key={i} className="h-[148px] animate-pulse rounded-2xl bg-white ring-1 ring-slate-200/70" />)}
      </div>

      {showMoney && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel
            className="lg:col-span-2"
            title="Revenue collected"
            sub={`${short(shown.reduce((s, m) => s + m.total, 0))} in the last ${range} months · avg ${short(shown.reduce((s, m) => s + m.total, 0) / range)} a month`}
            action={
              <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs font-semibold">
                {([3, 6, 12] as const).map((r) => (
                  <button
                    key={r}
                    className={`rounded-md px-3 py-1.5 transition ${range === r ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                    onClick={() => setRange(r)}
                  >
                    {r}M
                  </button>
                ))}
              </div>
            }
          >
            <RevenueChart months={shown} />
          </Panel>
          <Panel title="Invoices by status" sub={`${billing.reduce((s, b) => s + b.count, 0)} invoices`}>
            <Donut billing={billing} />
          </Panel>
        </div>
      )}

      <div className={`grid gap-4 ${admin ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}>
        {hasModule("leads") && (
          <Panel title="Lead pipeline" sub={`${openLeads.count} open${openLeads.value ? ` · ${short(openLeads.value)} potential` : ""}`}>
            <Pipeline rows={pipeline} />
          </Panel>
        )}
        <Panel
          title="Due today"
          sub="Tasks and follow-ups"
          action={due.length > 0 && <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-600">{due.length}</span>}
          flush
        >
          {due.length === 0 ? (
            <EmptyState icon="check" text="Nothing due today. Nice work." />
          ) : (
            <ul className="max-h-[300px] divide-y divide-slate-100 overflow-y-auto">
              {due.slice(0, 20).map((d) => (
                <li key={d.id}>
                  <Link to={d.to} className="flex items-center gap-3 px-5 py-3 transition hover:bg-slate-50">
                    <span className="h-[18px] w-[18px] shrink-0 rounded-md ring-[1.5px] ring-slate-300" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">{d.title}</span>
                      <span className="block truncate text-xs text-slate-500 capitalize">{d.sub}</span>
                    </span>
                    <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold ${d.tone}`}>{d.tag}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        {admin && (
          <Panel
            title="Recent activity"
            sub="Updates as your team works"
            action={
              <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                Live
              </span>
            }
          >
            {activity.length === 0 ? (
              <EmptyState icon="log" text="Activity shows up here as your team works." />
            ) : (
              <ul className="max-h-[300px] space-y-4 overflow-y-auto">
                {activity.map((a) => {
                  const who = nameOf(people, a.actor_id) || (a.actor_id ? "Someone" : "Lead form");
                  return (
                    <li key={a.id} className="flex gap-3">
                      <Avatar name={who} className="h-9 w-9 text-[11px]" />
                      <div className="min-w-0 text-sm">
                        <p className="text-slate-700">
                          <span className="font-semibold text-slate-900">{who}</span> {describe(a)}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-400">{when(a.created_at)}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        )}
      </div>
    </>
  );
}

function Panel({
  title,
  sub,
  action,
  className = "",
  flush,
  children,
}: {
  title: string;
  sub?: string;
  action?: ReactNode;
  className?: string;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`min-w-0 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70 ${flush ? "pb-2" : "pb-5"} ${className}`}>
      <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">{title}</h2>
          {sub && <p className="mt-0.5 truncate text-[13px] text-slate-500">{sub}</p>}
        </div>
        {action}
      </div>
      <div className={flush ? "" : "px-5"}>{children}</div>
    </section>
  );
}

function EmptyState({ icon, text }: { icon: IconName; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-5 py-8 text-center text-sm text-slate-500">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        <Icon name={icon} className="h-5 w-5" />
      </span>
      {text}
    </div>
  );
}

const BADGE: Record<Tone, string> = {
  green: "bg-emerald-50 text-emerald-700",
  red: "bg-red-50 text-red-600",
  amber: "bg-amber-50 text-amber-700",
  slate: "bg-slate-100 text-slate-500",
};

function KpiCard({ k }: { k: Kpi }) {
  return (
    <Link
      to={k.to}
      className="group min-w-0 rounded-2xl bg-white p-[18px] shadow-sm ring-1 ring-slate-200/70 transition hover:-translate-y-0.5 hover:shadow-md hover:ring-slate-300"
    >
      <div className="flex items-center gap-2 sm:gap-3">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl sm:h-9 sm:w-9 ${k.chip}`}>
          <Icon name={k.icon} className="h-4 w-4 sm:h-[18px] sm:w-[18px]" />
        </span>
        <span className="truncate text-[13px] font-medium text-slate-500 sm:text-sm">{k.label}</span>
      </div>
      <div className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-2xl leading-none font-bold sm:text-[28px] tracking-tight text-slate-900 tabular-nums">{k.value}</span>
        {k.aside && <span className="truncate text-xs text-slate-500"><span className="hidden sm:inline">· </span>{k.aside}</span>}
      </div>
      <div className="mt-4 flex items-end justify-between gap-2">
        {k.badge ? <span className={`min-w-0 truncate rounded-md px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${BADGE[k.badge.tone]}`}>{k.badge.text}</span> : <span />}
        {k.spark && <span className="hidden sm:block"><Sparkline values={k.spark} color={k.sparkColor} /></span>}
      </div>
    </Link>
  );
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const w = 64;
  const h = 26;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 3 - ((v - min) / (max - min || 1)) * (h - 6)]);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0 overflow-visible" aria-hidden>
      <path d={smooth(pts)} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// Catmull-Rom to Bezier: a smooth line through every point.
function smooth(p: number[][]) {
  if (p.length < 2) return "";
  let d = `M${p[0][0]},${p[0][1]}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
  }
  return d;
}

// Round the chart's top value up to a tidy number.
function niceMax(v: number) {
  if (v <= 0) return 1000;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((x) => x * p).find((x) => x >= v)!;
}

function RevenueChart({ months }: { months: Month[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = 240;
  const pad = { l: 44, r: 16, t: 16, b: 28 };
  const max = niceMax(Math.max(...months.map((m) => m.total)));
  const x = (i: number) => pad.l + (months.length === 1 ? 0 : (i / (months.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const pts = months.map((m, i) => [x(i), y(m.total)]);
  const line = smooth(pts);
  const area = `${line} L${x(months.length - 1)},${H - pad.b} L${x(0)},${H - pad.b} Z`;
  const ticks = [0.25, 0.5, 0.75, 1].map((f) => f * max);
  const pick = hover ?? months.length - 1;
  const tip = months[pick];
  const empty = months.every((m) => m.total === 0);
  // Near the top, the tooltip sits under the point so it never covers the range buttons.
  const below = pts[pick][1] / H < 0.35;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Revenue collected per month"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          let best = 0;
          pts.forEach((p, i) => Math.abs(p[0] - px) < Math.abs(pts[best][0] - px) && (best = i));
          setHover(best);
        }}
      >
        <defs>
          <linearGradient id="rev-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#6d5ff5" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#6d5ff5" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="rev-line" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#5b5bf0" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#eef0f4" />
            <text x={pad.l - 10} y={y(t) + 4} textAnchor="end" className="fill-slate-400 text-[11px]">{short(t).replace(".00", "")}</text>
          </g>
        ))}
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="#e2e8f0" />
        {!empty && <path d={area} fill="url(#rev-fill)" />}
        <path d={line} fill="none" stroke="url(#rev-line)" strokeWidth="3" strokeLinecap="round" />
        {months.map((m, i) => (
          <text key={m.key} x={x(i)} y={H - 8} textAnchor="middle" className={`text-[11px] ${i === pick ? "fill-slate-700 font-semibold" : "fill-slate-400"}`}>
            {m.label}
          </text>
        ))}
        <line x1={pts[pick][0]} x2={pts[pick][0]} y1={pad.t} y2={H - pad.b} stroke="#c7c9f9" strokeDasharray="3 4" />
        <circle cx={pts[pick][0]} cy={pts[pick][1]} r="6" fill="white" stroke="#6d5ff5" strokeWidth="3" />
      </svg>
      <div
        className="pointer-events-none absolute rounded-lg bg-slate-900 px-3 py-1.5 text-white shadow-lg"
        style={{
          left: `${Math.min(88, Math.max(12, (pts[pick][0] / W) * 100))}%`,
          top: below ? `calc(${(pts[pick][1] / H) * 100}% + 16px)` : `calc(${(pts[pick][1] / H) * 100}% - 12px)`,
          transform: `translateX(-50%) translateY(${below ? "0" : "-100%"})`,
        }}
      >
        <div className="text-[11px] text-slate-300">{tip.long}</div>
        <div className="text-sm font-semibold tabular-nums">{inr(tip.total)}</div>
      </div>
      <table className="sr-only">
        <tbody>
          {months.map((m) => (
            <tr key={m.key}><td>{m.long}</td><td>{inr(m.total)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Donut({ billing }: { billing: { label: string; count: number; amount: number; color: string }[] }) {
  const total = billing.reduce((s, b) => s + b.amount, 0);
  const paid = billing.find((b) => b.label === "Paid")?.amount ?? 0;
  const billed = billing.filter((b) => b.label !== "Draft").reduce((s, b) => s + b.amount, 0);
  const pct = billed ? Math.round((paid / billed) * 100) : 0;
  const r = 52;
  const c = 2 * Math.PI * r;
  const segs = useMemo(() => {
    let off = 0;
    return billing
      .filter((b) => b.amount > 0)
      .map((b) => {
        const len = (b.amount / total) * c;
        const seg = { ...b, len, off };
        off += len;
        return seg;
      });
  }, [billing, total, c]);

  return (
    <div>
      <div className="relative mx-auto h-44 w-44">
        <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
          <circle cx="70" cy="70" r={r} fill="none" stroke="#f1f5f9" strokeWidth="16" />
          {segs.map((s) => (
            <circle
              key={s.label}
              cx="70"
              cy="70"
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth="16"
              strokeDasharray={`${Math.max(0, s.len - (segs.length > 1 ? 2 : 0))} ${c}`}
              strokeDashoffset={-s.off}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold tracking-tight text-slate-900">{pct}%</span>
          <span className="text-xs text-slate-500">collected</span>
        </div>
      </div>
      <ul className="mt-5 space-y-2.5 text-sm">
        {billing.map((b) => (
          <li key={b.label} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2.5 text-slate-700">
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: b.color }} aria-hidden />
              {b.label} <span className="text-slate-400">{b.count}</span>
            </span>
            <span className="font-semibold tabular-nums text-slate-900">{inr(b.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Pipeline({ rows }: { rows: { label: string; count: number; color: string }[] }) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <ul className="space-y-4">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[110px_1fr_28px] items-center gap-3 text-sm">
          <span className="truncate text-slate-700">{r.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-slate-100">
            <span className={`block h-full rounded-full ${r.color}`} style={{ width: `${(r.count / max) * 100}%` }} />
          </span>
          <span className="text-right font-semibold tabular-nums text-slate-900">{r.count}</span>
        </li>
      ))}
    </ul>
  );
}

function when(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  const days = Math.round((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (days === 0) return `${time} · today`;
  if (days === 1) return `${time} · yesterday`;
  return `${time} · ${d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`;
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
