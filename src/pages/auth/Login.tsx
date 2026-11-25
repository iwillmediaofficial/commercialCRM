import { useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { getRememberMe, getRememberedEmail, setRememberMe, setRememberedEmail } from "../../lib/authStorage";
import { Alert, Button, Field, Input, PasswordInput } from "../../components/ui";
import { AuthShell } from "./AuthShell";

export default function Login() {
  const { session } = useAuth();
  const [email, setEmail] = useState(getRememberedEmail);
  const [remember, setRemember] = useState(getRememberMe);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setRememberMe(remember);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      setError("Wrong email or password.");
      return;
    }
    setRememberedEmail(remember ? email.trim() : null);
  }

  return (
    <AuthShell
      title="Sign in"
      footer={
        <>
          Have a PIN? <Link className="text-brand-600" to="/signup">Create your account</Link>
          <span className="mx-2">·</span>
          <Link className="text-brand-600" to="/reset">Forgot password</Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={submit}>
        {error && <Alert>{error}</Alert>}
        <Field label="Email">
          <Input type="email" autoComplete="email" required autoFocus={!email} value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <PasswordInput autoComplete="current-password" required autoFocus={Boolean(email)} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 select-none">
          <input
            type="checkbox"
            className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-brand-600"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          Remember me
          <span className="text-xs text-slate-400">(stay signed in on this device)</span>
        </label>
        <Button className="w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
      </form>
    </AuthShell>
  );
}
