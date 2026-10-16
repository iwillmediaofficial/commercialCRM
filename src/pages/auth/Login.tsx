import { useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { Alert, Button, Field, Input } from "../../components/ui";
import { AuthShell } from "./AuthShell";

export default function Login() {
  const { session } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError("Wrong email or password.");
  }

  return (
    <AuthShell
      title="Sign in"
      footer={
        <>
          Have a PIN? <Link className="text-indigo-600" to="/signup">Create your account</Link>
          <span className="mx-2">·</span>
          <Link className="text-indigo-600" to="/reset">Forgot password</Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={submit}>
        {error && <Alert>{error}</Alert>}
        <Field label="Email">
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button className="w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
      </form>
    </AuthShell>
  );
}
