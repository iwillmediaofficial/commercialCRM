import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { supabase } from "../../lib/supabase";
import { signUpWithPin } from "../../lib/pinAuth";
import { Alert, Button, Field, Input, PasswordInput } from "../../components/ui";
import { AuthShell } from "./AuthShell";

// Sign-up needs a PIN from the Super Admin (company owners) or a company admin
// (staff). Name and phone come with the PIN from what the admin entered, so
// people only give email, password and PIN. No emails are sent.
export default function Signup() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const asPlatformAdmin = params.get("as") === "platform";
  const [form, setForm] = useState({ email: "", password: "", pin: params.get("pin") ?? "" });
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (form.password !== confirm) return setError("The two passwords don't match.");
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
        <Field label="Email" hint="The email your admin registered for you.">
          <Input type="email" autoComplete="email" required value={form.email} onChange={set("email")} />
        </Field>
        <Field label="New password" hint="At least 8 characters. If this email already has an account, use that password.">
          <PasswordInput autoComplete="new-password" minLength={8} required value={form.password} onChange={set("password")} />
        </Field>
        <Field label="Confirm password">
          <PasswordInput autoComplete="new-password" minLength={8} required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
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
