import { Link, Navigate } from "react-router";
import { useAuth } from "../lib/auth";
import { Card } from "../components/ui";
import { TopBar } from "../components/TopBar";

// Sends people where they belong: one company goes straight in, several get a
// picker, and a Super Admin with no company lands on /admin.
export default function Home() {
  const { memberships, isPlatformAdmin } = useAuth();

  if (memberships.length === 1 && !isPlatformAdmin) {
    return <Navigate to={`/w/${memberships[0].workspace.slug}`} replace />;
  }
  if (memberships.length === 0 && isPlatformAdmin) return <Navigate to="/admin" replace />;

  return (
    <>
      <TopBar title="CRM" />
      <main className="mx-auto max-w-xl space-y-4 p-4">
        {memberships.length === 0 ? (
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
                  <Link className="flex justify-between py-3 hover:text-indigo-600" to={`/w/${m.workspace.slug}`}>
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
