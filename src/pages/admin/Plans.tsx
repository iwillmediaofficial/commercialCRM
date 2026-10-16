import { useEffect, useState } from "react";
import { supabase, type Tables } from "../../lib/supabase";
import { MODULES } from "../../lib/format";
import { Alert, Button, Card, Field, Input } from "../../components/ui";

type Plan = Tables<"plans">;
type Draft = Omit<Plan, "id" | "created_at" | "updated_at"> & { id?: string };

const PRICE_FIELDS = [
  ["price_monthly", "Monthly"],
  ["price_quarterly", "Quarterly"],
  ["price_half_yearly", "Half-yearly"],
  ["price_yearly", "Yearly"],
] as const;

const EMPTY: Draft = {
  name: "",
  description: "",
  price_monthly: null,
  price_quarterly: null,
  price_half_yearly: null,
  price_yearly: null,
  staff_limit: 3,
  client_limit: 15,
  modules: ["leads", "work"],
  is_active: true,
  sort_order: 0,
};

export default function Plans() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [adding, setAdding] = useState(false);

  async function load() {
    const [{ data }, { data: ws }] = await Promise.all([
      supabase.from("plans").select("*").order("sort_order").order("name"),
      supabase.from("workspaces").select("plan_id"),
    ]);
    setPlans(data ?? []);
    const counts: Record<string, number> = {};
    for (const w of ws ?? []) counts[w.plan_id] = (counts[w.plan_id] ?? 0) + 1;
    setUsage(counts);
  }
  useEffect(() => {
    load();
  }, []);

  return (
    <>
      <Card title="Plans" actions={<Button onClick={() => setAdding(!adding)}>{adding ? "Close" : "New plan"}</Button>}>
        <p className="text-sm text-slate-500">
          Prices are in ₹. Leave a price empty to stop selling that period. Empty limits mean unlimited. Dashboard,
          clients, team, settings and notifications are always included. Retired plans stay on existing companies but
          can't be picked for new ones or renewals.
        </p>
      </Card>
      {adding && (
        <PlanEditor
          plan={{ ...EMPTY, sort_order: (plans.at(-1)?.sort_order ?? 0) + 1 }}
          onSaved={() => {
            setAdding(false);
            load();
          }}
        />
      )}
      {plans.map((p) => (
        <PlanEditor key={p.id} plan={p} companies={usage[p.id] ?? 0} onSaved={load} />
      ))}
    </>
  );
}

function PlanEditor({ plan, companies, onSaved }: { plan: Draft; companies?: number; onSaved: () => void }) {
  const [p, setP] = useState<Draft>(plan);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const num = (v: string) => (v === "" ? null : Number(v));
  const edit = (patch: Partial<Draft>) => setP({ ...p, ...patch });

  async function save() {
    setMsg(null);
    if (!p.name.trim()) return setMsg({ tone: "error", text: "Give the plan a name." });
    const { id, ...fields } = p;
    const row = { ...fields, name: fields.name.trim(), description: fields.description?.trim() || null };
    const { error } = id
      ? await supabase.from("plans").update(row).eq("id", id)
      : await supabase.from("plans").insert(row);
    if (error) {
      return setMsg({ tone: "error", text: /unique|duplicate/i.test(error.message) ? "Another plan already has that name." : error.message });
    }
    setMsg({ tone: "success", text: `${row.name} saved.` });
    onSaved();
  }

  function toggleModule(m: string) {
    edit({ modules: p.modules.includes(m) ? p.modules.filter((x) => x !== m) : [...p.modules, m] });
  }

  return (
    <Card
      title={p.id ? p.name || "Plan" : "New plan"}
      actions={
        p.id && (
          <span className="text-xs text-slate-500">
            {companies} {companies === 1 ? "company" : "companies"}
            {!p.is_active && " · retired"}
          </span>
        )
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name"><Input value={p.name} onChange={(e) => edit({ name: e.target.value })} /></Field>
        <div className="sm:col-span-2">
          <Field label="Description">
            <Input value={p.description ?? ""} onChange={(e) => edit({ description: e.target.value })} placeholder="Shown to companies when they renew" />
          </Field>
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        {PRICE_FIELDS.map(([k, label]) => (
          <Field key={k} label={`${label} (₹)`}>
            <Input type="number" min={0} value={p[k] ?? ""} onChange={(e) => edit({ [k]: num(e.target.value) })} />
          </Field>
        ))}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        <Field label="Staff seats" hint="Includes the owner.">
          <Input type="number" min={1} value={p.staff_limit ?? ""} placeholder="Unlimited" onChange={(e) => edit({ staff_limit: num(e.target.value) })} />
        </Field>
        <Field label="Active clients">
          <Input type="number" min={1} value={p.client_limit ?? ""} placeholder="Unlimited" onChange={(e) => edit({ client_limit: num(e.target.value) })} />
        </Field>
        <Field label="Order" hint="Lower shows first.">
          <Input type="number" value={p.sort_order} onChange={(e) => edit({ sort_order: Number(e.target.value) || 0 })} />
        </Field>
      </div>
      <fieldset className="mt-4">
        <legend className="mb-2 text-sm font-medium text-slate-700">Modules</legend>
        <div className="flex flex-wrap gap-4">
          {MODULES.map(([m, label]) => (
            <label key={m} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={p.modules.includes(m)} onChange={() => toggleModule(m)} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="mt-4 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={p.is_active} onChange={(e) => edit({ is_active: e.target.checked })} />
        On sale (untick to retire this plan)
      </label>
      <div className="mt-4 flex items-center gap-3">
        <Button onClick={save}>{p.id ? "Save plan" : "Create plan"}</Button>
      </div>
      {msg && <div className="mt-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
    </Card>
  );
}
