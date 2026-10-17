import { useEffect, useState } from "react";
import { NavLink, Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
import { TopBar } from "../../components/TopBar";

const tabs = [
  { to: "/admin", label: "Companies", end: true },
  { to: "/admin/renewals", label: "Renewals" },
  { to: "/admin/payments", label: "Payments" },
  { to: "/admin/plans", label: "Plans" },
  { to: "/admin/audit", label: "Audit log" },
  { to: "/admin/settings", label: "Settings" },
  { to: "/admin/errors", label: "Errors" },
];

export default function AdminLayout() {
  const { isPlatformAdmin } = useAuth();
  const { pathname } = useLocation();
  const [pending, setPending] = useState(0);

  // Pending renewals badge; refreshed whenever you move between tabs.
  useEffect(() => {
    if (!isPlatformAdmin) return;
    supabase
      .from("renewal_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .then(({ count }) => setPending(count ?? 0));
  }, [isPlatformAdmin, pathname]);

  if (!isPlatformAdmin) return <Navigate to="/" replace />;
  return (
    <>
      <TopBar title="Super Admin" />
      <nav className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl gap-4 overflow-x-auto px-4">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                `flex items-center gap-1.5 whitespace-nowrap border-b-2 py-2 text-sm ${isActive ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-600"}`
              }
            >
              {t.label}
              {t.label === "Renewals" && pending > 0 && (
                <span className="rounded-full bg-red-600 px-1.5 text-xs font-medium text-white">{pending}</span>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
      <main className="mx-auto max-w-6xl space-y-4 p-4">
        <Outlet />
      </main>
    </>
  );
}
