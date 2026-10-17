import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
import { productName, useSiteInfo } from "../../lib/site";
import { AppShell, UserMenu, type NavGroup } from "../../components/AppShell";
import { Icon } from "../../components/icons";

export default function AdminLayout() {
  const { isPlatformAdmin } = useAuth();
  const { pathname } = useLocation();
  const info = useSiteInfo();
  const [pending, setPending] = useState(0);

  // Pending renewals badge; refreshed whenever you move between pages.
  useEffect(() => {
    if (!isPlatformAdmin) return;
    supabase
      .from("renewal_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .then(({ count }) => setPending(count ?? 0));
  }, [isPlatformAdmin, pathname]);

  if (!isPlatformAdmin) return <Navigate to="/" replace />;

  const groups: NavGroup[] = [
    {
      label: "Customers",
      items: [
        { to: "/admin", label: "Companies", icon: "building", end: true },
        { to: "/admin/renewals", label: "Renewals", icon: "refresh", badge: pending },
        { to: "/admin/payments", label: "Payments", icon: "wallet" },
        { to: "/admin/plans", label: "Plans", icon: "layers" },
      ],
    },
    {
      label: "Platform",
      items: [
        { to: "/admin/audit", label: "Audit log", icon: "log" },
        { to: "/admin/errors", label: "Errors", icon: "alert" },
        { to: "/admin/settings", label: "Settings", icon: "settings" },
      ],
    },
  ];

  const brand = (
    <div className="flex items-center gap-3 p-1.5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-gradient text-white shadow-brand">
        <Icon name="shield" className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-semibold text-white">{productName(info)}</span>
        <span className="block text-xs text-slate-400">Super Admin</span>
      </span>
    </div>
  );

  return (
    <AppShell brand={brand} groups={groups} right={<UserMenu roleLabel="Super Admin" />}>
      <Outlet />
    </AppShell>
  );
}
