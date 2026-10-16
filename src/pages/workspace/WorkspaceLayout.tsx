import { useEffect, useState } from "react";
import { Link, NavLink, Navigate, Outlet, useParams } from "react-router";
import { supabase, type Tables } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { StatusBadge, type WorkspaceStatus } from "../../lib/status";
import { WorkspaceContext, type WorkspaceCtx } from "../../lib/workspace";
import { Alert, Spinner } from "../../components/ui";
import { TopBar } from "../../components/TopBar";
import { TimerBar } from "../../components/TimerBar";

export default function WorkspaceLayout() {
  const { slug } = useParams();
  const { memberships, isPlatformAdmin } = useAuth();
  const [ctx, setCtx] = useState<WorkspaceCtx | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: ws } = await supabase.from("workspaces").select("*, plan:plans(*)").eq("slug", slug ?? "").maybeSingle();
      if (cancelled) return;
      if (!ws) return setMissing(true);
      const { data: status } = await supabase.rpc("workspace_status", { ws: ws.id });
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

  if (missing) return <Navigate to="/" replace />;
  if (!ctx) return <Spinner />;

  const support = isPlatformAdmin && !ctx.role;
  const admin = ctx.isAdmin || support;
  const nav = [
    { to: "", label: "Dashboard", show: true },
    { to: "leads", label: "Leads", show: ctx.hasModule("leads") },
    { to: "lead-forms", label: "Lead forms", show: ctx.hasModule("leads") && admin },
    { to: "clients", label: "Clients", show: true },
    { to: "work", label: "Work", show: ctx.hasModule("work") },
    { to: "time", label: "Time", show: ctx.hasModule("work") },
    { to: "invoices", label: "Invoices", show: ctx.hasModule("invoicing") && admin },
    { to: "recurring", label: "Recurring billing", show: ctx.hasModule("invoicing") && admin },
    { to: "calendar", label: "Billing calendar", show: ctx.hasModule("invoicing") && admin },
    { to: "ad-funds", label: "Ad funds", show: ctx.hasModule("ad_funds") && admin },
    { to: "team", label: "Team", show: true },
    { to: "settings", label: "Settings", show: admin },
    { to: "billing", label: "Subscription", show: ctx.isAdmin },
  ].filter((n) => n.show);

  return (
    <WorkspaceContext.Provider value={ctx}>
      <TopBar title={ctx.workspace.name} workspace={ctx.workspace} />
      {ctx.hasModule("work") && ctx.role && <TimerBar />}
      <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 md:flex-row">
        <nav className="flex gap-1 overflow-x-auto md:w-48 md:flex-col">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === ""}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-md px-3 py-2 text-sm ${isActive ? "bg-indigo-50 font-medium text-indigo-700" : "text-slate-600 hover:bg-slate-100"}`
              }
            >
              {n.label}
            </NavLink>
          ))}
          <div className="px-3 py-2"><StatusBadge status={ctx.status} /></div>
        </nav>
        <main className="min-w-0 flex-1 space-y-4">
          {subscriptionBanner()}
          <Outlet />
        </main>
      </div>
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
