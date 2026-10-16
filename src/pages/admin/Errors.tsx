import { useCallback, useEffect, useState } from "react";
import { supabase, type Tables } from "../../lib/supabase";
import { Alert, Button, Card, Empty } from "../../components/ui";

type Row = Tables<"app_errors">;

// Crashes reported by people's browsers, newest first.
export default function Errors() {
  const [rows, setRows] = useState<Row[]>([]);
  const [people, setPeople] = useState<Record<string, string>>({});
  const [companies, setCompanies] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error } = await supabase.from("app_errors").select("*").order("created_at", { ascending: false }).limit(200);
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    const list = data ?? [];
    const userIds = [...new Set(list.map((r) => r.user_id).filter((v): v is string => !!v))];
    const wsIds = [...new Set(list.map((r) => r.workspace_id).filter((v): v is string => !!v))];
    const [{ data: ps }, { data: ws }] = await Promise.all([
      userIds.length ? supabase.from("profiles").select("id, email, full_name").in("id", userIds) : Promise.resolve({ data: [] }),
      wsIds.length ? supabase.from("workspaces").select("id, name").in("id", wsIds) : Promise.resolve({ data: [] }),
    ]);
    setPeople(Object.fromEntries((ps ?? []).map((p) => [p.id, p.full_name ? `${p.full_name} (${p.email})` : p.email])));
    setCompanies(Object.fromEntries((ws ?? []).map((w) => [w.id, w.name])));
    setRows(list);
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function clearAll() {
    if (!window.confirm("Delete every error report? This can't be undone.")) return;
    const { error } = await supabase.from("app_errors").delete().gte("id", 0);
    if (error) return setError(error.message);
    load();
  }

  return (
    <Card
      title="Errors"
      actions={
        <div className="flex gap-2">
          <Button variant="secondary" onClick={load} disabled={loading}>Refresh</Button>
          <Button variant="danger" onClick={clearAll} disabled={loading || rows.length === 0}>Clear all</Button>
        </div>
      }
    >
      {error && <div className="mb-3"><Alert>{error}</Alert></div>}
      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <Empty>No errors reported. Crashes in the app show up here.</Empty>
      ) : (
        <>
          <p className="mb-3 text-xs text-slate-500">Showing the latest {rows.length}. Click a row for details.</p>
          <ul className="divide-y divide-slate-100 text-sm">
            {rows.map((r) => (
              <li key={r.id} className="py-2">
                <button className="block w-full text-left" onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="break-all font-medium text-red-700">{r.message}</span>
                    <span className="whitespace-nowrap text-xs text-slate-500">{new Date(r.created_at).toLocaleString("en-IN")}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
                    {r.url && <span className="break-all">{r.url.replace(window.location.origin, "")}</span>}
                    <span>{r.user_id ? people[r.user_id] ?? `User ${r.user_id.slice(0, 8)}` : "Signed out"}</span>
                    {r.workspace_id && <span>{companies[r.workspace_id] ?? `Company ${r.workspace_id.slice(0, 8)}`}</span>}
                    {r.source && r.source !== "client" && <span>{r.source}</span>}
                  </div>
                </button>
                {open === r.id && (
                  <div className="mt-2 space-y-2 rounded-md bg-slate-50 p-3 text-xs">
                    {r.stack ? (
                      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-slate-700">{r.stack}</pre>
                    ) : (
                      <p className="text-slate-500">No stack trace.</p>
                    )}
                    <div className="text-slate-600"><span className="font-medium">Browser:</span> {r.user_agent || "Unknown"}</div>
                    <div className="text-slate-600"><span className="font-medium">Version:</span> {r.app_version || "Unknown"}</div>
                    {r.url && <div className="break-all text-slate-600"><span className="font-medium">Page:</span> {r.url}</div>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
