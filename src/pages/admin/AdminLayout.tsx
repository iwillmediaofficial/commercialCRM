import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
import { productName, useSiteInfo } from "../../lib/site";
import { AppShell, UserMenu, type NavGroup } from "../../components/AppShell";

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
      <span className="min-w-0">
        <img src="/brand/logo-light.png" alt={productName(info)} className="block h-7 w-auto" />
        <span className="mt-1.5 block text-xs text-slate-400">Super Admin</span>
      </span>
    </div>
  );

  return (
    <AppShell brand={brand} groups={groups} right={<UserMenu roleLabel="Super Admin" />}>
      <Outlet />
    </AppShell>
  );
}
