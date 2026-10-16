import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { supabase } from "../lib/supabase";
import { Alert, Button, Field, Input } from "../components/ui";

type FormField = { key: string; label: string; type: string; required?: boolean; options?: string[] };
type PublicFormData = { title: string; description: string | null; fields: FormField[]; company_name: string; theme_color: string | null };

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

  useEffect(() => {
    supabase.rpc("get_public_form", { p_slug: slug }).then(({ data }) => setForm((data as PublicFormData) ?? null));
  }, [slug]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { data, error } = await supabase.rpc("submit_public_lead", {
      p_slug: slug,
      p_name: values.name,
      p_phone: values.phone,
      p_email: values.email || undefined,
      p_answers: answers,
    });
    setBusy(false);
    if (error) setError(error.message);
    else setDone((data as { message?: string })?.message ?? "Thank you!");
  }

  if (form === undefined) return <div className="p-8 text-center text-sm text-slate-500">Loading…</div>;
  if (form === null) return <div className="p-8 text-center text-sm text-slate-500">This form is not available.</div>;

  return (
    <div className="flex min-h-screen justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6 text-center">
          <div className="text-sm text-slate-500">{form.company_name}</div>
          <h1 className="text-2xl font-semibold" style={form.theme_color ? { color: form.theme_color } : undefined}>{form.title}</h1>
          {form.description && <p className="mt-2 text-slate-600">{form.description}</p>}
        </div>
        <div className="rounded-lg bg-white p-6 shadow-sm ring-1 ring-slate-200">
          {done ? (
            <Alert tone="success">{done}</Alert>
          ) : (
            <form className="space-y-4" onSubmit={submit}>
              {error && <Alert>{error}</Alert>}
              <Field label="Name"><Input required value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} /></Field>
              <Field label="Phone"><Input type="tel" required value={values.phone} onChange={(e) => setValues({ ...values, phone: e.target.value })} /></Field>
              <Field label="Email"><Input type="email" value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} /></Field>
              {form.fields.map((f) => (
                <Field key={f.key} label={f.label}>
                  {f.type === "select" ? (
                    <select
                      className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      required={f.required}
                      value={answers[f.key] ?? ""}
                      onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.value })}
                    >
                      <option value="" />
                      {f.options?.map((o) => <option key={o}>{o}</option>)}
                    </select>
                  ) : f.type === "textarea" ? (
                    <textarea
                      className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      required={f.required}
                      value={answers[f.key] ?? ""}
                      onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.value })}
                    />
                  ) : (
                    <Input
                      type={f.type === "number" ? "number" : f.type === "email" ? "email" : f.type === "phone" ? "tel" : "text"}
                      required={f.required}
                      value={answers[f.key] ?? ""}
                      onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.value })}
                    />
                  )}
                </Field>
              ))}
              <Button className="w-full" disabled={busy}>{busy ? "Sending…" : "Submit"}</Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
