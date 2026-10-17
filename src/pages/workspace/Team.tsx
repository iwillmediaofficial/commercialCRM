import { useCallback, useEffect, useState, type FormEvent } from "react";
import { supabase, type MemberRole, type Tables } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { useWorkspace } from "../../lib/workspace";
import { ImagePicker, StoredImage } from "../../components/Files";
import { Alert, Badge, Button, Card, Field, Input, Modal, PinBox, Select } from "../../components/ui";

type Member = Tables<"workspace_members"> & { profile?: Tables<"profiles"> };
// pin_hash is never readable, so list the columns we may see.
const PIN_COLUMNS = "id, purpose, role, email, full_name, target_user_id, pin_hint, expires_at, used_at, revoked_at, created_at";
type PinRow = Pick<Tables<"access_pins">, "id" | "purpose" | "role" | "email" | "full_name" | "target_user_id" | "pin_hint" | "expires_at" | "used_at" | "revoked_at" | "created_at">;
type Stats = Record<string, { completed: number; seconds: number; runningSince: string | null }>;

const ROLE_TONE: Record<MemberRole, string> = {
  owner: "bg-purple-100 text-purple-700",
  admin: "bg-indigo-100 text-indigo-700",
  staff: "bg-slate-100 text-slate-700",
};

function hours(seconds: number) {
  const h = seconds / 3600;
  return `${h.toLocaleString("en-IN", { maximumFractionDigits: 1 })} h`;
}

export default function Team() {
  const { workspace, plan, role: myRole, canWrite, isAdmin, hasModule } = useWorkspace();
  const { session } = useAuth();
  const me = session?.user.id;
  const [members, setMembers] = useState<Member[]>([]);
  const [pins, setPins] = useState<PinRow[]>([]);
  const [stats, setStats] = useState<Stats>({});
  const [newPin, setNewPin] = useState<{ pin: string; expires_at: string; label: string } | null>(null);
  const [role, setRole] = useState<MemberRole>("staff");
  const [invite, setInvite] = useState({ full_name: "", phone: "", email: "" });
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [editingSelf, setEditingSelf] = useState(false);
  const showStats = (isAdmin || myRole === null) && hasModule("work"); // null role = Super Admin support view

  const loadStats = useCallback(async () => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const [{ data: done }, { data: logged }, { data: running }] = await Promise.all([
      supabase
        .from("work_item_assignees")
        .select("user_id, work_items!inner(status)")
        .eq("workspace_id", workspace.id)
        .eq("work_items.status", "completed"),
      supabase
        .from("time_entries")
        .select("user_id, duration_seconds")
        .eq("workspace_id", workspace.id)
        .gte("started_at", monthStart)
        .not("stopped_at", "is", null),
      supabase.from("time_entries").select("user_id, started_at").eq("workspace_id", workspace.id).is("stopped_at", null),
    ]);
    const s: Stats = {};
    const get = (id: string) => (s[id] ??= { completed: 0, seconds: 0, runningSince: null });
    for (const r of done ?? []) get(r.user_id).completed++;
    for (const r of logged ?? []) get(r.user_id).seconds += r.duration_seconds ?? 0;
    for (const r of running ?? []) get(r.user_id).runningSince = r.started_at;
    setStats(s);
  }, [workspace.id]);

  const load = useCallback(async () => {
    const { data: m } = await supabase.from("workspace_members").select("*").eq("workspace_id", workspace.id).order("joined_at");
    const ids = (m ?? []).map((x) => x.user_id);
    const { data: p } = ids.length ? await supabase.from("profiles").select("*").in("id", ids) : { data: [] };
    setMembers((m ?? []).map((x) => ({ ...x, profile: p?.find((y) => y.id === x.user_id) })));
    if (isAdmin) {
      const { data: pinRows } = await supabase
        .from("access_pins")
        .select(PIN_COLUMNS)
        .eq("workspace_id", workspace.id)
        .is("used_at", null)
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false });
      setPins((pinRows ?? []) as PinRow[]);
    }
    if (showStats) loadStats();
  }, [workspace.id, isAdmin, showStats, loadStats]);

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
      p_email: purpose === "signup" ? invite.email : undefined,
      p_full_name: purpose === "signup" ? invite.full_name : undefined,
      p_phone: purpose === "signup" ? invite.phone || undefined : undefined,
      p_target_user_id: target?.user_id,
    });
    if (error) return setError(error.message);
    const label = purpose === "signup"
      ? `Sign-up PIN for ${invite.full_name} (${role}, ${invite.email})`
      : `Password reset PIN for ${target?.profile?.full_name || target?.profile?.email}`;
    setNewPin({ ...(data as { pin: string; expires_at: string }), label });
    setInvite({ full_name: "", phone: "", email: "" });
    load();
  }

  async function revoke(id: string) {
    const { error } = await supabase.rpc("revoke_access_pin", { p_pin_id: id });
    if (error) setError(error.message);
    load();
  }

  async function updateMember(m: Member, change: { is_active?: boolean; role?: MemberRole }) {
    setError("");
    const { error } = await supabase
      .from("workspace_members")
      .update(change)
      .eq("workspace_id", workspace.id)
      .eq("user_id", m.user_id);
    if (error) setError(error.message);
    load();
  }

  const active = members.filter((m) => m.is_active).length;
  // Unused sign-up PINs hold a seat too, so stop handing out PINs that can't be used.
  const openInvites = pins.filter((p) => p.purpose === "signup" && p.role !== "owner").length;
  const seatsFull = !!plan?.staff_limit && active + openInvites >= plan.staff_limit;
  const meMember = members.find((m) => m.user_id === me);

  const q = search.trim().toLowerCase();
  const shown = members.filter(
    (m) =>
      !q ||
      [m.profile?.full_name, m.profile?.email, m.profile?.phone, m.profile?.designation, m.profile?.department, m.role].some((v) =>
        v?.toLowerCase().includes(q),
      ),
  );

  return (
    <>
      {error && <Alert>{error}</Alert>}
      {newPin && (
        <Card title={newPin.label}>
          <PinBox pin={newPin.pin} expires={newPin.expires_at} />
          <p className="mt-2 text-sm text-slate-500">Send it to them yourself. They enter it at {newPin.label.startsWith("Password") ? "/reset" : "/signup"}.</p>
        </Card>
      )}

      <Card
        title={`Team (${active}${plan?.staff_limit ? ` of ${plan.staff_limit}` : ""} seats used)`}
        actions={meMember && <Button variant="secondary" onClick={() => setEditingSelf(true)}>Edit my profile</Button>}
      >
        {members.length > 5 && (
          <div className="mb-3">
            <Input placeholder="Search by name, job title, email or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        )}
        {showStats && (
          <p className="mb-2 text-xs text-slate-500">Tasks completed (all time) · hours logged this month · timer running now.</p>
        )}
        <ul className="divide-y divide-slate-100">
          {shown.map((m) => {
            const p = m.profile;
            const st = stats[m.user_id];
            const isMe = m.user_id === me;
            const manageable = isAdmin && canWrite && m.role !== "owner" && !isMe;
            return (
              <li key={m.user_id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700">
                    {(p?.full_name || p?.email || "?").trim().charAt(0).toUpperCase()}
                    {p?.avatar_path && <StoredImage storageKey={p.avatar_path} className="absolute inset-0 h-full w-full object-cover" />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{p?.full_name || p?.email || "Member"}</span>
                      {isMe && <span className="text-xs text-slate-400">(you)</span>}
                      <Badge tone={ROLE_TONE[m.role]}><span className="capitalize">{m.role}</span></Badge>
                      {m.is_active ? (
                        <Badge tone="bg-green-100 text-green-700">Active</Badge>
                      ) : (
                        <Badge tone="bg-slate-100 text-slate-500">Inactive</Badge>
                      )}
                    </div>
                    {(p?.designation || p?.department) && (
                      <div className="text-sm text-slate-600">{[p?.designation, p?.department].filter(Boolean).join(" · ")}</div>
                    )}
                    <div className="text-xs break-all text-slate-500">
                      {p?.email && <a href={`mailto:${p.email}`} className="hover:text-indigo-600">{p.email}</a>}
                      {p?.phone && <> · <a href={`tel:${p.phone}`} className="hover:text-indigo-600">{p.phone}</a></>}
                    </div>
                    {showStats && (
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                        <span>{st?.completed ?? 0} tasks completed</span>
                        <span>{hours(st?.seconds ?? 0)} this month</span>
                        {st?.runningSince ? (
                          <span className="flex items-center gap-1 text-green-700">
                            <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
                            Timer running since {new Date(st.runningSince).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
                          </span>
                        ) : (
                          <span className="text-slate-400">No timer running</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                {manageable && (
                  <div className="flex flex-wrap gap-2">
                    {myRole === "owner" && (
                      <Select
                        className="w-auto"
                        aria-label="Role"
                        value={m.role}
                        onChange={(e) => updateMember(m, { role: e.target.value as MemberRole })}
                      >
                        <option value="staff">Staff</option>
                        <option value="admin">Admin</option>
                      </Select>
                    )}
                    <Button variant="secondary" onClick={() => issue("reset", m)}>Reset PIN</Button>
                    {m.is_active ? (
                      <Button variant="danger" onClick={() => updateMember(m, { is_active: false })}>Deactivate</Button>
                    ) : (
                      <Button variant="secondary" onClick={() => updateMember(m, { is_active: true })}>Reactivate</Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {isAdmin && (
          <p className="mt-3 text-xs text-slate-500">
            {myRole === "owner"
              ? "As the owner you can switch others between Admin and Staff. Admins manage all modules, billing, ad funds and settings; Staff work on their own tasks, time and leads."
              : "Only the owner can change roles. Admins manage all modules, billing, ad funds and settings; Staff work on their own tasks, time and leads."}
          </p>
        )}
      </Card>

      {isAdmin && canWrite && (
        <Card title="Invite someone">
          {seatsFull ? (
            <Alert tone="warning">
              All {plan?.staff_limit} seats on your plan are taken
              {openInvites > 0 ? ` (${openInvites} by unused PIN${openInvites > 1 ? "s" : ""} below)` : ""}.
              To add someone, deactivate a member, revoke an unused PIN, or upgrade your plan on the Billing page.
            </Alert>
          ) : (
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              issue("signup");
            }}
          >
            <Field label="Full name">
              <Input required value={invite.full_name} onChange={(e) => setInvite({ ...invite, full_name: e.target.value })} />
            </Field>
            <Field label="Phone">
              <Input type="tel" value={invite.phone} onChange={(e) => setInvite({ ...invite, phone: e.target.value })} />
            </Field>
            <Field label="Email" hint="They sign up with this email; the PIN works only for it.">
              <Input type="email" required value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
            </Field>
            <Field label="Role">
              <Select value={role} onChange={(e) => setRole(e.target.value as MemberRole)}>
                <option value="staff">Staff</option>
                <option value="admin">Admin</option>
              </Select>
            </Field>
            <div className="flex items-end sm:col-span-2"><Button>Create sign-up PIN</Button></div>
          </form>
          )}
        </Card>
      )}

      {isAdmin && pins.length > 0 && (
        <Card title="Unused PINs">
          <ul className="divide-y divide-slate-100 text-sm">
            {pins.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  ••••••{p.pin_hint} · {p.purpose === "reset" ? "password reset" : `${p.role} sign-up`}
                  {p.full_name && ` · ${p.full_name}`}{p.email && ` · ${p.email}`} · until {new Date(p.expires_at).toLocaleDateString()}
                </span>
                {canWrite && <Button variant="danger" onClick={() => revoke(p.id)}>Revoke</Button>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {editingSelf && meMember?.profile && (
        <ProfileForm
          profile={meMember.profile}
          onClose={() => setEditingSelf(false)}
          onSaved={() => {
            setEditingSelf(false);
            load();
          }}
        />
      )}
    </>
  );
}

function ProfileForm({ profile, onClose, onSaved }: { profile: Tables<"profiles">; onClose: () => void; onSaved: () => void }) {
  const { workspace, canWrite } = useWorkspace();
  const [avatar, setAvatar] = useState<string | null>(profile.avatar_path ?? null);
  const [form, setForm] = useState({
    full_name: profile.full_name,
    phone: profile.phone ?? "",
    designation: profile.designation ?? "",
    department: profile.department ?? "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: form.full_name.trim(),
        phone: form.phone.trim() || null,
        designation: form.designation.trim() || null,
        department: form.department.trim() || null,
        avatar_path: avatar,
      })
      .eq("id", profile.id);
    setSaving(false);
    if (error) return setError(error.message);
    onSaved();
  }

  return (
    <Modal title="Edit my profile" onClose={onClose}>
      <form className="space-y-3" onSubmit={save}>
        {error && <Alert>{error}</Alert>}
        <ImagePicker
          workspaceId={workspace.id}
          entityType="profile"
          entityId={profile.id}
          label="Profile photo"
          shape="round"
          value={avatar}
          disabled={!canWrite}
          onChange={setAvatar}
        />
        <Field label="Full name">
          <Input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
        </Field>
        <Field label="Phone">
          <Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
        <Field label="Job title" hint="For example: Graphic Designer, Accounts Executive">
          <Input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} />
        </Field>
        <Field label="Department">
          <Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
        </Field>
        <p className="text-xs text-slate-500">Email: {profile.email} (cannot be changed here).</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      </form>
    </Modal>
  );
}
