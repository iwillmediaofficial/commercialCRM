import { useEffect, useState } from "react";
import { supabase, type Tables } from "../../lib/supabase";
import { Alert, Button, Card, Input } from "../../components/ui";

const PRICE_FIELDS = [
  ["price_monthly", "Monthly"],
  ["price_quarterly", "Quarterly"],
  ["price_half_yearly", "Half-yearly"],
  ["price_yearly", "Yearly"],
] as const;

export default function Plans() {
  const [plans, setPlans] = useState<Tables<"plans">[]>([]);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.from("plans").select("*").order("sort_order").then(({ data }) => setPlans(data ?? []));
  }, []);

  function edit(id: string, patch: Partial<Tables<"plans">>) {
    setPlans(plans.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  async function save(p: Tables<"plans">) {
    setError("");
    setSaved("");
    const { error } = await supabase
      .from("plans")
      .update({
        price_monthly: p.price_monthly,
        price_quarterly: p.price_quarterly,
        price_half_yearly: p.price_half_yearly,
        price_yearly: p.price_yearly,
        staff_limit: p.staff_limit,
        client_limit: p.client_limit,
      })
      .eq("id", p.id);
    if (error) setError(error.message);
    else setSaved(`${p.name} saved.`);
  }

  const num = (v: string) => (v === "" ? null : Number(v));

  return (
    <Card title="Plans">
      <p className="mb-4 text-sm text-slate-500">Prices are in ₹. Leave a price empty to stop selling that period. Empty limits mean unlimited.</p>
      {error && <div className="mb-3"><Alert>{error}</Alert></div>}
      {saved && <div className="mb-3"><Alert tone="success">{saved}</Alert></div>}
      <div className="space-y-6">
        {plans.map((p) => (
          <div key={p.id} className="border-b border-slate-100 pb-4">
            <div className="mb-2 font-medium">{p.name} <span className="text-xs font-normal text-slate-500">{p.modules.join(", ")}</span></div>
            <div className="grid gap-3 sm:grid-cols-6">
              {PRICE_FIELDS.map(([k, label]) => (
                <label key={k} className="text-xs text-slate-500">{label}
                  <Input type="number" min={0} value={p[k] ?? ""} onChange={(e) => edit(p.id, { [k]: num(e.target.value) })} />
                </label>
              ))}
              <label className="text-xs text-slate-500">Staff
                <Input type="number" min={1} value={p.staff_limit ?? ""} onChange={(e) => edit(p.id, { staff_limit: num(e.target.value) })} />
              </label>
              <label className="text-xs text-slate-500">Clients
                <Input type="number" min={1} value={p.client_limit ?? ""} onChange={(e) => edit(p.id, { client_limit: num(e.target.value) })} />
              </label>
            </div>
            <Button className="mt-3" variant="secondary" onClick={() => save(p)}>Save {p.name}</Button>
          </div>
        ))}
      </div>
    </Card>
  );
}
