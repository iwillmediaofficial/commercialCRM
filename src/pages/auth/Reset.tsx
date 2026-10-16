import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { resetWithPin } from "../../lib/pinAuth";
import { Alert, Button, Field, Input } from "../../components/ui";
import { AuthShell } from "./AuthShell";

// Password reset with a PIN from your company admin (or the Super Admin for owners).
export default function Reset() {
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const result = await resetWithPin({ email, pin, password });
    setBusy(false);
    if (result.ok) setDone(true);
    else setError(result.message);
  }

  return (
    <AuthShell title="Reset password" footer={<Link className="text-indigo-600" to="/login">Back to sign in</Link>}>
      {done ? (
        <Alert tone="success">Your password is changed. You can sign in now.</Alert>
      ) : (
        <form className="space-y-4" onSubmit={submit}>
          <p className="text-sm text-slate-600">Ask your company admin for a reset PIN. Company owners get theirs from the Super Admin.</p>
          {error && <Alert>{error}</Alert>}
          <Field label="Email">
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Reset PIN">
            <Input className="font-mono uppercase tracking-widest" required value={pin} onChange={(e) => setPin(e.target.value.toUpperCase())} />
          </Field>
          <Field label="New password" hint="At least 8 characters.">
            <Input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button className="w-full" disabled={busy}>{busy ? "Saving…" : "Set new password"}</Button>
        </form>
      )}
    </AuthShell>
  );
}
