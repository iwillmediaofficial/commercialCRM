import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { supabase, type Tables } from "../../../lib/supabase";
import { useWorkspace } from "../../../lib/workspace";
import { useMembers, nameOf, type Person } from "../../../lib/members";
import { date, inr } from "../../../lib/format";
import { deleteFile, uploadFile } from "../../../lib/files";
import { Attachments } from "../../../components/Files";
import { Alert, Badge, Button, Card, Drawer, Empty, Field, Input, Modal, Select, Spinner, Textarea } from "../../../components/ui";
import {
  CATEGORIES,
  KINDS,
  LABELS,
  REGISTRARS,
  STATE_TONE,
  categoryLabel,
  dueDates,
  stateOf,
  type CompanyRecord,
  type Kind,
  type State,
} from "./records";

type Limits = { file_mb: number; total_mb: number; used_bytes: number };
const DEFAULT_LIMITS: Limits = { file_mb: 10, total_mb: 100, used_bytes: 0 };

// File limits for this company's Assets & documents files, set by the Super Admin.
function useLimits(workspaceId: string) {
  const [limits, setLimits] = useState<Limits>(DEFAULT_LIMITS);
  const reload = useCallback(() => {
    supabase.rpc("company_record_file_limits", { p_ws: workspaceId }).then(({ data }) => {
      if (data) setLimits(data as Limits);
    });
  }, [workspaceId]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { limits, reload };
}

const mb = (bytes: number) => `${(bytes / 1048576).toFixed(bytes < 10 * 1048576 ? 1 : 0)} MB`;

type Filter = "all" | "attention" | "expired" | "soon" | "ok" | "closed";
const MAX_FILES = 5;

export default function Assets() {
  const { workspace, isAdmin, canWrite } = useWorkspace();
  const people = useMembers(workspace.id);
  const { limits, reload: reloadLimits } = useLimits(workspace.id);
  const canEdit = isAdmin && canWrite;
  const [records, setRecords] = useState<CompanyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [params, setParams] = useSearchParams();
  const [kind, setKind] = useState<Kind>(() => (KINDS.some((k) => k.key === params.get("tab")) ? (params.get("tab") as Kind) : "document"));
  const [filter, setFilter] = useState<Filter>("all");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<CompanyRecord | "new" | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("company_records")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("expiry_date", { ascending: true, nullsFirst: false })
      .order("name");
    if (error) setError(error.message);
    setRecords(data ?? []);
    setLoading(false);
  }, [workspace.id]);

  useEffect(() => {
    load();
  }, [load]);

  // Opening an item from a reminder (?open=<id>).
  const openId = params.get("open");
  useEffect(() => {
    if (!openId || loading) return;
    const r = records.find((x) => x.id === openId);
    if (r) {
      setKind(r.kind as Kind);
      setViewingId(r.id);
    }
    setParams((p) => {
      p.delete("open");
      return p;
    }, { replace: true });
  }, [openId, loading, records, setParams]);

  const withState = useMemo(() => records.map((r) => ({ r, s: stateOf(r) })), [records]);
  const counts = useMemo(() => {
    const c = { expired: 0, soon: 0 };
    for (const { s } of withState) if (s.state === "expired" || s.state === "soon") c[s.state]++;
    return c;
  }, [withState]);
  const perKind = (k: Kind) => withState.filter((x) => x.r.kind === k);

  const q = search.trim().toLowerCase();
  const shown = perKind(kind)
    .filter(({ r, s }) => {
      if (filter === "attention" ? !(s.state === "expired" || s.state === "soon") : filter !== "all" && s.state !== filter) return false;
      if (filter === "all" && s.state === "closed") return false;
      if (category && r.category !== category) return false;
      return !q || [r.name, r.reference, r.issued_by, r.notes].some((v) => v?.toLowerCase().includes(q));
    })
    .sort((a, b) => order(a.s.state) - order(b.s.state) || (a.s.next?.days ?? 1e9) - (b.s.next?.days ?? 1e9) || a.r.name.localeCompare(b.r.name));

  const viewing = records.find((r) => r.id === viewingId) ?? null;
  const labels = LABELS[kind];
  const one = KINDS.find((k) => k.key === kind)!.one;

  function switchKind(k: Kind) {
    setKind(k);
    setCategory("");
    setParams((p) => {
      p.set("tab", k);
      return p;
    }, { replace: true });
  }

  return (
    <>
      {error && <Alert>{error}</Alert>}

      <Card
        title="Assets & documents"
        actions={canEdit && <Button onClick={() => setEditing("new")}>Add {one}</Button>}
      >
        {(counts.expired > 0 || counts.soon > 0) && (
          <button
            type="button"
            onClick={() => setFilter("attention")}
            className="mb-4 flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-amber-50 px-3.5 py-2.5 text-left text-sm text-amber-900 ring-1 ring-amber-200 hover:bg-amber-100/70"
          >
            {counts.expired > 0 && <span><strong>{counts.expired}</strong> expired</span>}
            {counts.soon > 0 && <span><strong>{counts.soon}</strong> due in the next 30 days</span>}
            <span className="ml-auto text-xs font-semibold text-amber-800">Show them</span>
          </button>
        )}

        <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
          {KINDS.map((k) => {
            const n = perKind(k.key).filter((x) => x.s.state !== "closed").length;
            return (
              <button
                key={k.key}
                type="button"
                onClick={() => switchKind(k.key)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm ${
                  kind === k.key ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                {k.label}
                {n > 0 && <span className="ml-1.5 text-xs text-slate-400">{n}</span>}
              </button>
            );
          })}
        </div>

        <div className={`mb-4 grid gap-2 ${kind === "domain" ? "sm:grid-cols-[1fr_auto]" : "sm:grid-cols-[1fr_auto_auto]"}`}>
          <Input
            placeholder={kind === "domain" ? "Search domains or registrar" : `Search by name, ${labels.reference.toLowerCase()} or ${labels.issuedBy.toLowerCase()}`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {kind !== "domain" && (
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {CATEGORIES[kind].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          )}
          <Select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            <option value="all">All open</option>
            <option value="attention">Needs attention</option>
            <option value="expired">Expired</option>
            <option value="soon">Due in 30 days</option>
            <option value="ok">Valid</option>
            <option value="closed">Closed</option>
          </Select>
        </div>

        {loading ? (
          <Spinner />
        ) : shown.length === 0 ? (
          <Empty>
            {perKind(kind).length === 0
              ? canEdit ? `No ${KINDS.find((k) => k.key === kind)!.label.toLowerCase()} yet. Add your first ${one} to get expiry reminders.` : `No ${KINDS.find((k) => k.key === kind)!.label.toLowerCase()} yet.`
              : "Nothing matches these filters."}
          </Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {shown.map(({ r, s }) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setViewingId(r.id)}
                  className="grid w-full gap-1 py-3 text-left hover:bg-slate-50 sm:grid-cols-[2fr_1.4fr_1fr_auto] sm:items-center sm:gap-3 sm:px-2"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-900">{r.name}</div>
                    <div className="truncate text-xs text-slate-500">
                      {[kind === "domain" ? r.issued_by : categoryLabel(r.kind, r.category), r.reference].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div className="truncate text-sm text-slate-600">
                    {kind === "asset" ? nameOf(people, r.held_by) || <span className="text-slate-400">Not assigned</span> : r.issued_by && kind !== "domain" ? r.issued_by : kind === "domain" && r.auto_renew ? "Auto-renew on" : ""}
                  </div>
                  <div className="text-sm text-slate-600">
                    {s.next ? (
                      <>
                        {date(s.next.date)}
                        {s.next.label !== labels.expiry && <span className="block text-xs text-slate-400">{s.next.label}</span>}
                      </>
                    ) : (
                      <span className="text-slate-400">No expiry</span>
                    )}
                  </div>
                  <div>
                    <StateBadge state={s.state} text={s.text} />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
            Files: {mb(limits.used_bytes)} of {limits.total_mb} MB used · up to {limits.file_mb} MB a file
          </p>
        )}
      </Card>

      {editing && (
        <RecordForm
          kind={editing === "new" ? kind : (editing.kind as Kind)}
          record={editing === "new" ? null : editing}
          people={people}
          limits={limits}
          onFilesChanged={reloadLimits}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            setViewingId(saved.id);
            load();
            reloadLimits();
          }}
        />
      )}

      {viewing && !editing && (
        <RecordDrawer
          record={viewing}
          people={people}
          limits={limits}
          onFilesChanged={reloadLimits}
          canEdit={canEdit}
          onClose={() => setViewingId(null)}
          onEdit={() => setEditing(viewing)}
          onChanged={load}
          onDeleted={() => {
            setViewingId(null);
            load();
            reloadLimits();
          }}
        />
      )}
    </>
  );
}

function order(s: State) {
  return { expired: 0, soon: 1, ok: 2, none: 3, closed: 4 }[s];
}

function StateBadge({ state, text }: { state: State; text: string }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${STATE_TONE[state]}`}>{text}</span>;
}

// ---------------------------------------------------------------------------
// Add / edit
// ---------------------------------------------------------------------------
type Form = {
  category: string;
  name: string;
  reference: string;
  issued_by: string;
  issue_date: string;
  expiry_date: string;
  amount: string;
  auto_renew: boolean;
  hosting_expiry: string;
  ssl_expiry: string;
  held_by: string;
  reminder_user_id: string;
  notes: string;
};

function toForm(r: CompanyRecord | null, kind: Kind): Form {
  return {
    category: r?.category ?? CATEGORIES[kind][0][0],
    name: r?.name ?? "",
    reference: r?.reference ?? "",
    issued_by: r?.issued_by ?? "",
    issue_date: r?.issue_date ?? "",
    expiry_date: r?.expiry_date ?? "",
    amount: r?.amount != null ? String(r.amount) : "",
    auto_renew: r?.auto_renew ?? false,
    hosting_expiry: r?.hosting_expiry ?? "",
    ssl_expiry: r?.ssl_expiry ?? "",
    held_by: r?.held_by ?? "",
    reminder_user_id: r?.reminder_user_id ?? "",
    notes: r?.notes ?? "",
  };
}

const PLACEHOLDER: Record<Kind, { name: string; reference: string; issuedBy: string }> = {
  document: { name: "e.g. GST registration certificate", reference: "e.g. 32ABCDE1234F1Z5", issuedBy: "e.g. GST department" },
  asset: { name: "e.g. MacBook Air – design team", reference: "e.g. SN C02XK1ABCD", issuedBy: "e.g. Croma, Kochi" },
  domain: { name: "e.g. yourcompany.in", reference: "", issuedBy: "e.g. GoDaddy" },
};

function RecordForm({
  kind,
  record,
  people,
  limits,
  onFilesChanged,
  onClose,
  onSaved,
}: {
  kind: Kind;
  record: CompanyRecord | null;
  people: Person[];
  limits: Limits;
  onFilesChanged: () => void;
  onClose: () => void;
  onSaved: (r: CompanyRecord) => void;
}) {
  const { workspace } = useWorkspace();
  const [form, setForm] = useState<Form>(() => toForm(record, kind));
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<string | false>(false);
  const input = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const blank = (s: string) => s.trim() || null;
  const labels = LABELS[kind];
  const ph = PLACEHOLDER[kind];
  const active = people.filter((p) => p.is_active);
  const one = KINDS.find((k) => k.key === kind)!.one;

  function pick(list: FileList | null) {
    const picked = Array.from(list ?? []);
    if (input.current) input.current.value = "";
    const tooBig = picked.find((f) => f.size > limits.file_mb * 1024 * 1024 && !f.type.startsWith("image/"));
    if (tooBig) return setError(`${tooBig.name} is over ${limits.file_mb} MB.`);
    const next = [...files, ...picked].slice(0, MAX_FILES);
    if (files.length + picked.length > MAX_FILES) setError(`You can add up to ${MAX_FILES} files here. Add more later from the item.`);
    else setError("");
    setFiles(next);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    const name = kind === "domain" ? form.name.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "") : form.name.trim();
    if (!name) return setError(kind === "domain" ? "Enter the domain name." : `Enter the ${one} name.`);
    if (form.issue_date && form.expiry_date && form.expiry_date < form.issue_date)
      return setError(`${labels.expiry} can't be before ${labels.issue.toLowerCase()}.`);
    const amount = form.amount.trim() ? Number(form.amount) : null;
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) return setError("Enter the amount in rupees, like 1499.");
    setSaving("Saving…");
    const row = {
      category: kind === "domain" ? "domain" : form.category,
      name,
      reference: blank(form.reference),
      issued_by: blank(form.issued_by),
      issue_date: form.issue_date || null,
      expiry_date: form.expiry_date || null,
      amount,
      auto_renew: kind === "domain" && form.auto_renew,
      hosting_expiry: kind === "domain" ? form.hosting_expiry || null : null,
      ssl_expiry: kind === "domain" ? form.ssl_expiry || null : null,
      held_by: kind === "asset" ? form.held_by || null : null,
      reminder_user_id: form.reminder_user_id || null,
      notes: blank(form.notes),
    };
    const res = record
      ? await supabase.from("company_records").update(row).eq("workspace_id", workspace.id).eq("id", record.id).select().single()
      : await supabase.from("company_records").insert({ ...row, kind, workspace_id: workspace.id }).select().single();
    if (res.error) {
      setSaving(false);
      return setError(res.error.message);
    }
    const failed: string[] = [];
    for (const [i, file] of files.entries()) {
      setSaving(`Uploading ${i + 1} of ${files.length}…`);
      const up = await uploadFile({ workspaceId: workspace.id, entityType: "company_record", entityId: res.data.id, file });
      if (!up.ok) failed.push(`${file.name}: ${up.message}`);
    }
    setSaving(false);
    if (failed.length) {
      window.alert(`Saved, but some files didn't upload:\n${failed.join("\n")}`);
    }
    onSaved(res.data);
  }

  return (
    <Modal title={record ? `Edit ${record.name}` : `Add ${one}`} onClose={onClose}>
      <form className="space-y-4" onSubmit={save}>
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          {kind !== "domain" && (
            <div className="sm:col-span-2">
              <Field label="Category">
                <Select value={form.category} onChange={(e) => set("category", e.target.value)}>
                  {CATEGORIES[kind].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
              </Field>
            </div>
          )}
          <div className="sm:col-span-2">
            <Field label={kind === "domain" ? "Domain name" : kind === "asset" ? "Asset name" : "Document name"}>
              <Input required value={form.name} placeholder={ph.name} onChange={(e) => set("name", e.target.value)} />
            </Field>
          </div>
          {kind === "domain" ? (
            <>
              <Field label={labels.issuedBy}>
                <Input list="registrars" value={form.issued_by} placeholder={ph.issuedBy} onChange={(e) => set("issued_by", e.target.value)} />
                <datalist id="registrars">{REGISTRARS.map((r) => <option key={r} value={r} />)}</datalist>
              </Field>
              <Field label={labels.reference} hint="Optional. The account the domain is in.">
                <Input value={form.reference} onChange={(e) => set("reference", e.target.value)} />
              </Field>
            </>
          ) : (
            <>
              <Field label={labels.reference}>
                <Input value={form.reference} placeholder={ph.reference} onChange={(e) => set("reference", e.target.value)} />
              </Field>
              <Field label={labels.issuedBy}>
                <Input value={form.issued_by} placeholder={ph.issuedBy} onChange={(e) => set("issued_by", e.target.value)} />
              </Field>
            </>
          )}
          <Field label={labels.issue}>
            <Input type="date" value={form.issue_date} onChange={(e) => set("issue_date", e.target.value)} />
          </Field>
          <Field label={labels.expiry} hint={kind === "domain" ? undefined : "Leave blank if it never expires."}>
            <Input type="date" value={form.expiry_date} onChange={(e) => set("expiry_date", e.target.value)} />
          </Field>
          {kind === "domain" && (
            <>
              <div className="sm:col-span-2">
                <label className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-700 ring-1 ring-slate-200">
                  <input type="checkbox" className="mt-0.5" checked={form.auto_renew} onChange={(e) => set("auto_renew", e.target.checked)} />
                  <span>
                    <span className="font-medium">Auto-renew is on at the registrar</span>
                    <span className="block text-xs text-slate-500">You'll get one heads-up 7 days before instead of repeated reminders.</span>
                  </span>
                </label>
              </div>
              <Field label="Hosting renewal (optional)">
                <Input type="date" value={form.hosting_expiry} onChange={(e) => set("hosting_expiry", e.target.value)} />
              </Field>
              <Field label="SSL certificate expiry (optional)">
                <Input type="date" value={form.ssl_expiry} onChange={(e) => set("ssl_expiry", e.target.value)} />
              </Field>
            </>
          )}
          <Field label={`${labels.amount.replace(" (₹)", "")} (₹, optional)`}>
            <Input type="number" min="0" step="0.01" inputMode="decimal" value={form.amount} onChange={(e) => set("amount", e.target.value)} />
          </Field>
          {kind === "asset" && (
            <Field label="Who has it">
              <Select value={form.held_by} onChange={(e) => set("held_by", e.target.value)}>
                <option value="">Not assigned / in office</option>
                {active.map((p) => <option key={p.user_id} value={p.user_id}>{p.full_name}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Also remind" hint="Owner and admins always get reminders.">
            <Select value={form.reminder_user_id} onChange={(e) => set("reminder_user_id", e.target.value)}>
              <option value="">No one else</option>
              {active.filter((p) => p.role === "staff").map((p) => <option key={p.user_id} value={p.user_id}>{p.full_name}</option>)}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Notes (optional)">
              <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
            </Field>
          </div>
        </div>

        {record && (
          <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
            <Attachments
              workspaceId={workspace.id}
              entityType="company_record"
              entityId={record.id}
              canUpload
              canDelete={() => true}
              ignoreSwitch
              maxMb={limits.file_mb}
              onUploaded={onFilesChanged}
            />
          </div>
        )}
        {!record && (
          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">Files (optional, up to {MAX_FILES})</span>
            <input ref={input} type="file" multiple accept="application/pdf,image/*" className="hidden" onChange={(e) => pick(e.target.files)} />
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={files.length >= MAX_FILES}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-3 text-sm text-slate-600 hover:border-brand-400 hover:bg-brand-50/40 disabled:opacity-50"
            >
              Choose files (PDF, JPG or PNG, up to {limits.file_mb} MB each)
            </button>
            <span className="mt-1 block text-xs text-slate-500">Large photos are made smaller before upload, so they go faster on mobile data.</span>
            {files.length > 0 && (
              <ul className="mt-2 space-y-1">
                {files.map((f, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-sm">
                    <span className="truncate">{f.name}</span>
                    <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => setFiles(files.filter((_, j) => j !== i))}>Remove</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <Button type="submit" className="w-full" disabled={!!saving}>
          {saving || (record ? "Save changes" : `Add ${one}`)}
        </Button>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// View: details, files, renewals
// ---------------------------------------------------------------------------
function RecordDrawer({
  record: r,
  people,
  limits,
  onFilesChanged,
  canEdit,
  onClose,
  onEdit,
  onChanged,
  onDeleted,
}: {
  record: CompanyRecord;
  people: Person[];
  limits: Limits;
  onFilesChanged: () => void;
  canEdit: boolean;
  onClose: () => void;
  onEdit: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const { workspace } = useWorkspace();
  const kind = r.kind as Kind;
  const labels = LABELS[kind];
  const s = stateOf(r);
  const [renewing, setRenewing] = useState(false);
  const [history, setHistory] = useState<Tables<"company_record_renewals">[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const loadHistory = useCallback(async () => {
    const { data } = await supabase
      .from("company_record_renewals")
      .select("*")
      .eq("record_id", r.id)
      .order("renewed_at", { ascending: false });
    setHistory(data ?? []);
  }, [r.id]);
  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  async function setStatus(status: "active" | "closed") {
    setBusy(true);
    const { error } = await supabase.from("company_records").update({ status }).eq("id", r.id);
    setBusy(false);
    if (error) return setError(error.message);
    onChanged();
  }

  async function remove() {
    if (!window.confirm(`Delete ${r.name} and its files? This can't be undone.`)) return;
    setBusy(true);
    setError("");
    const { data: files } = await supabase.from("files").select("id").eq("workspace_id", workspace.id).eq("entity_type", "company_record").eq("entity_id", r.id);
    for (const f of files ?? []) {
      const res = await deleteFile(f.id);
      if (!res.ok) {
        setBusy(false);
        return setError(res.message);
      }
    }
    const { error } = await supabase.from("company_records").delete().eq("id", r.id);
    setBusy(false);
    if (error) return setError(error.message);
    onDeleted();
  }

  const rows: [string, ReactNode][] = [
    kind !== "domain" ? ["Category", categoryLabel(r.kind, r.category)] : null,
    [labels.reference, r.reference],
    [labels.issuedBy, r.issued_by],
    [labels.issue, date(r.issue_date)],
    ...dueDates(r).map((d): [string, ReactNode] => [d.label === labels.expiry ? labels.expiry : `${d.label} renewal`, `${date(d.date)} (${d.days < 0 ? `${-d.days} days ago` : d.days === 0 ? "today" : `in ${d.days} days`})`]),
    kind === "domain" ? ["Auto-renew", r.auto_renew ? "On" : "Off"] : null,
    [labels.amount, r.amount != null ? inr(r.amount) : null],
    kind === "asset" ? ["Who has it", nameOf(people, r.held_by) || "Not assigned"] : null,
    ["Also reminds", nameOf(people, r.reminder_user_id)],
  ].filter((x): x is [string, ReactNode] => !!x && !!x[1]);

  return (
    <Drawer title={r.name} onClose={onClose}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone="bg-slate-100 text-slate-700">{KINDS.find((k) => k.key === kind)?.one.replace(/^./, (c) => c.toUpperCase())}</Badge>
        <StateBadge state={s.state} text={s.text} />
        {canEdit && (
          <div className="ml-auto flex flex-wrap gap-2">
            {r.status === "active" && <Button onClick={() => setRenewing(true)} disabled={busy}>Renew</Button>}
            <Button variant="secondary" onClick={onEdit} disabled={busy}>Edit</Button>
          </div>
        )}
      </div>
      {error && <div className="mb-3"><Alert>{error}</Alert></div>}

      <dl className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-slate-500">{k}</dt>
            <dd className="font-medium text-slate-800">{v}</dd>
          </div>
        ))}
      </dl>
      {r.notes && <p className="mt-4 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{r.notes}</p>}

      <div className="mt-5 border-t border-slate-100 pt-4">
        <Attachments
          workspaceId={workspace.id}
          entityType="company_record"
          entityId={r.id}
          canUpload={canEdit}
          canDelete={() => canEdit}
          ignoreSwitch
          maxMb={limits.file_mb}
          onUploaded={onFilesChanged}
        />
      </div>

      <div className="mt-5 border-t border-slate-100 pt-4">
        <h3 className="mb-2 text-sm font-semibold">Renewal history</h3>
        {history === null ? (
          <Spinner />
        ) : history.length === 0 ? (
          <p className="text-sm text-slate-500">Not renewed yet. Use Renew when you get the new {kind === "document" ? "document" : "date"}, so the old dates stay here.</p>
        ) : (
          <ul className="space-y-2">
            {history.map((h) => (
              <li key={h.id} className="rounded-md p-2.5 text-sm ring-1 ring-slate-200">
                <div className="font-medium text-slate-800">
                  {h.old_expiry ? `${date(h.old_expiry)} → ` : ""}{date(h.new_expiry)}
                  {h.amount != null && <span className="ml-2 font-normal text-slate-500">{inr(h.amount)}</span>}
                </div>
                <div className="text-xs text-slate-500">
                  Renewed {date(h.renewed_at)}{nameOf(people, h.renewed_by) ? ` by ${nameOf(people, h.renewed_by)}` : ""}
                </div>
                {h.note && <div className="mt-1 text-slate-600">{h.note}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {canEdit && (
        <div className="mt-6 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          {r.status === "active" ? (
            <Button variant="secondary" disabled={busy} onClick={() => setStatus("closed")} title="Stops reminders. Use when it's sold, cancelled or not being renewed.">
              Mark closed
            </Button>
          ) : (
            <Button variant="secondary" disabled={busy} onClick={() => setStatus("active")}>Reopen</Button>
          )}
          <Button variant="danger" disabled={busy} onClick={remove}>Delete</Button>
          {r.status === "active" && <p className="w-full text-xs text-slate-500">Mark closed stops reminders, for example when an asset is sold or a domain isn't being renewed.</p>}
        </div>
      )}

      {renewing && (
        <RenewModal
          record={r}
          onClose={() => setRenewing(false)}
          onDone={() => {
            setRenewing(false);
            loadHistory();
            onChanged();
          }}
        />
      )}
    </Drawer>
  );
}

function addYear(d: string | null) {
  if (!d) return "";
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCFullYear(x.getUTCFullYear() + 1);
  return x.toISOString().slice(0, 10);
}

function RenewModal({ record, onClose, onDone }: { record: CompanyRecord; onClose: () => void; onDone: () => void }) {
  const labels = LABELS[record.kind as Kind];
  const [expiry, setExpiry] = useState(addYear(record.expiry_date));
  const [amount, setAmount] = useState(record.amount != null ? String(record.amount) : "");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!expiry) return setError(`Enter the new ${labels.expiry.toLowerCase()}.`);
    const amt = amount.trim() ? Number(amount) : null;
    if (amt !== null && (!Number.isFinite(amt) || amt < 0)) return setError("Enter the amount in rupees, like 1499.");
    setSaving(true);
    const { error } = await supabase.rpc("renew_company_record", { p_id: record.id, p_new_expiry: expiry, p_amount: amt, p_note: note.trim() || null });
    setSaving(false);
    if (error) return setError(error.message);
    onDone();
  }

  return (
    <Modal title={`Renew ${record.name}`} onClose={onClose}>
      <form className="space-y-4" onSubmit={save}>
        {error && <Alert>{error}</Alert>}
        <p className="text-sm text-slate-600">
          {record.expiry_date ? <>Current date: <strong>{date(record.expiry_date)}</strong>. </> : null}
          The old date is kept in the renewal history. Upload the new copy from the item's Files.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={`New ${labels.expiry.toLowerCase()}`}>
            <Input type="date" required value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </Field>
          <Field label="Amount paid (₹, optional)">
            <Input type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
        </div>
        <Field label="Note (optional)">
          <Input value={note} placeholder="e.g. Renewed for 1 year, invoice #123" onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Button type="submit" className="w-full" disabled={saving}>{saving ? "Saving…" : "Save renewal"}</Button>
      </form>
    </Modal>
  );
}
