import { useEffect, useState } from "react";
import { Link, Navigate, Outlet, useLocation, useParams } from "react-router";
import { supabase, type Tables } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { STATUS_LABEL, type WorkspaceStatus } from "../../lib/status";
import { WorkspaceContext, type WorkspaceCtx } from "../../lib/workspace";
import { Alert, Spinner } from "../../components/ui";
import { TimerBar } from "../../components/TimerBar";
import { NotificationBell } from "../../components/NotificationBell";
import { StoredImage } from "../../components/Files";
import { Icon } from "../../components/icons";
import { AppShell, UserMenu, type NavGroup } from "../../components/AppShell";
import { WorkspaceSearch } from "../../components/Search";
import { date, daysLeft } from "../../lib/format";

export default function WorkspaceLayout() {
  const { slug } = useParams();
  const { memberships, isPlatformAdmin } = useAuth();
  const [ctx, setCtx] = useState<WorkspaceCtx | null>(null);
  const [missing, setMissing] = useState(false);
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [counts, setCounts] = useState({ newLeads: 0, dueWork: 0 });
  const { pathname } = useLocation();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: ws } = await supabase.from("workspaces").select("*, plan:plans(*)").eq("slug", slug ?? "").maybeSingle();
      if (cancelled) return;
      if (!ws) return setMissing(true);
      const [{ data: status }, { data: settings }] = await Promise.all([
        supabase.rpc("workspace_status", { ws: ws.id }),
        supabase.from("workspace_settings").select("logo_path").eq("workspace_id", ws.id).maybeSingle(),
      ]);
      if (cancelled) return;
      setLogoPath(settings?.logo_path ?? null);
      const { plan, ...workspace } = ws as Tables<"workspaces"> & { plan: Tables<"plans"> | null };
      const role = memberships.find((m) => m.workspace_id === ws.id)?.role ?? null;
      const s = (status ?? "expired") as WorkspaceStatus;
      const isAdmin = role === "owner" || role === "admin";
      setCtx({
        workspace,
        plan,
        role,
        status: s,
        isAdmin,
        canWrite: role !== null && ["trial", "active", "grace"].includes(s),
        hasModule: (m) => Boolean(plan?.modules.includes(m)),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, memberships]);

  // Settings saves a new logo right away; pick it up without a reload.
  const workspaceId = ctx?.workspace.id;
  useEffect(() => {
    if (!workspaceId) return;
    const reload = async () => {
      const { data } = await supabase.from("workspace_settings").select("logo_path").eq("workspace_id", workspaceId).maybeSingle();
      setLogoPath(data?.logo_path ?? null);
    };
    window.addEventListener("workspace-logo-changed", reload);
    return () => window.removeEventListener("workspace-logo-changed", reload);
  }, [workspaceId]);

  // Sidebar badges: leads still in "New", and open tasks due today or earlier.
  // Refreshed whenever you move between pages.
  const hasLeads = ctx?.hasModule("leads");
  const hasWork = ctx?.hasModule("work");
  useEffect(() => {
    if (!workspaceId) return;
    const today = new Date().toLocaleDateString("en-CA");
    Promise.all([
      hasLeads
        ? supabase.from("leads").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("stage", "new")
        : null,
      hasWork
        ? supabase.from("work_items").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId)
            .neq("status", "completed").lte("due_date", today)
        : null,
    ]).then(([l, w]) => setCounts({ newLeads: l?.count ?? 0, dueWork: w?.count ?? 0 }));
  }, [workspaceId, hasLeads, hasWork, pathname]);

  if (missing) return <Navigate to="/" replace />;
  if (!ctx) return <Spinner />;

  const support = isPlatformAdmin && !ctx.role;
  const admin = ctx.isAdmin || support;
  const groups: NavGroup[] = [
    { items: [{ to: "", label: "Dashboard", icon: "dashboard", end: true }] },
    {
      label: "Sales",
      items: [
        ctx.hasModule("leads") && { to: "leads", label: "Leads", icon: "leads", badge: counts.newLeads },
        ctx.hasModule("leads") && admin && { to: "lead-forms", label: "Lead forms", icon: "forms" },
        { to: "clients", label: "Clients", icon: "clients" },
      ],
    },
    {
      label: "Delivery",
      items: [
        ctx.hasModule("work") && { to: "work", label: "Work board", icon: "work", badge: counts.dueWork },
        ctx.hasModule("work") && { to: "time", label: "Time", icon: "time" },
      ],
    },
    {
      label: "Money",
      items: [
        ctx.hasModule("invoicing") && admin && { to: "invoices", label: "Invoices", icon: "invoice" },
        ctx.hasModule("invoicing") && admin && { to: "recurring", label: "Recurring billing", icon: "recurring" },
        ctx.hasModule("invoicing") && admin && { to: "calendar", label: "Billing calendar", icon: "calendar" },
        ctx.hasModule("ad_funds") && admin && { to: "ad-funds", label: "Ad funds", icon: "megaphone" },
      ],
    },
    {
      label: "Company",
      items: [
        { to: "team", label: "Team", icon: "team" },
        admin && { to: "settings", label: "Settings", icon: "settings" },
        ctx.isAdmin && { to: "billing", label: "Subscription", icon: "card" },
      ],
    },
  ]
    .map((g) => ({ ...g, items: g.items.filter(Boolean) }))
    .filter((g) => g.items.length > 0) as NavGroup[];

  const multi = memberships.length > 1;
  const brand = (
    <Link to={multi ? "/" : ""} className="flex items-center gap-3 rounded-xl p-1.5 transition hover:bg-white/5" title={multi ? "Switch company" : undefined}>
      {logoPath ? (
        <StoredImage storageKey={logoPath} className="h-10 w-10 shrink-0 rounded-xl bg-white object-cover" />
      ) : (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-300 to-orange-500 text-lg font-bold text-slate-900 shadow-lg shadow-orange-500/20">
          {ctx.workspace.name.trim()[0]?.toUpperCase()}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-white">{ctx.workspace.name}</span>
        <span className="block text-xs text-slate-400">{ctx.role ? "Workspace" : "Viewing as Super Admin"}</span>
      </span>
      {multi && <Icon name="chevrons" className="h-4 w-4 shrink-0 text-slate-500" />}
    </Link>
  );

  const left = daysLeft(ctx.workspace.valid_until);
  const planCard = (
    <Link
      to={ctx.isAdmin ? "billing" : ""}
      className="block rounded-xl bg-white/[0.04] p-3.5 ring-1 ring-white/10 transition hover:bg-white/[0.07]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold text-white">{ctx.plan?.name ?? "No plan"}</span>
        <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${PLAN_TONE[ctx.status]}`}>{STATUS_LABEL[ctx.status].replace(" (read-only)", "")}</span>
      </div>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-brand-gradient" style={{ width: `${Math.max(4, Math.min(100, (left / 30) * 100))}%` }} />
      </div>
      <div className="mt-2 flex justify-between gap-2 text-[11px] text-slate-400">
        <span>{left >= 0 ? "Renews" : "Ended"} {date(ctx.workspace.valid_until)}</span>
        <span>{left >= 0 ? `${left} day${left === 1 ? "" : "s"} left` : "Renew now"}</span>
      </div>
    </Link>
  );

  return (
    <WorkspaceContext.Provider value={ctx}>
      <AppShell
        brand={brand}
        groups={groups}
        sidebarFooter={planCard}
        search={<WorkspaceSearch />}
        right={
          <>
            {ctx.hasModule("work") && ctx.role && <TimerBar />}
            <NotificationBell workspace={ctx.workspace} />
            <UserMenu roleLabel={ctx.role ?? "Super Admin"} />
          </>
        }
      >
        {subscriptionBanner()}
        <Outlet />
      </AppShell>
    </WorkspaceContext.Provider>
  );

  function subscriptionBanner() {
    if (!ctx) return null;
    const until = new Date(ctx.workspace.valid_until).toLocaleDateString();
    if (ctx.role === null)
      return (
        <Alert tone="info">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>You are viewing {ctx.workspace.name} as Super Admin. Nothing can be changed from here.</span>
            <Link className="font-medium underline" to="/admin">Exit to Super Admin</Link>
          </div>
        </Alert>
      );
    if (ctx.status === "grace") return <Alert tone="warning">The subscription ended on {until}. Renew soon to keep editing.</Alert>;
    if (ctx.status === "expired") return <Alert>The subscription ended on {until}. Everything is read-only until it is renewed.</Alert>;
    if (ctx.status === "suspended") return <Alert>This company is suspended. Contact support.</Alert>;
    if (ctx.status === "trial") return <Alert tone="info">Trial until {until}.</Alert>;
    return null;
  }
}

const PLAN_TONE: Record<WorkspaceStatus, string> = {
  trial: "bg-sky-400/15 text-sky-300",
  active: "bg-emerald-400/15 text-emerald-300",
  grace: "bg-amber-400/15 text-amber-300",
  expired: "bg-red-400/15 text-red-300",
  suspended: "bg-slate-400/15 text-slate-300",
};
