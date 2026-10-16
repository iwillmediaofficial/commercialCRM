import { useCallback, useEffect, useState, type FormEvent } from "react";
import { supabase, type Tables } from "../../../lib/supabase";
import { useAuth } from "../../../lib/auth";
import { useWorkspace } from "../../../lib/workspace";
import { date } from "../../../lib/format";
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, Select, Spinner, Textarea } from "../../../components/ui";
import { FIELD_TYPES, SLUG_RE, SOURCES, parseFields, safeColor, toKey, toSlug, type FieldType, type FormField } from "./leadShared";

type LeadForm = Tables<"lead_forms">;

const publicLink = (slug: string) => `${window.location.origin}/f/${slug}`;

export default function LeadForms() {
  const { workspace, isAdmin, canWrite, role, hasModule } = useWorkspace();
  const [forms, setForms] = useState<LeadForm[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState<LeadForm | "new" | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const canEdit = isAdmin && canWrite;

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("lead_forms").select("*").eq("workspace_id", workspace.id).order("created_at", { ascending: false });
    if (error) setError(error.message);
    setForms(data ?? []);
    const { data: l } = await supabase.from("leads").select("form_id").eq("workspace_id", workspace.id).not("form_id", "is", null);
    const c: Record<string, number> = {};
    for (const x of l ?? []) if (x.form_id) c[x.form_id] = (c[x.form_id] ?? 0) + 1;
    setCounts(c);
  }, [workspace.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function copy(slug: string) {
    try {
      await navigator.clipboard.writeText(publicLink(slug));
      setCopied(slug);
      setTimeout(() => setCopied((c) => (c === slug ? "" : c)), 2000);
    } catch {
      prompt("Copy this link:", publicLink(slug));
    }
  }

  async function toggle(f: LeadForm) {
    setError("");
    const { error } = await supabase.from("lead_forms").update({ is_active: !f.is_active }).eq("workspace_id", workspace.id).eq("id", f.id);
    if (error) return setError(error.message);
    setForms((fs) => (fs ?? []).map((x) => (x.id === f.id ? { ...x, is_active: !f.is_active } : x)));
  }

  if (!isAdmin && role !== null) {
    return <Card title="Lead forms"><p className="text-sm text-slate-500">Only owners and admins can manage lead forms.</p></Card>;
  }
  if (!hasModule("leads")) {
    return <Card title="Lead forms"><p className="text-sm text-slate-500">Leads are not part of your current plan.</p></Card>;
  }
  if (!forms) return <Spinner />;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Lead forms</h1>
          <p className="text-sm text-slate-500">Share a form link in your ads, website or social media bio. Every reply lands in Leads.</p>
        </div>
        {canEdit && <Button onClick={() => setEditing("new")}>+ New form</Button>}
      </div>

      {error && <Alert>{error}</Alert>}

      {forms.length ? (
        <div className="grid gap-3">
          {forms.map((f) => {
            const color = safeColor(f.theme_color);
            return (
              <Card key={f.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {color && <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} aria-hidden />}
                      <h2 className="font-semibold">{f.title}</h2>
                      {f.is_active ? <Badge tone="bg-green-100 text-green-800">Live</Badge> : <Badge>Switched off</Badge>}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {counts[f.id] ?? 0} lead{counts[f.id] === 1 ? "" : "s"} · {parseFields(f.fields).length} extra question{parseFields(f.fields).length === 1 ? "" : "s"} · source "{f.default_source}" · made {date(f.created_at)}
                    </div>
                    <div className="mt-2 flex min-w-0 items-center gap-2">
                      <code className="min-w-0 truncate rounded bg-slate-100 px-2 py-1 text-xs">{publicLink(f.slug)}</code>
                      <Button variant="secondary" className="shrink-0 py-1! text-xs" onClick={() => copy(f.slug)}>{copied === f.slug ? "Copied" : "Copy"}</Button>
                      <a className="shrink-0 text-xs font-medium text-indigo-600 hover:underline" href={`/f/${f.slug}`} target="_blank" rel="noreferrer">Open</a>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {canEdit && <Button variant="secondary" onClick={() => toggle(f)}>{f.is_active ? "Switch off" : "Switch on"}</Button>}
                    <Button variant="secondary" onClick={() => setEditing(f)}>{canEdit ? "Edit" : "View"}</Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card><Empty>No forms yet. {canEdit ? "Make one to start collecting leads." : ""}</Empty></Card>
      )}

      {editing && (
        <FormEditor
          form={editing === "new" ? null : editing}
          readOnly={!canEdit}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </>
  );
}

function FormEditor({ form, readOnly, onClose, onSaved }: { form: LeadForm | null; readOnly: boolean; onClose: () => void; onSaved: () => void }) {
  const { workspace } = useWorkspace();
  const { session } = useAuth();
  const [v, setV] = useState({
    title: form?.title ?? "",
    slug: form?.slug ?? "",
    description: form?.description ?? "",
    default_source: form?.default_source ?? "Lead form",
    theme_color: safeColor(form?.theme_color) ?? "#4f46e5",
    success_message: form?.success_message ?? "",
    is_active: form?.is_active ?? true,
  });
  const [slugTouched, setSlugTouched] = useState(!!form);
  const [fields, setFields] = useState<FormField[]>(() => parseFields(form?.fields));
  const [optionText, setOptionText] = useState<string[]>(() => parseFields(form?.fields).map((f) => (f.options ?? []).join(", ")));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const sources = SOURCES.includes(v.default_source) ? SOURCES : [...SOURCES, v.default_source];

  function updateField(i: number, patch: Partial<FormField>) {
    setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  }
  function addField() {
    setFields((fs) => [...fs, { key: "", label: "", type: "text", required: false }]);
    setOptionText((o) => [...o, ""]);
  }
  function removeField(i: number) {
    setFields((fs) => fs.filter((_, j) => j !== i));
    setOptionText((o) => o.filter((_, j) => j !== i));
  }
  function moveField(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= fields.length) return;
    const swap = <T,>(a: T[]) => {
      const b = [...a];
      [b[i], b[j]] = [b[j], b[i]];
      return b;
    };
    setFields(swap);
    setOptionText(swap);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    const slug = v.slug.trim().toLowerCase();
    if (!SLUG_RE.test(slug)) return setError("The link name can use small letters, numbers and dashes only (at least 3 characters).");

    const cleaned: FormField[] = [];
    const keys = new Set(["name", "phone", "email"]);
    for (const [i, f] of fields.entries()) {
      const label = f.label.trim();
      if (!label) return setError(`Question ${i + 1} needs a label.`);
      let key = f.key || toKey(label) || `q${i + 1}`;
      while (keys.has(key)) key = `${key}_${i + 1}`;
      keys.add(key);
      const out: FormField = { key, label, type: f.type, required: !!f.required };
      if (f.type === "select") {
        const options = optionText[i].split(",").map((o) => o.trim()).filter(Boolean);
        if (!options.length) return setError(`Add some choices for "${label}", separated by commas.`);
        out.options = [...new Set(options)];
      }
      cleaned.push(out);
    }

    const row = {
      title: v.title.trim(),
      slug,
      description: v.description.trim() || null,
      default_source: v.default_source,
      theme_color: v.theme_color,
      success_message: v.success_message.trim() || null,
      is_active: v.is_active,
      fields: cleaned,
    };
    setBusy(true);
    const { error } = form
      ? await supabase.from("lead_forms").update(row).eq("workspace_id", workspace.id).eq("id", form.id)
      : await supabase.from("lead_forms").insert({ ...row, workspace_id: workspace.id, created_by: session?.user.id ?? null });
    setBusy(false);
    if (error) {
      if (error.code === "23505" || /lead_forms_slug_key/.test(error.message)) return setError("That link name is already taken. Please try another one.");
      return setError(error.message);
    }
    onSaved();
  }

  async function remove() {
    if (!form || !confirm(`Delete the form "${form.title}"? Its link stops working. Leads it already collected stay in Leads.`)) return;
    setBusy(true);
    const { error } = await supabase.from("lead_forms").delete().eq("workspace_id", workspace.id).eq("id", form.id);
    setBusy(false);
    if (error) return setError(error.message);
    onSaved();
  }

  return (
    <Modal title={form ? (readOnly ? form.title : "Edit form") : "New lead form"} onClose={onClose} wide>
      <form className="space-y-5" onSubmit={save}>
        {error && <Alert>{error}</Alert>}
        <fieldset disabled={readOnly || busy} className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Form title" hint="Shown at the top of the form.">
              <Input
                required
                maxLength={120}
                value={v.title}
                onChange={(e) => setV({ ...v, title: e.target.value, slug: slugTouched ? v.slug : toSlug(e.target.value) })}
              />
            </Field>
            <Field label="Link name" hint={`${window.location.origin}/f/${v.slug || "your-form"}`}>
              <Input
                required
                value={v.slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setV({ ...v, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") });
                }}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Description" hint="A line or two telling people what they get.">
                <Textarea value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
              </Field>
            </div>
            <Field label="Leads from this form are marked as">
              <Select value={v.default_source} onChange={(e) => setV({ ...v, default_source: e.target.value })}>
                {sources.map((s) => <option key={s}>{s}</option>)}
              </Select>
            </Field>
            <Field label="Brand colour">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Pick colour"
                  className="h-9 w-12 cursor-pointer rounded border border-slate-300 bg-white p-1"
                  value={v.theme_color}
                  onChange={(e) => setV({ ...v, theme_color: e.target.value })}
                />
                <Input value={v.theme_color} onChange={(e) => /^#?[0-9a-fA-F]{0,6}$/.test(e.target.value) && setV({ ...v, theme_color: e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}` })} />
              </div>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Thank-you message" hint="Shown after someone sends the form.">
                <Input placeholder="Thank you! We will contact you soon." value={v.success_message} onChange={(e) => setV({ ...v, success_message: e.target.value })} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={v.is_active} onChange={(e) => setV({ ...v, is_active: e.target.checked })} />
              Form is live (people can open and send it)
            </label>
          </div>

          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">Logo and banner</span>
            <p className="text-xs text-slate-500">File uploads arrive with file storage. Until then the form shows your company name and brand colour.</p>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <span className="block text-sm font-medium text-slate-700">Questions</span>
                <span className="block text-xs text-slate-500">Name, phone and email are always asked. Add any extra questions below.</span>
              </div>
              {!readOnly && <Button type="button" variant="secondary" onClick={addField}>+ Add question</Button>}
            </div>
            {fields.length ? (
              <ol className="space-y-2">
                {fields.map((f, i) => (
                  <li key={i} className="rounded-md bg-slate-50 p-3 ring-1 ring-slate-200">
                    <div className="grid gap-2 sm:grid-cols-[1fr_11rem]">
                      <Input placeholder={`Question ${i + 1}, e.g. Monthly budget`} value={f.label} onChange={(e) => updateField(i, { label: e.target.value })} aria-label="Question" />
                      <Select value={f.type} onChange={(e) => updateField(i, { type: e.target.value as FieldType })} aria-label="Answer type">
                        {FIELD_TYPES.map(([t, l]) => <option key={t} value={t}>{l}</option>)}
                      </Select>
                    </div>
                    {f.type === "select" && (
                      <Input
                        className="mt-2"
                        placeholder="Choices, separated by commas: Under ₹10,000, ₹10,000 to ₹50,000"
                        value={optionText[i]}
                        onChange={(e) => setOptionText((o) => o.map((x, j) => (j === i ? e.target.value : x)))}
                        aria-label="Choices"
                      />
                    )}
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={!!f.required} onChange={(e) => updateField(i, { required: e.target.checked })} />
                        Must be answered
                      </label>
                      {!readOnly && (
                        <div className="flex gap-1">
                          <Button type="button" variant="secondary" className="px-2! py-1! text-xs" disabled={i === 0} onClick={() => moveField(i, -1)} aria-label="Move up">↑</Button>
                          <Button type="button" variant="secondary" className="px-2! py-1! text-xs" disabled={i === fields.length - 1} onClick={() => moveField(i, 1)} aria-label="Move down">↓</Button>
                          <Button type="button" variant="danger" className="px-2! py-1! text-xs" onClick={() => removeField(i)}>Remove</Button>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500 ring-1 ring-slate-200">No extra questions.</p>
            )}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>{form && !readOnly && <Button type="button" variant="danger" disabled={busy} onClick={remove}>Delete form</Button>}</div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>{readOnly ? "Close" : "Cancel"}</Button>
            {!readOnly && <Button disabled={busy}>{busy ? "Saving…" : form ? "Save" : "Create form"}</Button>}
          </div>
        </div>
      </form>
    </Modal>
  );
}
