import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { supabase, type Tables } from "../../lib/supabase";
import { StatusBadge } from "../../lib/status";
import { MODES, PERIODS, date, daysLeft, type BillingPeriod, type PaymentMode } from "../../lib/format";
import { Alert, Badge, Button, Card, Field, Input, PinBox, Select } from "../../components/ui";

type Row = Tables<"workspaces"> & {
  plan: Pick<Tables<"plans">, "name" | "staff_limit"> | null;
  status?: string;
  active_members?: number;
  pending_renewals?: number;
};

// Web addresses allow lowercase letters, numbers and single dashes, 3 to 48 long.
function toSlug(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, 48);
}
const SLUG_OK = /^[a-z0-9]([a-z0-9-]{1,46}[a-z0-9])?$/;

export default function Companies() {
  const [rows, setRows] = useState<Row[]>([]);
  const [plans, setPlans] = useState<Tables<"plans">[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState<"" | "company" | "demo">("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const load = useCallback(async () => {
    const [{ data: ws }, { data: pl }, { data: ov }] = await Promise.all([
      supabase.from("workspaces").select("*, plan:plans(name, staff_limit)").order("created_at", { ascending: false }),
      supabase.from("plans").select("*").order("sort_order"),
      supabase.rpc("admin_workspace_overview"),
    ]);
    const list = (ws ?? []) as Row[];
    for (const w of list) {
      const o = ov?.find((x) => x.workspace_id === w.id);
      w.status = o?.status;
      w.active_members = o?.active_members;
      w.pending_renewals = o?.pending_renewals;
    }
    setRows(list);
    setPlans(pl ?? []);
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const q = search.trim().toLowerCase();
  const shown = rows.filter(
    (w) =>
      (!statusFilter || w.status === statusFilter) &&
      (!q || [w.name, w.slug, w.owner_name, w.owner_email, w.owner_phone].some((v) => v?.toLowerCase().includes(q))),
  );
  // Demo companies are left out of the counts.
  const real = rows.filter((w) => !w.is_demo);
  const count = (s: string) => real.filter((w) => w.status === s).length;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        {[
          ["", "All companies", real.length],
          ["active", "Active", count("active")],
          ["trial", "On trial", count("trial")],
          ["grace", "In grace", count("grace")],
          ["expired", "Expired", count("expired")],
          ["suspended", "Suspended", count("suspended")],
        ].map(([key, label, n]) => (
          <button
            key={label}
            onClick={() => setStatusFilter(key as string)}
            className={`rounded-lg bg-white p-3 text-left shadow-sm ring-1 ${statusFilter === key ? "ring-indigo-500" : "ring-slate-200"}`}
          >
            <div className="text-xs text-slate-500">{label}</div>
            <div className="text-xl font-semibold">{n}</div>
          </button>
        ))}
      </div>

      <Card
        title="Companies"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setShowNew(showNew === "demo" ? "" : "demo")}>
              {showNew === "demo" ? "Close" : "Create demo company"}
            </Button>
            <Button onClick={() => setShowNew(showNew === "company" ? "" : "company")}>{showNew === "company" ? "Close" : "Add company"}</Button>
          </div>
        }
      >
        {showNew === "company" && <NewCompany plans={plans} onCreated={load} />}
        {showNew === "demo" && <NewDemo onCreated={load} />}
        <Input className="mb-3 sm:max-w-xs" placeholder="Search name, owner, email or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-slate-500">{rows.length === 0 ? "No companies yet. Add the first one." : "No companies match."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-2">Company</th>
                  <th>Owner</th>
                  <th>Plan</th>
                  <th>Staff</th>
                  <th>Status</th>
                  <th>Valid until</th>
                  <th></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((w) => (
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
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const left = daysLeft(w.valid_until);

  async function openWorkspace() {
    await supabase.rpc("admin_log_support_view", { p_workspace_id: w.id });
    navigate(`/w/${w.slug}`);
  }

  return (
    <>
      <tr className="align-top">
        <td className="py-2">
          <div className="font-medium">
            {w.name}
            {w.is_demo && <span className="ml-2"><Badge tone="bg-amber-100 text-amber-800">Demo</Badge></span>}
          </div>
          <div className="text-xs text-slate-500">/w/{w.slug}</div>
        </td>
        <td className="py-2">
          <div>{w.owner_name}</div>
          <div className="text-xs text-slate-500">{[w.owner_email, w.owner_phone].filter(Boolean).join(" · ")}</div>
        </td>
        <td className="py-2">{w.plan?.name}</td>
        <td className="py-2">{w.active_members ?? "–"}{w.plan?.staff_limit ? ` / ${w.plan.staff_limit}` : ""}</td>
        <td className="py-2">
          <StatusBadge status={w.status} />
          {w.status === "trial" && <div className="mt-1 text-xs text-slate-500">{Math.max(left, 0)} days left</div>}
          {!!w.pending_renewals && <div className="mt-1 text-xs text-red-600">Renewal waiting</div>}
        </td>
        <td className="py-2">{date(w.valid_until)}</td>
        <td className="space-x-2 whitespace-nowrap py-2 text-right">
          <Button variant="secondary" onClick={openWorkspace} title="Open this company's workspace read-only">Open</Button>
          <Button variant="secondary" onClick={() => setOpen(!open)}>{open ? "Close" : "Manage"}</Button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} className="bg-slate-50 p-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <Subscription w={w} plans={plans} onChanged={onChanged} />
              <RecordPayment w={w} plans={plans} onChanged={onChanged} />
              <Details w={w} onChanged={onChanged} />
              <OwnerPin w={w} />
              <FileAttachments w={w} onChanged={onChanged} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md bg-white p-4 ring-1 ring-slate-200">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
}

// Courtesy extensions, corrections, plan changes and suspension, without a payment.
function Subscription({ w, plans, onChanged }: { w: Row; plans: Tables<"plans">[]; onChanged: () => void }) {
  const [days, setDays] = useState("0");
  const [planId, setPlanId] = useState(w.plan_id);
  // A payment recorded elsewhere can change the plan; follow it.
  useEffect(() => setPlanId(w.plan_id), [w.plan_id]);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  async function update(state?: "trial" | "active" | "suspended") {
    setMsg(null);
    const { error } = await supabase.rpc("admin_update_subscription", {
      p_workspace_id: w.id,
      p_add_days: Number(days) || 0,
      p_plan_id: planId !== w.plan_id ? planId : undefined,
      p_state: state,
      p_note: note || undefined,
    });
    if (error) return setMsg({ tone: "error", text: error.message });
    setMsg({ tone: "success", text: "Saved." });
    setDays("0");
    setNote("");
    onChanged();
  }

  return (
    <Panel title="Change subscription (no payment)">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Add or remove days" hint="Use a minus sign to remove, e.g. -5.">
          <Input type="number" value={days} onChange={(e) => setDays(e.target.value)} />
        </Field>
        <Field label="Plan">
          <Select value={planId} onChange={(e) => setPlanId(e.target.value)}>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name}{p.is_active ? "" : " (retired)"}</option>)}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Note for the audit log">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Courtesy extension for Diwali" />
          </Field>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={() => update()}>Save changes</Button>
        {w.state === "suspended" ? (
          <Button variant="secondary" onClick={() => update(w.state_before_suspend ?? "active")}>
            Unsuspend{w.state_before_suspend === "trial" ? " (back to trial)" : ""}
          </Button>
        ) : (
          <Button variant="danger" onClick={() => window.confirm(`Suspend ${w.name}? Their team is locked out and public forms stop.`) && update("suspended")}>
            Suspend
          </Button>
        )}
      </div>
      {msg && <div className="mt-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
    </Panel>
  );
}

// A payment received offline (no renewal request): extends validity and goes in the ledger.
function RecordPayment({ w, plans, onChanged }: { w: Row; plans: Tables<"plans">[]; onChanged: () => void }) {
  const [form, setForm] = useState({
    plan_id: w.plan_id,
    period: "monthly" as BillingPeriod,
    amount: "",
    mode: "upi" as PaymentMode,
    ref: "",
    paid_on: new Date().toLocaleDateString("en-CA"),
  });
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const plan = plans.find((p) => p.id === form.plan_id);
  const listPrice = plan?.[`price_${form.period}` as const];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    const { data, error } = await supabase.rpc("admin_record_payment", {
      p_workspace_id: w.id,
      p_plan_id: form.plan_id,
      p_period: form.period,
      p_amount: Number(form.amount),
      p_payment_mode: form.mode,
      p_reference_no: form.ref || undefined,
      p_paid_on: form.paid_on,
    });
    if (error) return setMsg({ tone: "error", text: error.message });
    setMsg({ tone: "success", text: `Payment recorded. Active until ${date((data as { valid_until: string }).valid_until)}.` });
    setForm({ ...form, amount: "", ref: "" });
    onChanged();
  }

  return (
    <Panel title="Record a payment">
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
        <Field label="Plan">
          <Select value={form.plan_id} onChange={(e) => setForm({ ...form, plan_id: e.target.value })}>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Period">
          <Select value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value as BillingPeriod })}>
            {PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Amount received (₹)" hint={listPrice != null ? `List price ₹${Number(listPrice).toLocaleString("en-IN")}` : undefined}>
          <Input type="number" min={0} step="0.01" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        </Field>
        <Field label="Paid by">
          <Select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as PaymentMode })}>
            {MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        <Field label="UTR / reference">
          <Input value={form.ref} onChange={(e) => setForm({ ...form, ref: e.target.value })} />
        </Field>
        <Field label="Paid on">
          <Input type="date" required value={form.paid_on} onChange={(e) => setForm({ ...form, paid_on: e.target.value })} />
        </Field>
        <div className="sm:col-span-2"><Button>Record payment and extend</Button></div>
      </form>
      {msg && <div className="mt-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
    </Panel>
  );
}

function Details({ w, onChanged }: { w: Row; onChanged: () => void }) {
  const [form, setForm] = useState({
    name: w.name,
    owner_name: w.owner_name ?? "",
    owner_email: w.owner_email ?? "",
    owner_phone: w.owner_phone ?? "",
    notes: w.notes ?? "",
  });
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!form.name.trim()) return setMsg({ tone: "error", text: "Enter the company name." });
    const { error } = await supabase
      .from("workspaces")
      .update({
        name: form.name.trim(),
        owner_name: form.owner_name.trim() || null,
        owner_email: form.owner_email.trim().toLowerCase() || null,
        owner_phone: form.owner_phone.trim() || null,
        notes: form.notes.trim() || null,
      })
      .eq("id", w.id);
    if (error) return setMsg({ tone: "error", text: error.message });
    setMsg({ tone: "success", text: "Saved." });
    onChanged();
  }

  return (
    <Panel title="Company details">
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
        <Field label="Company name"><Input required value={form.name} onChange={set("name")} /></Field>
        <Field label="Owner name"><Input value={form.owner_name} onChange={set("owner_name")} /></Field>
        <Field label="Owner email" hint="Changing it doesn't change the owner's login email.">
          <Input type="email" value={form.owner_email} onChange={set("owner_email")} />
        </Field>
        <Field label="Owner phone"><Input value={form.owner_phone} onChange={set("owner_phone")} /></Field>
        <div className="sm:col-span-2">
          <Field label="Private notes" hint="Only you see these.">
            <textarea
              className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              rows={2}
              value={form.notes}
              onChange={set("notes")}
            />
          </Field>
        </div>
        <div className="sm:col-span-2"><Button variant="secondary">Save details</Button></div>
      </form>
      {msg && <div className="mt-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
    </Panel>
  );
}

// Off by default so files don't fill the R2 storage. Logos, photos and renewal receipts work either way.
function FileAttachments({ w, onChanged }: { w: Row; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const on = w.attachments_enabled;

  async function toggle() {
    setBusy(true);
    setError("");
    const { error } = await supabase.from("workspaces").update({ attachments_enabled: !on }).eq("id", w.id);
    setBusy(false);
    if (error) return setError(error.message);
    onChanged();
  }

  return (
    <Panel title="File attachments">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm">
          File attachments: <span className={on ? "font-semibold text-green-700" : "font-semibold text-slate-600"}>{on ? "On" : "Off"}</span>
        </span>
        <Button variant="secondary" disabled={busy} onClick={toggle}>
          {busy ? "Saving…" : on ? "Turn off" : "Turn on"}
        </Button>
      </div>
      <p className="mt-2 text-xs text-slate-500">Lets this company upload files to tasks, clients, leads and invoices. Uses your R2 storage.</p>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
    </Panel>
  );
}

function OwnerPin({ w }: { w: Row }) {
  const [pin, setPin] = useState<{ pin: string; expires_at: string; label: string } | null>(null);
  const [error, setError] = useState("");
  // The owner's account, once they have signed up (undefined while loading).
  const [ownerId, setOwnerId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    supabase
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", w.id)
      .eq("role", "owner")
      .maybeSingle()
      .then(({ data }) => setOwnerId(data?.user_id ?? null));
  }, [w.id]);

  async function issue() {
    setError("");
    setPin(null);
    const { data, error } = await supabase.rpc(
      "issue_access_pin",
      ownerId
        ? { p_purpose: "reset", p_workspace_id: w.id, p_target_user_id: ownerId }
        : {
            p_purpose: "signup",
            p_workspace_id: w.id,
            p_role: "owner",
            p_email: w.owner_email ?? undefined,
            p_full_name: w.owner_name ?? undefined,
            p_phone: w.owner_phone ?? undefined,
          },
    );
    if (error) return setError(error.message);
    const label = ownerId ? "Owner password reset PIN. They enter it at /reset." : "Owner sign-up PIN. They enter it at /signup.";
    setPin({ ...(data as { pin: string; expires_at: string }), label });
  }

  return (
    <Panel title="Owner login">
      <p className="mb-3 text-sm text-slate-600">
        {ownerId === undefined ? "Checking…" : ownerId ? "The owner has signed up. Issue a PIN if they forgot their password." : "The owner hasn't signed up yet. Issue a new sign-up PIN if they lost theirs."}
      </p>
      <Button variant="secondary" disabled={ownerId === undefined} onClick={issue}>
        {ownerId ? "Owner password reset PIN" : "New owner sign-up PIN"}
      </Button>
      {pin && (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-slate-600">{pin.label}</p>
          <PinBox pin={pin.pin} expires={pin.expires_at} />
        </div>
      )}
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
    </Panel>
  );
}

function NewCompany({ plans, onCreated }: { plans: Tables<"plans">[]; onCreated: () => void }) {
  const [form, setForm] = useState({ name: "", slug: "", plan_id: "", owner_name: "", owner_email: "", owner_phone: "", trial_days: "" });
  const [result, setResult] = useState<{ owner_pin: { pin: string; expires_at: string } } | null>(null);
  const [error, setError] = useState("");
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const [slugTouched, setSlugTouched] = useState(false);
  const activePlans = plans.filter((p) => p.is_active);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.name.trim()) return setError("Enter the company name.");
    const slug = form.slug.replace(/-+$/, "");
    if (!SLUG_OK.test(slug)) {
      return setError("Web address must be 3 to 48 characters: lowercase letters, numbers and dashes, not starting or ending with a dash.");
    }
    const { data, error } = await supabase.rpc("admin_create_workspace", {
      p_name: form.name,
      p_slug: slug,
      p_plan_id: form.plan_id || activePlans[0]?.id,
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
          {activePlans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </Field>
      <Field label="Trial days" hint="Leave empty for the default trial.">
        <Input type="number" min={0} value={form.trial_days} onChange={set("trial_days")} />
      </Field>
      <Field label="Owner name"><Input required value={form.owner_name} onChange={set("owner_name")} /></Field>
      <Field label="Owner email" hint="The owner signs up with this email; the PIN works only for it.">
        <Input type="email" required value={form.owner_email} onChange={set("owner_email")} />
      </Field>
      <Field label="Owner phone"><Input value={form.owner_phone} onChange={set("owner_phone")} /></Field>
      <div className="flex items-end"><Button>Create company and owner PIN</Button></div>
      {error && <div className="sm:col-span-2"><Alert>{error}</Alert></div>}
    </form>
  );
}

// A ready-made company full of sample data, for showing the app to prospects.
function NewDemo({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({ name: "", owner_name: "", owner_email: "" });
  const [result, setResult] = useState<{ slug: string; owner_pin: { pin: string; expires_at: string } } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const { data, error } = await supabase.rpc("admin_create_demo_workspace", {
      p_name: form.name.trim() || undefined,
      p_owner_name: form.owner_name.trim() || undefined,
      p_owner_email: form.owner_email.trim().toLowerCase() || undefined,
    });
    setBusy(false);
    if (error) return setError(error.message);
    setResult(data as { slug: string; owner_pin: { pin: string; expires_at: string } });
    onCreated();
  }

  if (result) {
    return (
      <div className="mb-6 space-y-2 border-b border-slate-200 pb-6">
        <Alert tone="success">
          Demo company created at /w/{result.slug}. Sign up at /signup with {form.owner_email.trim() ? "that email" : "the demo email"} and this PIN to get
          a login you can share with prospects. The demo has sample clients, leads, tasks, invoices and ad funds, and is active for a year.
        </Alert>
        <PinBox pin={result.owner_pin.pin} expires={result.owner_pin.expires_at} />
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mb-6 grid gap-4 border-b border-slate-200 pb-6 sm:grid-cols-2">
      <p className="text-sm text-slate-600 sm:col-span-2">
        Creates a company filled with sample data, active for a year. It's marked Demo and left out of your company counts.
      </p>
      <Field label="Company name" hint="Leave empty for a ready-made name.">
        <Input value={form.name} onChange={set("name")} />
      </Field>
      <Field label="Demo login email" hint="Optional. You sign up with this email to get the demo login.">
        <Input type="email" value={form.owner_email} onChange={set("owner_email")} placeholder="demo@yourdomain.com" />
      </Field>
      <Field label="Demo owner name" hint="Optional.">
        <Input value={form.owner_name} onChange={set("owner_name")} />
      </Field>
      <div className="flex items-end"><Button disabled={busy}>{busy ? "Creating…" : "Create demo company"}</Button></div>
      {error && <div className="sm:col-span-2"><Alert>{error}</Alert></div>}
    </form>
  );
}
