import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { Card } from "../components/ui";
import { TopBar } from "../components/TopBar";
import { productName, useSiteInfo } from "../lib/site";

// Sends people where they belong: one company goes straight in, several get a
// picker, and a Super Admin with no company lands on /admin.
export default function Home() {
  const { memberships, isPlatformAdmin } = useAuth();
  const info = useSiteInfo();
  // Companies where an admin has switched this person off.
  const [switchedOff, setSwitchedOff] = useState<string[]>([]);
  useEffect(() => {
    if (memberships.length) return;
    supabase.rpc("my_inactive_companies").then(({ data }) => setSwitchedOff((data ?? []).map((r) => r.name)));
  }, [memberships.length]);

  if (memberships.length === 1 && !isPlatformAdmin) {
    return <Navigate to={`/w/${memberships[0].workspace.slug}`} replace />;
  }
  if (memberships.length === 0 && isPlatformAdmin) return <Navigate to="/admin" replace />;

  return (
    <>
      <TopBar title={productName(info)} />
      <main className="mx-auto max-w-xl space-y-4 px-4 py-10">
        {memberships.length === 0 && switchedOff.length > 0 ? (
          <Card title="Access switched off">
            <p className="text-sm text-slate-600">
              Your access to {switchedOff.join(", ")} was switched off by your company admin. Ask them to switch it back on.
            </p>
          </Card>
        ) : memberships.length === 0 ? (
          <Card title="No company yet">
            <p className="text-sm text-slate-600">
              Your account is not part of any company. Ask your company admin for a PIN, then{" "}
              <Link className="text-indigo-600" to="/signup">enter it here</Link> with this email and password.
            </p>
          </Card>
        ) : (
          <Card title="Choose a company">
            <ul className="divide-y divide-slate-100">
              {memberships.map((m) => (
                <li key={m.workspace_id}>
                  <Link className="flex items-center justify-between rounded-lg px-2 py-3 font-medium hover:bg-slate-50 hover:text-brand-600" to={`/w/${m.workspace.slug}`}>
                    <span>{m.workspace.name}</span>
                    <span className="text-sm capitalize text-slate-500">{m.role}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </main>
    </>
  );
}
