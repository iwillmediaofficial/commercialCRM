import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useWorkspace } from "../../lib/workspace";
import { Card } from "../../components/ui";

export default function Dashboard() {
  const { workspace, hasModule } = useWorkspace();
  const [counts, setCounts] = useState<Record<string, number | null>>({});

  useEffect(() => {
    const id = workspace.id;
    const count = (table: "clients" | "leads" | "work_items") =>
      supabase.from(table).select("id", { count: "exact", head: true }).eq("workspace_id", id).then((r) => r.count);
    Promise.all([
      count("clients"),
      hasModule("leads") ? count("leads") : Promise.resolve(null),
      hasModule("work") ? count("work_items") : Promise.resolve(null),
    ]).then(([clients, leads, work]) => setCounts({ clients, leads, work }));
  }, [workspace.id, hasModule]);

  const tiles = [
    { label: "Clients", value: counts.clients },
    { label: "Leads", value: counts.leads },
    { label: "Work items", value: counts.work },
  ].filter((t) => t.value !== null);

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {tiles.map((t) => (
        <Card key={t.label}>
          <div className="text-sm text-slate-500">{t.label}</div>
          <div className="mt-1 text-3xl font-semibold">{t.value ?? "…"}</div>
        </Card>
      ))}
    </div>
  );
}
