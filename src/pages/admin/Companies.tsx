import { useEffect, useState, type FormEvent } from "react";
import { supabase, type Tables } from "../../lib/supabase";
import { StatusBadge } from "../../lib/status";
import { Alert, Button, Card, Field, Input, PinBox, Select } from "../../components/ui";

type Row = Tables<"workspaces"> & { plan: { name: string } | null; status?: string };

// Web addresses allow lowercase letters, numbers and single dashes, 3 to 48 long.
function toSlug(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, 48);
}
const SLUG_OK = /^[a-z0-9]([a-z0-9-]{1,46}[a-z0-9])?$/;

export default function Companies() {
  const [rows, setRows] = useState<Row[]>([]);
  const [plans, setPlans] = useState<Tables<"plans">[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  async function load() {
    const [{ data: ws }, { data: pl }] = await Promise.all([
      supabase.from("workspaces").select("*, plan:plans(name)").order("created_at", { ascending: false }),
      supabase.from("plans").select("*").order("sort_order"),
    ]);
    const list = (ws ?? []) as Row[];
    const statuses = await Promise.all(list.map((w) => supabase.rpc("workspace_status", { ws: w.id })));
    list.forEach((w, i) => (w.status = statuses[i].data ?? undefined));
    setRows(list);
    setPlans(pl ?? []);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  return (
    <>
      <Card title="Companies" actions={<Button onClick={() => setShowNew(!showNew)}>{showNew ? "Close" : "Add company"}</Button>}>
        {showNew && <NewCompany plans={plans} onCreated={load} />}
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500">No companies yet. Add the first one.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-2">Company</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th>Valid until</th>
                  <th></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((w) => (
                  <CompanyRow key={w.id} w={w} plans={plans} onChanged={load} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function CompanyRow({ w, plans, onChanged }: { w: Row; plans: Tables<"plans">[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState("30");
  const [planId, setPlanId] = useState(w.plan_id);
  const [pin, setPin] = useState<{ pin: string; expires_at: string } | null>(null);
  const [error, setError] = useState("");

  async function update(state?: "active" | "suspended") {
    setError("");
    const { error } = await supabase.rpc("admin_update_subscription", {
      p_workspace_id: w.id,
      p_add_days: state === "suspended" ? 0 : Number(days) || 0,
      p_plan_id: planId,
      p_state: state ?? (w.state === "suspended" ? "active" : w.state),
    });
    if (error) setError(error.message);
    else onChanged();
  }

  async function ownerPin() {
    setError("");
    const { data, error } = await supabase.rpc("issue_access_pin", {
      p_purpose: "signup",
      p_workspace_id: w.id,
      p_role: "owner",
      p_email: w.owner_email ?? undefined,
    });
    if (error) setError(error.message);
    else setPin(data as { pin: string; expires_at: string });
  }

  return (
    <>
      <tr>
        <td className="py-2">
          <div className="font-medium">{w.name}</div>
          <div className="text-xs text-slate-500">/w/{w.slug} · {w.owner_name} {w.owner_email && `· ${w.owner_email}`}</div>
        </td>
        <td>{w.plan?.name}</td>
        <td><StatusBadge status={w.status} /></td>
        <td>{new Date(w.valid_until).toLocaleDateString()}</td>
        <td className="text-right">
          <Button variant="secondary" onClick={() => setOpen(!open)}>{open ? "Close" : "Manage"}</Button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} className="bg-slate-50 p-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Add days">
                <Input type="number" min={0} value={days} onChange={(e) => setDays(e.target.value)} />
              </Field>
              <Field label="Plan">
                <Select value={planId} onChange={(e) => setPlanId(e.target.value)}>
                  {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </Field>
              <div className="flex items-end gap-2">
                <Button onClick={() => update("active")}>Save as paid</Button>
                {w.state === "suspended" ? (
                  <Button variant="secondary" onClick={() => update("active")}>Unsuspend</Button>
                ) : (
                  <Button variant="danger" onClick={() => update("suspended")}>Suspend</Button>
                )}
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <Button variant="secondary" onClick={ownerPin}>New owner sign-up PIN</Button>
              {pin && <PinBox pin={pin.pin} expires={pin.expires_at} />}
              {error && <Alert>{error}</Alert>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function NewCompany({ plans, onCreated }: { plans: Tables<"plans">[]; onCreated: () => void }) {
  const [form, setForm] = useState({ name: "", slug: "", plan_id: "", owner_name: "", owner_email: "", owner_phone: "", trial_days: "" });
  const [result, setResult] = useState<{ owner_pin: { pin: string; expires_at: string } } | null>(null);
  const [error, setError] = useState("");
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const [slugTouched, setSlugTouched] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const slug = form.slug.replace(/-+$/, "");
    if (!SLUG_OK.test(slug)) {
      return setError("Web address must be 3 to 48 characters: lowercase letters, numbers and dashes, not starting or ending with a dash.");
    }
    const { data, error } = await supabase.rpc("admin_create_workspace", {
      p_name: form.name,
      p_slug: slug,
      p_plan_id: form.plan_id || plans[0]?.id,
      p_owner_name: form.owner_name,
      p_owner_email: form.owner_email || undefined,
      p_owner_phone: form.owner_phone || undefined,
      p_trial_days: form.trial_days ? Number(form.trial_days) : undefined,
    });
    if (error) {
      return setError(
        /duplicate|unique/i.test(error.message) ? "That web address is already taken. Choose another." : error.message,
      );
    }
    setResult(data as { owner_pin: { pin: string; expires_at: string } });
    onCreated();
  }

  if (result) {
    return (
      <div className="mb-6 space-y-2">
        <Alert tone="success">Company created. Give this PIN to the owner. They sign up at /signup with it.</Alert>
        <PinBox pin={result.owner_pin.pin} expires={result.owner_pin.expires_at} />
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mb-6 grid gap-4 border-b border-slate-200 pb-6 sm:grid-cols-2">
      <Field label="Company name">
        <Input
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value, slug: slugTouched ? form.slug : toSlug(e.target.value) })}
        />
      </Field>
      <Field label="Web address" hint="Lowercase letters, numbers and dashes. Used in /w/address.">
        <Input
          required
          minLength={3}
          value={form.slug}
          onChange={(e) => {
            setSlugTouched(true);
            setForm({ ...form, slug: toSlug(e.target.value) });
          }}
        />
      </Field>
      <Field label="Plan">
        <Select value={form.plan_id} onChange={set("plan_id")}>
          {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </Field>
      <Field label="Trial days" hint="Leave empty for the default trial.">
        <Input type="number" min={0} value={form.trial_days} onChange={set("trial_days")} />
      </Field>
      <Field label="Owner name"><Input required value={form.owner_name} onChange={set("owner_name")} /></Field>
      <Field label="Owner email" hint="The PIN will only work with this email.">
        <Input type="email" value={form.owner_email} onChange={set("owner_email")} />
      </Field>
      <Field label="Owner phone"><Input value={form.owner_phone} onChange={set("owner_phone")} /></Field>
      <div className="flex items-end"><Button>Create company and owner PIN</Button></div>
      {error && <div className="sm:col-span-2"><Alert>{error}</Alert></div>}
    </form>
  );
}
