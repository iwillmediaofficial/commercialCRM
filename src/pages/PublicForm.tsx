import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { useParams } from "react-router";
import { supabase } from "../lib/supabase";
import { Alert, Field, Input, Select, Textarea } from "../components/ui";
import { parseFields, safeColor, textOn, type FormField } from "./workspace/leads/leadShared";

type PublicFormData = {
  title: string;
  description: string | null;
  fields: FormField[];
  company_name: string;
  theme_color: string | null;
};

// The page a company shares with prospects. No sign-in; leads go straight into
// that company's Leads list.
export default function PublicForm() {
  const { slug = "" } = useParams();
  const [form, setForm] = useState<PublicFormData | null | undefined>(undefined);
  const [values, setValues] = useState({ name: "", phone: "", email: "" });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [done, setDone] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [art, setArt] = useState<{ logo: string | null; banner: string | null }>({ logo: null, banner: null });

  useEffect(() => {
    let cancelled = false;
    supabase.functions
      .invoke("files", { body: { action: "public_form", slug } })
      .then(({ data }) => {
        if (!cancelled && data?.ok) setArt({ logo: data.logo ?? null, banner: data.banner ?? null });
      })
      .catch(() => {
        /* no branding; keep the plain look */
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    supabase.rpc("get_public_form", { p_slug: slug }).then(({ data }) => {
      const d = data as (Omit<PublicFormData, "fields"> & { fields: unknown }) | null;
      setForm(d ? { ...d, fields: parseFields(d.fields as never) } : null);
    });
  }, [slug]);

  useEffect(() => {
    if (form) document.title = `${form.title} · ${form.company_name}`;
  }, [form]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!values.phone.trim() && !values.email.trim()) return setError("Please give a phone number or an email so we can reach you.");
    setBusy(true);
    setError("");
    // Send only answers to questions on this form, trimmed.
    const clean: Record<string, string> = {};
    for (const f of form?.fields ?? []) {
      const a = answers[f.key]?.trim();
      if (a) clean[f.key] = a;
    }
    const { data, error } = await supabase.rpc("submit_public_lead", {
      p_slug: slug,
      p_name: values.name.trim(),
      p_phone: values.phone.trim(),
      p_email: values.email.trim() || undefined,
      p_answers: clean,
    });
    setBusy(false);
    if (error) setError(error.message);
    else {
      setDone((data as { message?: string })?.message ?? "Thank you! We will contact you soon.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  if (form === undefined) return <div className="p-8 text-center text-sm text-slate-500">Loading…</div>;
  if (form === null)
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <h1 className="text-lg font-semibold text-slate-800">This form is not available</h1>
          <p className="mt-1 text-sm text-slate-500">The link may be wrong, or the form has been switched off.</p>
        </div>
      </div>
    );

  const color = safeColor(form.theme_color) ?? "#4f46e5";
  const brand: CSSProperties = { backgroundColor: color, color: textOn(color) };
  const set = (k: string) => (e: { target: { value: string } }) => setAnswers({ ...answers, [k]: e.target.value });

  return (
    <div className="min-h-screen bg-slate-50">
      {art.banner ? (
        <div className="h-40 w-full overflow-hidden sm:h-56" style={{ backgroundColor: color }}>
          <img src={art.banner} alt="" className="h-full w-full object-cover" />
        </div>
      ) : (
        <div className="h-28 sm:h-36" style={{ backgroundColor: color }} />
      )}
      <div className={`mx-auto w-full max-w-lg px-4 pb-10 ${art.banner ? "-mt-10 sm:-mt-12" : "-mt-20 sm:-mt-24"}`}>
        <div className="overflow-hidden rounded-xl bg-white shadow-md ring-1 ring-slate-200">
          <div className="border-b border-slate-100 px-5 pt-6 pb-5 sm:px-6">
            <div className="mb-3 flex items-center gap-3">
              {art.logo ? (
                <img src={art.logo} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover ring-1 ring-slate-200" />
              ) : (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-semibold" style={brand} aria-hidden>
                  {form.company_name.trim().charAt(0).toUpperCase()}
                </div>
              )}
              <div className="text-sm font-medium text-slate-600">{form.company_name}</div>
            </div>
            <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{form.title}</h1>
            {form.description && <p className="mt-2 whitespace-pre-line text-sm text-slate-600 sm:text-base">{form.description}</p>}
          </div>

          <div className="px-5 py-6 sm:px-6">
            {done ? (
              <div className="py-6 text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full" style={brand} aria-hidden>
                  <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="whitespace-pre-line text-base text-slate-800">{done}</p>
              </div>
            ) : (
              <form className="space-y-4" onSubmit={submit}>
                {error && <Alert>{error}</Alert>}
                <Field label="Your name *">
                  <Input required autoComplete="name" maxLength={200} value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} />
                </Field>
                <Field label={values.email.trim() ? "Phone" : "Phone *"}>
                  <Input type="tel" inputMode="tel" autoComplete="tel" maxLength={40} required={!values.email.trim()} value={values.phone} onChange={(e) => setValues({ ...values, phone: e.target.value })} />
                </Field>
                <Field label="Email">
                  <Input type="email" autoComplete="email" maxLength={200} value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} />
                </Field>
                {form.fields.map((f) => (
                  <Field key={f.key} label={f.required ? `${f.label} *` : f.label}>
                    {f.type === "select" ? (
                      <Select required={f.required} value={answers[f.key] ?? ""} onChange={set(f.key)}>
                        <option value="">Choose…</option>
                        {f.options?.map((o) => <option key={o}>{o}</option>)}
                      </Select>
                    ) : f.type === "textarea" ? (
                      <Textarea required={f.required} maxLength={2000} value={answers[f.key] ?? ""} onChange={set(f.key)} />
                    ) : (
                      <Input
                        type={f.type === "number" ? "number" : f.type === "email" ? "email" : f.type === "phone" ? "tel" : "text"}
                        inputMode={f.type === "number" ? "decimal" : f.type === "phone" ? "tel" : undefined}
                        required={f.required}
                        maxLength={500}
                        value={answers[f.key] ?? ""}
                        onChange={set(f.key)}
                      />
                    )}
                  </Field>
                ))}
                <button
                  className="w-full rounded-md px-4 py-3 text-base font-semibold shadow-sm transition hover:opacity-90 disabled:opacity-50"
                  style={brand}
                  disabled={busy}
                >
                  {busy ? "Sending…" : "Submit"}
                </button>
                <p className="text-center text-xs text-slate-400">Your details go only to {form.company_name}.</p>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
