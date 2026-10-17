import { useState } from "react";
import { supabase, type Tables } from "../../../lib/supabase";
import { useWorkspace } from "../../../lib/workspace";
import type { Person } from "../../../lib/members";
import { Alert, Button, Field, Input, Modal, Select, Textarea } from "../../../components/ui";
import { hours, toLocalInput } from "./timeUtil";

type Opt = { id: string; label: string; client_id?: string | null };

// Admins (and staff, when the company allows it): add a manual time entry or fix an existing one.
export function EntryModal({ entry, people, items, clients, me, onClose, onSaved }: {
  entry: Tables<"time_entries"> | null;
  people: Person[];
  items: Opt[];
  clients: Opt[];
  me: string | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { workspace } = useWorkspace();
  const [f, setF] = useState({
    user_id: entry?.user_id ?? me ?? "",
    work_item_id: entry?.work_item_id ?? "",
    client_id: entry?.client_id ?? "",
    started_at: toLocalInput(entry?.started_at ?? new Date(Date.now() - 3600_000).toISOString()),
    stopped_at: entry ? toLocalInput(entry.stopped_at) : toLocalInput(new Date().toISOString()),
    is_billable: entry?.is_billable ?? true,
    notes: entry?.notes ?? "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const start = f.started_at ? new Date(f.started_at) : null;
  const stop = f.stopped_at ? new Date(f.stopped_at) : null;
  const secs = start && stop ? (stop.getTime() - start.getTime()) / 1000 : null;

  async function save() {
    setError("");
    if (!f.user_id) return setError("Choose who this time is for.");
    if (!start) return setError("Enter when the work started.");
    if (!stop && !entry) return setError("Enter when the work ended.");
    if (secs !== null && secs < 0) return setError("The end time must be after the start time.");
    setBusy(true);
    const row = {
      user_id: f.user_id,
      work_item_id: f.work_item_id || null,
      client_id: f.client_id || null,
      started_at: start.toISOString(),
      stopped_at: stop ? stop.toISOString() : null,
      is_billable: f.is_billable,
      notes: f.notes.trim() || null,
    };
    const { error } = entry
      ? await supabase.from("time_entries").update(row).eq("workspace_id", workspace.id).eq("id", entry.id)
      : await supabase.from("time_entries").insert({ ...row, workspace_id: workspace.id });
    setBusy(false);
    if (error) return setError(error.message);
    onSaved();
    onClose();
  }

  return (
    <Modal title={entry ? "Edit time entry" : "Add time entry"} onClose={onClose}>
      <div className="space-y-3">
        {error && <Alert>{error}</Alert>}
        <Field label="Person">
          <Select value={f.user_id} onChange={(e) => set("user_id", e.target.value)} disabled={!!entry}>
            <option value="">Choose…</option>
            {people.map((p) => <option key={p.user_id} value={p.user_id}>{p.full_name}</option>)}
          </Select>
        </Field>
        <Field label="Work item">
          <Select
            value={f.work_item_id}
            onChange={(e) => {
              const it = items.find((x) => x.id === e.target.value);
              setF((x) => ({ ...x, work_item_id: e.target.value, client_id: it ? it.client_id ?? "" : x.client_id }));
            }}
          >
            <option value="">No work item</option>
            {items.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
          </Select>
        </Field>
        <Field label="Client">
          <Select value={f.client_id} onChange={(e) => set("client_id", e.target.value)}>
            <option value="">No client</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Started">
            <Input type="datetime-local" value={f.started_at} onChange={(e) => set("started_at", e.target.value)} />
          </Field>
          <Field label="Ended" hint={entry && !f.stopped_at ? "Leave empty to keep the timer running." : undefined}>
            <Input type="datetime-local" value={f.stopped_at} onChange={(e) => set("stopped_at", e.target.value)} />
          </Field>
        </div>
        {secs !== null && secs >= 0 && <p className="text-sm text-slate-600">Length: <b>{hours(secs)}</b></p>}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.is_billable} onChange={(e) => set("is_billable", e.target.checked)} />
          Billable time
        </label>
        <Field label="Notes">
          <Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={save}>{entry ? "Save" : "Add entry"}</Button>
        </div>
      </div>
    </Modal>
  );
}
