import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, type Tables } from "../../../lib/supabase";
import { useWorkspace } from "../../../lib/workspace";
import { useMembers, type Person } from "../../../lib/members";
import { Alert, Button, Card, Select, Spinner } from "../../../components/ui";
import { ago } from "./LeadTimeline";

type Member = Tables<"lead_assignment_members">;
type Form = { id: string; title: string; own_rotation: boolean; is_active: boolean };

const PASS_ON: [string, string][] = [
  ["", "Off"],
  ["15", "15 minutes"],
  ["30", "30 minutes"],
  ["60", "1 hour"],
  ["120", "2 hours"],
  ["240", "4 hours"],
];

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", staff: "Staff" };

export default function LeadAssignment() {
  const { workspace, isAdmin, canWrite, hasModule } = useWorkspace();
  const people = useMembers(workspace.id);
  const [settings, setSettings] = useState<{ auto_assign_enabled: boolean; auto_assign_manual: boolean; pass_on_minutes: number | null } | null>(null);
  const [draft, setDraft] = useState({ enabled: false, manual: false, passOn: "" });
  const [members, setMembers] = useState<Member[]>([]);
  const [forms, setForms] = useState<Form[]>([]);
  const [weekCounts, setWeekCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const readOnly = !canWrite || !isAdmin;

  const load = useCallback(async () => {
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const [s, m, f, l] = await Promise.all([
      supabase.from("workspace_settings").select("auto_assign_enabled, auto_assign_manual, pass_on_minutes").eq("workspace_id", workspace.id).maybeSingle(),
      supabase.from("lead_assignment_members").select("*").eq("workspace_id", workspace.id),
      supabase.from("lead_forms").select("id, title, own_rotation, is_active").eq("workspace_id", workspace.id).order("created_at"),
      supabase.from("leads").select("assigned_to").eq("workspace_id", workspace.id).gte("assigned_at", weekAgo).not("assigned_to", "is", null),
    ]);
    const err = s.error || m.error || f.error || l.error;
    if (err) setError(err.message);
    if (s.data) {
      setSettings(s.data);
      setDraft({ enabled: s.data.auto_assign_enabled, manual: s.data.auto_assign_manual, passOn: s.data.pass_on_minutes ? String(s.data.pass_on_minutes) : "" });
    }
    setMembers(m.data ?? []);
    setForms(f.data ?? []);
    const counts: Record<string, number> = {};
    for (const r of l.data ?? []) if (r.assigned_to) counts[r.assigned_to] = (counts[r.assigned_to] ?? 0) + 1;
    setWeekCounts(counts);
  }, [workspace.id]);

  useEffect(() => {
    load();
  }, [load]);

  const active = useMemo(() => people.filter((p) => p.is_active), [people]);
  const rowOf = (formId: string | null, userId: string) => members.find((m) => m.form_id === formId && m.user_id === userId);
  const awayOf = (userId: string) => members.some((m) => m.user_id === userId && m.is_away);
  const mainCount = active.filter((p) => rowOf(null, p.user_id)?.in_rotation).length;

  async function saveSettings() {
    setError("");
    setSaved(false);
    if (draft.enabled && mainCount === 0) return setError("Add at least one person to the rotation below first.");
    setBusy(true);
    const { error } = await supabase
      .from("workspace_settings")
      .update({ auto_assign_enabled: draft.enabled, auto_assign_manual: draft.manual, pass_on_minutes: draft.passOn ? Number(draft.passOn) : null })
      .eq("workspace_id", workspace.id);
    setBusy(false);
    if (error) return setError(error.message);
    setSaved(true);
    load();
  }

  // Puts a person in or out of a list (the main rotation when formId is null).
  async function setInRotation(formId: string | null, p: Person, on: boolean) {
    setError("");
    const row = rowOf(formId, p.user_id);
    const res = row
      ? await supabase.from("lead_assignment_members").update({ in_rotation: on }).eq("id", row.id).select().single()
      : await supabase
          .from("lead_assignment_members")
          .insert({ workspace_id: workspace.id, form_id: formId, user_id: p.user_id, in_rotation: on, is_away: awayOf(p.user_id), position: members.length })
          .select()
          .single();
    if (res.error) return setError(res.error.message);
    setMembers((ms) => [...ms.filter((m) => m.id !== res.data.id), res.data]);
  }

  async function setAway(p: Person, away: boolean) {
    setError("");
    const { data, error } = await supabase
      .from("lead_assignment_members")
      .update({ is_away: away })
      .eq("workspace_id", workspace.id)
      .eq("user_id", p.user_id)
      .select();
    if (error) return setError(error.message);
    const ids = new Set((data ?? []).map((d) => d.id));
    setMembers((ms) => [...ms.filter((m) => !ids.has(m.id)), ...(data ?? [])]);
  }

  async function setOwnRotation(f: Form, on: boolean) {
    setError("");
    const { error } = await supabase.from("lead_forms").update({ own_rotation: on }).eq("workspace_id", workspace.id).eq("id", f.id);
    if (error) return setError(error.message);
    setForms((fs) => fs.map((x) => (x.id === f.id ? { ...x, own_rotation: on } : x)));
  }

  if (!hasModule("leads") || !isAdmin) {
    return (
      <Card title="Lead assignment">
        <p className="text-sm text-slate-500">Only owners and admins can set up lead assignment.</p>
      </Card>
    );
  }
  if (!settings) return error ? <Alert>{error}</Alert> : <Spinner />;

  const dirty =
    draft.enabled !== settings.auto_assign_enabled ||
    draft.manual !== settings.auto_assign_manual ||
    (draft.passOn ? Number(draft.passOn) : null) !== settings.pass_on_minutes;

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold">Lead assignment</h1>
        <p className="text-sm text-slate-500">
          Share new leads out automatically, in turn, among the people you pick. The person who was given a lead longest ago goes next.
        </p>
      </div>

      {error && <Alert>{error}</Alert>}
      {saved && <Alert tone="success">Saved.</Alert>}

      <Card title="Automatic assignment">
        <fieldset disabled={readOnly || busy} className="space-y-4">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
            <span>
              <span className="font-medium text-slate-700">Assign new leads automatically</span>
              <span className="block text-xs text-slate-500">Every lead that comes in from a lead form goes to the next person in the rotation, who gets a bell notification.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={draft.manual} disabled={!draft.enabled} onChange={(e) => setDraft({ ...draft, manual: e.target.checked })} />
            <span>
              <span className="font-medium text-slate-700">Also leads an admin adds by hand with "Nobody yet" as the assignee</span>
              <span className="block text-xs text-slate-500">Leads added with a person picked keep that person.</span>
            </span>
          </label>
          <div className="max-w-md">
            <span className="mb-1 block text-sm font-medium text-slate-700">Pass a lead on if it isn't contacted within</span>
            <Select value={draft.passOn} disabled={!draft.enabled} onChange={(e) => setDraft({ ...draft, passOn: e.target.value })}>
              {PASS_ON.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
            <span className="mt-1 block text-xs text-slate-500">
              If the person hasn't logged a call, WhatsApp, meeting or remark in time, the lead moves to the next person and they're told.
              The clock only runs from 9 AM to 8 PM. After everyone has had it, admins are asked to assign it by hand.
            </span>
          </div>
          {!readOnly && (
            <div className="flex justify-end">
              <Button type="button" onClick={saveSettings} disabled={busy || !dirty}>{busy ? "Saving…" : "Save"}</Button>
            </div>
          )}
        </fieldset>
      </Card>

      <Card title="Who's in the rotation">
        <p className="mb-3 text-sm text-slate-500">
          Tick the people who should get new leads. Mark someone away when they're on leave; they're skipped and rejoin in turn when back. Staff can also switch themselves away on the Follow-ups page.
        </p>
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="px-5 py-2 font-medium">Gets leads</th>
                <th className="px-2 py-2 font-medium">Person</th>
                <th className="px-2 py-2 font-medium">Away</th>
                <th className="px-2 py-2 text-right font-medium">Leads, last 7 days</th>
                <th className="px-5 py-2 font-medium">Last given a lead</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {active.map((p) => {
                const row = rowOf(null, p.user_id);
                const on = !!row?.in_rotation;
                const away = awayOf(p.user_id);
                return (
                  <tr key={p.user_id} className={on ? "" : "text-slate-400"}>
                    <td className="px-5 py-2">
                      <input type="checkbox" aria-label={`${p.full_name} gets leads`} disabled={readOnly} checked={on} onChange={(e) => setInRotation(null, p, e.target.checked)} />
                    </td>
                    <td className="px-2 py-2">
                      <div className={`font-medium ${on ? "text-slate-900" : ""}`}>{p.full_name}</div>
                      <div className="text-xs">{ROLE_LABEL[p.role] ?? p.role}</div>
                    </td>
                    <td className="px-2 py-2">
                      {row ? (
                        <label className="inline-flex items-center gap-1.5 text-xs">
                          <input type="checkbox" disabled={readOnly} checked={away} onChange={(e) => setAway(p, e.target.checked)} />
                          {away ? <span className="font-medium text-amber-700">Away</span> : "Away"}
                        </label>
                      ) : (
                        <span className="text-xs">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right">{weekCounts[p.user_id] ?? 0}</td>
                    <td className="px-5 py-2 text-xs">{row?.last_assigned_at ? ago(row.last_assigned_at) : "Not yet"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {forms.length > 0 && (
        <Card title="Forms with their own staff list">
          <p className="mb-3 text-sm text-slate-500">
            Optional. Give a form its own list, for example a property form that should only go to the property team. Forms without one use the rotation above.
          </p>
          <div className="space-y-4">
            {forms.map((f) => {
              const listCount = active.filter((p) => rowOf(f.id, p.user_id)?.in_rotation).length;
              return (
                <div key={f.id} className="rounded-lg p-3 ring-1 ring-slate-200">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" disabled={readOnly} checked={f.own_rotation} onChange={(e) => setOwnRotation(f, e.target.checked)} />
                    <span className="font-medium text-slate-800">{f.title}</span>
                    {!f.is_active && <span className="text-xs text-slate-400">(form switched off)</span>}
                  </label>
                  {f.own_rotation && (
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 pl-6">
                      {active.map((p) => (
                        <label key={p.user_id} className="inline-flex items-center gap-1.5 text-sm">
                          <input type="checkbox" disabled={readOnly} checked={!!rowOf(f.id, p.user_id)?.in_rotation} onChange={(e) => setInRotation(f.id, p, e.target.checked)} />
                          {p.full_name}
                        </label>
                      ))}
                      {listCount === 0 && <p className="w-full text-xs text-amber-700">Nobody ticked yet, so this form still uses the main rotation.</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </>
  );
}
