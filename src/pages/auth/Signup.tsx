import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { supabase } from "../../lib/supabase";
import { signUpWithPin } from "../../lib/pinAuth";
import { Alert, Button, Field, Input } from "../../components/ui";
import { AuthShell } from "./AuthShell";

// Sign-up needs a PIN from the Super Admin (company owners) or a company admin
// (staff). No emails are sent; the account is ready as soon as this succeeds.
export default function Signup() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const asPlatformAdmin = params.get("as") === "platform";
  const [form, setForm] = useState({ full_name: "", phone: "", email: "", password: "", pin: params.get("pin") ?? "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const result = await signUpWithPin({ ...form, purpose: asPlatformAdmin ? "platform_admin" : "signup" });
    if (!result.ok) {
      setBusy(false);
      setError(result.message);
      return;
    }
    await supabase.auth.signInWithPassword({ email: form.email.trim(), password: form.password });
    navigate("/", { replace: true });
  }

  return (
    <AuthShell
      title={asPlatformAdmin ? "Join as Super Admin" : "Create your account"}
      footer={<>Already have an account? <Link className="text-indigo-600" to="/login">Sign in</Link></>}
    >
      <form className="space-y-4" onSubmit={submit}>
        {error && <Alert>{error}</Alert>}
        <Field label="Full name">
          <Input required value={form.full_name} onChange={set("full_name")} />
        </Field>
        <Field label="Phone">
          <Input type="tel" value={form.phone} onChange={set("phone")} />
        </Field>
        <Field label="Email">
          <Input type="email" autoComplete="email" required value={form.email} onChange={set("email")} />
        </Field>
        <Field label="Password" hint="At least 8 characters. If this email already has an account, use that password.">
          <Input type="password" autoComplete="new-password" minLength={8} required value={form.password} onChange={set("password")} />
        </Field>
        <Field label="PIN" hint="The 8-character PIN your admin gave you.">
          <Input
            className="font-mono uppercase tracking-widest"
            required
            maxLength={12}
            value={form.pin}
            onChange={(e) => setForm({ ...form, pin: e.target.value.toUpperCase() })}
          />
        </Field>
        <Button className="w-full" disabled={busy}>{busy ? "Creating…" : "Create account"}</Button>
      </form>
    </AuthShell>
  );
}
