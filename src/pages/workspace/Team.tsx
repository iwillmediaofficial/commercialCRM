import { useCallback, useEffect, useState } from "react";
import { supabase, type MemberRole, type Tables } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { useWorkspace } from "../../lib/workspace";
import { Alert, Button, Card, Field, Input, PinBox, Select } from "../../components/ui";

type Member = Tables<"workspace_members"> & { profile?: Tables<"profiles"> };
// pin_hash is never readable, so list the columns we may see.
const PIN_COLUMNS = "id, purpose, role, email, target_user_id, pin_hint, expires_at, used_at, revoked_at, created_at";
type PinRow = Pick<Tables<"access_pins">, "id" | "purpose" | "role" | "email" | "target_user_id" | "pin_hint" | "expires_at" | "used_at" | "revoked_at" | "created_at">;

export default function Team() {
  const { workspace, plan, canWrite, isAdmin } = useWorkspace();
  const { session } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [pins, setPins] = useState<PinRow[]>([]);
  const [newPin, setNewPin] = useState<{ pin: string; expires_at: string; label: string } | null>(null);
  const [role, setRole] = useState<MemberRole>("staff");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data: m } = await supabase.from("workspace_members").select("*").eq("workspace_id", workspace.id).order("joined_at");
    const ids = (m ?? []).map((x) => x.user_id);
    const { data: p } = ids.length ? await supabase.from("profiles").select("*").in("id", ids) : { data: [] };
    setMembers((m ?? []).map((x) => ({ ...x, profile: p?.find((y) => y.id === x.user_id) })));
    const { data: pinRows } = await supabase
      .from("access_pins")
      .select(PIN_COLUMNS)
      .eq("workspace_id", workspace.id)
      .is("used_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
    setPins((pinRows ?? []) as PinRow[]);
  }, [workspace.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function issue(purpose: "signup" | "reset", target?: Member) {
    setError("");
    setNewPin(null);
    const { data, error } = await supabase.rpc("issue_access_pin", {
      p_purpose: purpose,
      p_workspace_id: workspace.id,
      p_role: purpose === "signup" ? role : undefined,
      p_email: purpose === "signup" ? email || undefined : undefined,
      p_target_user_id: target?.user_id,
    });
    if (error) return setError(error.message);
    const label = purpose === "signup"
      ? `Sign-up PIN for a new ${role}${email ? ` (${email})` : ""}`
      : `Password reset PIN for ${target?.profile?.full_name || target?.profile?.email}`;
    setNewPin({ ...(data as { pin: string; expires_at: string }), label });
    setEmail("");
    load();
  }

  async function revoke(id: string) {
    const { error } = await supabase.rpc("revoke_access_pin", { p_pin_id: id });
    if (error) setError(error.message);
    load();
  }

  async function setActive(m: Member, is_active: boolean) {
    setError("");
    const { error } = await supabase
      .from("workspace_members")
      .update({ is_active })
      .eq("workspace_id", workspace.id)
      .eq("user_id", m.user_id);
    if (error) setError(error.message);
    load();
  }

  const active = members.filter((m) => m.is_active).length;

  return (
    <>
      {error && <Alert>{error}</Alert>}
      {newPin && (
        <Card title={newPin.label}>
          <PinBox pin={newPin.pin} expires={newPin.expires_at} />
          <p className="mt-2 text-sm text-slate-500">Send it to them yourself. They enter it at {newPin.label.startsWith("Password") ? "/reset" : "/signup"}.</p>
        </Card>
      )}

      <Card title={`Team (${active}${plan?.staff_limit ? ` of ${plan.staff_limit}` : ""} seats used)`}>
        <ul className="divide-y divide-slate-100">
          {members.map((m) => (
            <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div>
                <div className="font-medium">{m.profile?.full_name || m.profile?.email || "Member"}</div>
                <div className="text-xs text-slate-500">
                  {m.profile?.email} · <span className="capitalize">{m.role}</span>
                  {!m.is_active && " · deactivated"}
                </div>
              </div>
              {isAdmin && canWrite && m.role !== "owner" && m.user_id !== session?.user.id && (
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => issue("reset", m)}>Reset PIN</Button>
                  {m.is_active ? (
                    <Button variant="danger" onClick={() => setActive(m, false)}>Deactivate</Button>
                  ) : (
                    <Button variant="secondary" onClick={() => setActive(m, true)}>Reactivate</Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>

      {isAdmin && canWrite && (
        <Card title="Invite someone">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Role">
              <Select value={role} onChange={(e) => setRole(e.target.value as MemberRole)}>
                <option value="staff">Staff</option>
                <option value="admin">Admin</option>
              </Select>
            </Field>
            <Field label="Their email (optional)" hint="Locks the PIN to this email.">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <div className="flex items-end"><Button onClick={() => issue("signup")}>Create sign-up PIN</Button></div>
          </div>
        </Card>
      )}

      {pins.length > 0 && (
        <Card title="Unused PINs">
          <ul className="divide-y divide-slate-100 text-sm">
            {pins.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2">
                <span>
                  ••••••{p.pin_hint} · {p.purpose === "reset" ? "password reset" : `${p.role} sign-up`}
                  {p.email && ` · ${p.email}`} · until {new Date(p.expires_at).toLocaleDateString()}
                </span>
                {isAdmin && <Button variant="danger" onClick={() => revoke(p.id)}>Revoke</Button>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
