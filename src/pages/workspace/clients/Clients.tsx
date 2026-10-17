import { useCallback, useEffect, useState, type FormEvent } from "react";
import { supabase, type Tables } from "../../../lib/supabase";
import { useWorkspace } from "../../../lib/workspace";
import { useLiveTable } from "../../../lib/realtime";
import { inr } from "../../../lib/format";
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, Select, Spinner, Textarea } from "../../../components/ui";
import { ImagePicker, StoredImage } from "../../../components/Files";
import ClientDrawer from "./ClientDrawer";
import { AD_PLATFORMS, platformLabel } from "./platforms";

type Client = Tables<"clients">;

type Form = {
  company_name: string;
  contact_person: string;
  email: string;
  phone: string;
  address: string;
  website: string;
  gstin: string;
  notes: string;
  status: "active" | "inactive";
  is_dm_client: boolean;
  monthly_ad_target: string;
  ad_platforms: string[];
  logo_path: string | null;
};

const EMPTY: Form = {
  company_name: "",
  contact_person: "",
  email: "",
  phone: "",
  address: "",
  website: "",
  gstin: "",
  notes: "",
  status: "active",
  is_dm_client: false,
  monthly_ad_target: "",
  ad_platforms: [],
  logo_path: null,
};

function toForm(c: Client): Form {
  return {
    company_name: c.company_name,
    contact_person: c.contact_person ?? "",
    email: c.email ?? "",
    phone: c.phone ?? "",
    address: c.address ?? "",
    website: c.website ?? "",
    gstin: c.gstin ?? "",
    notes: c.notes ?? "",
    status: c.status === "inactive" ? "inactive" : "active",
    is_dm_client: c.is_dm_client,
    monthly_ad_target: c.monthly_ad_target ? String(c.monthly_ad_target) : "",
    ad_platforms: c.ad_platforms ?? [],
    logo_path: c.logo_path ?? null,
  };
}

export default function Clients() {
  const { workspace, plan, canWrite, isAdmin } = useWorkspace();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "inactive" | "">("active");
  const [dmOnly, setDmOnly] = useState(false);
  const [editing, setEditing] = useState<Client | "new" | null>(null);
  const [viewing, setViewing] = useState<Client | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("clients")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("company_name");
    if (error) setError(error.message);
    setClients(data ?? []);
    setLoading(false);
  }, [workspace.id]);

  useEffect(() => {
    load();
  }, [load]);

  useLiveTable("clients", `workspace_id=eq.${workspace.id}`, load);

  const canEdit = isAdmin && canWrite;
  const activeCount = clients.filter((c) => c.status === "active").length;
  const limit = plan?.client_limit ?? null;
  const atLimit = limit !== null && activeCount >= limit;

  const q = search.trim().toLowerCase();
  const shown = clients.filter(
    (c) =>
      (!statusFilter || c.status === statusFilter) &&
      (!dmOnly || c.is_dm_client) &&
      (!q || [c.company_name, c.contact_person, c.email, c.phone, c.gstin].some((v) => v?.toLowerCase().includes(q))),
  );

  return (
    <>
      {error && <Alert>{error}</Alert>}

      <Card
        title="Clients"
        actions={
          canEdit && (
            <Button onClick={() => setEditing("new")} disabled={atLimit} title={atLimit ? "Client limit reached" : undefined}>
              Add client
            </Button>
          )
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
          {limit !== null ? (
            <span>
              {activeCount} of {limit} active clients
            </span>
          ) : (
            <span>{activeCount} active clients</span>
          )}
          <span>{clients.filter((c) => c.is_dm_client && c.status === "active").length} enrolled in digital marketing</span>
        </div>
        {atLimit && canEdit && (
          <div className="mb-3">
            <Alert tone="warning">
              Your plan allows {limit} active clients and all are in use. Mark a client inactive or upgrade your plan on the
              Billing page to add more.
            </Alert>
          </div>
        )}

        <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <Input placeholder="Search by name, contact, phone, email or GSTIN" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "active" | "inactive" | "")}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="">All</option>
          </Select>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={dmOnly} onChange={(e) => setDmOnly(e.target.checked)} />
            Digital marketing only
          </label>
        </div>

        {loading ? (
          <Spinner />
        ) : shown.length === 0 ? (
          <Empty>{clients.length === 0 ? "No clients yet." : "No clients match your search."}</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {shown.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setViewing(c)}
                  className="grid w-full gap-1 py-3 text-left hover:bg-slate-50 sm:grid-cols-[2fr_1.5fr_1.5fr] sm:items-center sm:gap-3 sm:px-2"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    {c.logo_path ? (
                      <StoredImage storageKey={c.logo_path} className="h-8 w-8 shrink-0 rounded-md object-cover ring-1 ring-slate-200" />
                    ) : (
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-sm font-semibold text-slate-500">
                        {c.company_name.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{c.company_name}</span>
                      {c.is_dm_client && <Badge tone="bg-indigo-100 text-indigo-700">DM</Badge>}
                      {c.status === "inactive" && <Badge>Inactive</Badge>}
                    </div>
                    {c.contact_person && <div className="text-xs text-slate-500">{c.contact_person}</div>}
                    </div>
                  </div>
                  <div className="truncate text-sm text-slate-600">{c.phone}</div>
                  <div className="truncate text-sm text-slate-600">{c.email}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editing && (
        <ClientForm
          client={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            if (viewing && viewing.id === saved.id) setViewing(saved);
            load();
          }}
        />
      )}

      {viewing && (
        <ClientDrawer
          client={viewing}
          onClose={() => setViewing(null)}
          onEdit={canEdit ? () => setEditing(viewing) : undefined}
        />
      )}
    </>
  );
}

function ClientForm({ client, onClose, onSaved }: { client: Client | null; onClose: () => void; onSaved: (c: Client) => void }) {
  const { workspace } = useWorkspace();
  const [form, setForm] = useState<Form>(client ? toForm(client) : EMPTY);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const blank = (s: string) => s.trim() || null;

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    const row = {
      company_name: form.company_name.trim(),
      contact_person: blank(form.contact_person),
      email: blank(form.email),
      phone: blank(form.phone),
      address: blank(form.address),
      website: blank(form.website),
      gstin: blank(form.gstin.toUpperCase()),
      notes: blank(form.notes),
      status: form.status,
      is_dm_client: form.is_dm_client,
      monthly_ad_target: form.is_dm_client ? Number(form.monthly_ad_target || 0) : 0,
      ad_platforms: form.is_dm_client ? form.ad_platforms : [],
      logo_path: form.logo_path,
    };
    const res = client
      ? await supabase.from("clients").update(row).eq("workspace_id", workspace.id).eq("id", client.id).select().single()
      : await supabase.from("clients").insert({ ...row, workspace_id: workspace.id }).select().single();
    setSaving(false);
    if (res.error) {
      const limitHit = res.error.message.startsWith("Client limit reached");
      return setError(
        limitHit ? `${res.error.message} Mark another client inactive or upgrade your plan on the Billing page.` : res.error.message,
      );
    }
    onSaved(res.data);
  }

  function togglePlatform(key: string, on: boolean) {
    set("ad_platforms", on ? [...form.ad_platforms, key] : form.ad_platforms.filter((p) => p !== key));
  }

  return (
    <Modal title={client ? `Edit ${client.company_name}` : "Add client"} onClose={onClose} wide>
      <form className="space-y-4" onSubmit={save}>
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Company name">
            <Input required value={form.company_name} onChange={(e) => set("company_name", e.target.value)} />
          </Field>
          <Field label="Contact person">
            <Input value={form.contact_person} onChange={(e) => set("contact_person", e.target.value)} />
          </Field>
          <Field label="Phone">
            <Input type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field label="Email">
            <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
          </Field>
          <Field label="Website">
            <Input value={form.website} placeholder="example.com" onChange={(e) => set("website", e.target.value)} />
          </Field>
          <Field label="GSTIN">
            <Input value={form.gstin} maxLength={15} onChange={(e) => set("gstin", e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Address">
              <Textarea rows={2} value={form.address} onChange={(e) => set("address", e.target.value)} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Notes">
              <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
            </Field>
          </div>
          <Field label="Status" hint="Inactive clients stay on record but do not count towards your plan's client limit.">
            <Select value={form.status} onChange={(e) => set("status", e.target.value as Form["status"])}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </Field>
          <ImagePicker
            workspaceId={workspace.id}
            entityType="client"
            entityId={client?.id}
            label="Logo"
            value={form.logo_path}
            onChange={(key) => set("logo_path", key)}
          />
        </div>

        <div className="rounded-md bg-slate-50 p-3 ring-1 ring-slate-200">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={form.is_dm_client} onChange={(e) => set("is_dm_client", e.target.checked)} />
            Digital marketing (DM) client
          </label>
          <p className="mt-1 text-xs text-slate-500">Only DM clients appear in Ad Fund Management.</p>
          {form.is_dm_client && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Monthly ad spend target (₹)">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.monthly_ad_target}
                  onChange={(e) => set("monthly_ad_target", e.target.value)}
                />
              </Field>
              <div>
                <span className="mb-1 block text-sm font-medium text-slate-700">Ad platforms</span>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {AD_PLATFORMS.map(([key, label]) => (
                    <label key={key} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={form.ad_platforms.includes(key)}
                        onChange={(e) => togglePlatform(key, e.target.checked)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
              {form.monthly_ad_target && (
                <p className="text-xs text-slate-500 sm:col-span-2">
                  Target: {inr(form.monthly_ad_target)} a month
                  {form.ad_platforms.length > 0 && ` on ${form.ad_platforms.map(platformLabel).join(", ")}`}.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={saving}>{saving ? "Saving…" : client ? "Save changes" : "Add client"}</Button>
        </div>
      </form>
    </Modal>
  );
}
