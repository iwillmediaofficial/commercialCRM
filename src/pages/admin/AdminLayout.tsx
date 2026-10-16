import { NavLink, Navigate, Outlet } from "react-router";
import { useAuth } from "../../lib/auth";
import { TopBar } from "../../components/TopBar";

const tabs = [
  { to: "/admin", label: "Companies", end: true },
  { to: "/admin/renewals", label: "Renewals" },
  { to: "/admin/plans", label: "Plans" },
];

export default function AdminLayout() {
  const { isPlatformAdmin } = useAuth();
  if (!isPlatformAdmin) return <Navigate to="/" replace />;
  return (
    <>
      <TopBar title="Super Admin" />
      <nav className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl gap-4 px-4">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                `border-b-2 py-2 text-sm ${isActive ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-600"}`
              }
            >
              {t.label}
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
