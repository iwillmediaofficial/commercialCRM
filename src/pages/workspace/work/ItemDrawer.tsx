import { useState } from "react";
import { supabase } from "../../../lib/supabase";
import { useWorkspace } from "../../../lib/workspace";
import type { Person } from "../../../lib/members";
import { date, inr } from "../../../lib/format";
import { Alert, Badge, Button, Drawer, Field, Input, Select, Textarea } from "../../../components/ui";
import { announceTimerChange, hours } from "../time/timeUtil";
import {
  checklistOf, PRIORITIES, PRIORITY_LABEL, PRIORITY_TONE, STATUSES, STATUS_LABEL,
  type CheckItem, type ClientOpt, type Priority, type Status, type WorkItem,
} from "./workTypes";

type Props = {
  item: WorkItem | null; // null = new item
  assignees: string[];
  loggedSeconds: number;
  clients: ClientOpt[];
  people: Person[];
  me: string | undefined;
  onClose: () => void;
  onSaved: () => void;
};

export function ItemDrawer({ item, assignees, loggedSeconds, clients, people, me, onClose, onSaved }: Props) {
  const { workspace, isAdmin, canWrite, role } = useWorkspace();
  // Set once a new item's row is inserted, so a retry after a later failure updates it instead of inserting again.
  const [createdId, setCreatedId] = useState<string | null>(null);
  const isNew = !item;
  const fullEdit = canWrite && isAdmin; // admins edit everything
  const assignedToMe = !!me && assignees.includes(me);
  const staffEdit = canWrite && !isAdmin && assignedToMe; // status + checklist only
  const canEdit = fullEdit || staffEdit;

  const [f, setF] = useState({
    title: item?.title ?? "",
    description: item?.description ?? "",
    client_id: item?.client_id ?? "",
    status: (item?.status ?? "backlog") as Status,
    priority: (item?.priority ?? "medium") as Priority,
    start_date: item?.start_date ?? "",
    due_date: item?.due_date ?? "",
    estimated_hours: item?.estimated_hours?.toString() ?? "",
    is_billable: item?.is_billable ?? false,
    billable_amount: item?.billable_amount?.toString() ?? "",
  });
  const [checklist, setChecklist] = useState<CheckItem[]>(checklistOf(item));
  const [newCheck, setNewCheck] = useState("");
  const [who, setWho] = useState<string[]>(assignees);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function save() {
    setError("");
    if (fullEdit && !f.title.trim()) return setError("Please give the work item a title.");
    setBusy(true);
    const checklistJson = checklist as unknown as WorkItem["checklist"];
    let id = item?.id ?? createdId ?? undefined;
    const inserting = isNew && !createdId;
    if (fullEdit) {
      const row = {
        title: f.title.trim(),
        description: f.description.trim() || null,
        client_id: f.client_id || null,
        status: f.status,
        priority: f.priority,
        start_date: f.start_date || null,
        due_date: f.due_date || null,
        estimated_hours: f.estimated_hours === "" ? null : Number(f.estimated_hours),
        is_billable: f.is_billable,
        billable_amount: f.is_billable && f.billable_amount !== "" ? Number(f.billable_amount) : null,
        checklist: checklistJson,
      };
      if (inserting) {
        const { data, error } = await supabase
          .from("work_items")
          .insert({ ...row, workspace_id: workspace.id, created_by: me })
          .select("id")
          .single();
        if (error) return fail(error.message);
        id = data.id;
        setCreatedId(data.id);
      } else {
        const { error } = await supabase.from("work_items").update(row).eq("workspace_id", workspace.id).eq("id", id!);
        if (error) return fail(error.message);
      }
      // Sync assignees.
      const add = who.filter((u) => !assignees.includes(u) || isNew);
      const remove = isNew ? [] : assignees.filter((u) => !who.includes(u));
      if (add.length) {
        const { error } = await supabase
          .from("work_item_assignees")
          .insert(add.map((user_id) => ({ work_item_id: id!, user_id, workspace_id: workspace.id, assigned_by: me })));
        if (error) return fail(error.message);
      }
      if (remove.length) {
        const { error } = await supabase
          .from("work_item_assignees")
          .delete()
          .eq("workspace_id", workspace.id)
          .eq("work_item_id", id!)
          .in("user_id", remove);
        if (error) return fail(error.message);
      }
    } else if (staffEdit && item) {
      const { error } = await supabase
        .from("work_items")
        .update({ status: f.status, checklist: checklistJson })
        .eq("workspace_id", workspace.id)
        .eq("id", item.id);
      if (error) return fail(error.message);
    }
    setBusy(false);
    onSaved();
    onClose();
  }

  function fail(msg: string) {
    setBusy(false);
    setError(msg);
  }

  async function remove() {
    if (!item || !confirm(`Delete "${item.title}"? Its time entries stay but lose the link.`)) return;
    setBusy(true);
    const { error } = await supabase.from("work_items").delete().eq("workspace_id", workspace.id).eq("id", item.id);
    if (error) return fail(error.message);
    setBusy(false);
    onSaved();
    onClose();
  }

  async function startTimer() {
    if (!item) return;
    setError("");
    setInfo("");
    const { error } = await supabase.rpc("start_timer", { p_workspace_id: workspace.id, p_work_item_id: item.id });
    if (error) return setError(error.message);
    // start_timer moves a backlog item to in progress; keep the form in step so Save doesn't undo it.
    setF((x) => (x.status === "backlog" ? { ...x, status: "in_progress" } : x));
    setInfo("Timer started. You can stop it from the bar at the top.");
    announceTimerChange();
    onSaved();
  }

  function addCheck() {
    const text = newCheck.trim();
    if (!text) return;
    setChecklist((c) => [...c, { id: crypto.randomUUID(), text, done: false }]);
    setNewCheck("");
  }

  const est = Number(f.estimated_hours || 0);
  const loggedH = loggedSeconds / 3600;
  const pct = est > 0 ? Math.min(100, (loggedH / est) * 100) : 0;
  const doneCount = checklist.filter((c) => c.done).length;
  const clientName = clients.find((c) => c.id === f.client_id)?.company_name;
  const activePeople = people.filter((p) => p.is_active || who.includes(p.user_id));

  return (
    <Drawer title={isNew ? "New work item" : fullEdit ? "Edit work item" : item.title} onClose={onClose}>
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        {info && <Alert tone="success">{info}</Alert>}
        {staffEdit && <Alert tone="info">You can change the status and checklist of this item. Other details are set by an admin.</Alert>}

        {fullEdit ? (
          <>
            <Field label="Title">
              <Input value={f.title} onChange={(e) => set("title", e.target.value)} autoFocus={isNew} />
            </Field>
            <Field label="Description">
              <Textarea rows={4} value={f.description} onChange={(e) => set("description", e.target.value)} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Client">
                <Select value={f.client_id} onChange={(e) => set("client_id", e.target.value)}>
                  <option value="">No client</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.company_name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Priority">
                <Select value={f.priority} onChange={(e) => set("priority", e.target.value as Priority)}>
                  {PRIORITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </Field>
              <Field label="Status">
                <Select value={f.status} onChange={(e) => set("status", e.target.value as Status)}>
                  {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </Field>
              <Field label="Estimated hours">
                <Input type="number" min="0" step="0.25" value={f.estimated_hours} onChange={(e) => set("estimated_hours", e.target.value)} />
              </Field>
              <Field label="Start date">
                <Input type="date" value={f.start_date} onChange={(e) => set("start_date", e.target.value)} />
              </Field>
              <Field label="Due date">
                <Input type="date" value={f.due_date} onChange={(e) => set("due_date", e.target.value)} />
              </Field>
            </div>
            <div className="grid items-end gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={f.is_billable} onChange={(e) => set("is_billable", e.target.checked)} />
                Billable to the client
              </label>
              {f.is_billable && (
                <Field label="Billable amount (₹)">
                  <Input type="number" min="0" step="0.01" value={f.billable_amount} onChange={(e) => set("billable_amount", e.target.value)} />
                </Field>
              )}
            </div>
            <div>
              <span className="mb-1 block text-sm font-medium text-slate-700">Assigned to</span>
              <div className="flex flex-wrap gap-2">
                {activePeople.map((p) => (
                  <label key={p.user_id} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm ring-1 ring-slate-200">
                    <input
                      type="checkbox"
                      checked={who.includes(p.user_id)}
                      onChange={(e) => setWho((w) => (e.target.checked ? [...w, p.user_id] : w.filter((x) => x !== p.user_id)))}
                    />
                    {p.full_name}
                  </label>
                ))}
                {activePeople.length === 0 && <span className="text-sm text-slate-500">No team members yet.</span>}
              </div>
            </div>
          </>
        ) : (
          item && (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge tone={PRIORITY_TONE[item.priority as Priority]}>{PRIORITY_LABEL[item.priority as Priority]} priority</Badge>
                {item.is_billable && <Badge tone="bg-emerald-100 text-emerald-800">Billable{item.billable_amount != null ? ` · ${inr(item.billable_amount)}` : ""}</Badge>}
              </div>
              {item.description && <p className="whitespace-pre-wrap text-sm text-slate-700">{item.description}</p>}
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <Info label="Client" value={clientName || "No client"} />
                <Info label="Assigned to" value={assignees.map((u) => people.find((p) => p.user_id === u)?.full_name).filter(Boolean).join(", ") || "Nobody"} />
                <Info label="Start date" value={date(item.start_date) || "Not set"} />
                <Info label="Due date" value={date(item.due_date) || "Not set"} />
              </dl>
              <Field label="Status">
                <Select value={f.status} disabled={!staffEdit} onChange={(e) => set("status", e.target.value as Status)}>
                  {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </Field>
            </>
          )
        )}

        {!isNew && (
          <div className="rounded-md bg-slate-50 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-medium">{hours(loggedSeconds)}</span> logged
                {est > 0 && <> of {hours(est * 3600)} estimated</>}
                {role && !isAdmin && <span className="text-xs text-slate-500"> (your time)</span>}
              </div>
              {canWrite && role && (
                <Button variant="secondary" className="!py-1" onClick={startTimer}>▶ Start timer</Button>
              )}
            </div>
            {est > 0 && (
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                <div className={`h-full ${loggedH > est ? "bg-red-500" : "bg-indigo-500"}`} style={{ width: `${pct}%` }} />
              </div>
            )}
          </div>
        )}

        <div>
          <span className="mb-1 block text-sm font-medium text-slate-700">
            Checklist {checklist.length > 0 && <span className="font-normal text-slate-500">({doneCount} of {checklist.length} done)</span>}
          </span>
          <ul className="space-y-1">
            {checklist.map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={c.done}
                  disabled={!canEdit}
                  onChange={(e) => setChecklist((l) => l.map((x) => (x.id === c.id ? { ...x, done: e.target.checked } : x)))}
                />
                <span className={`flex-1 ${c.done ? "text-slate-400 line-through" : ""}`}>{c.text}</span>
                {canEdit && (
                  <button className="text-xs text-slate-400 hover:text-red-600" aria-label="Remove" onClick={() => setChecklist((l) => l.filter((x) => x.id !== c.id))}>
                    ✕
                  </button>
                )}
              </li>
            ))}
            {checklist.length === 0 && !canEdit && <li className="text-sm text-slate-500">No checklist.</li>}
          </ul>
          {canEdit && (
            <div className="mt-2 flex gap-2">
              <Input
                placeholder="Add a checklist step"
                value={newCheck}
                onChange={(e) => setNewCheck(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCheck();
                  }
                }}
              />
              <Button variant="secondary" onClick={addCheck}>Add</Button>
            </div>
          )}
        </div>

        <div>
          <span className="mb-1 block text-sm font-medium text-slate-700">Attachments</span>
          <p className="text-xs text-slate-500">File uploads arrive with file storage.</p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4">
          <div>
            {fullEdit && !isNew && (
              <Button variant="danger" disabled={busy} onClick={remove}>Delete</Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>{canEdit ? "Cancel" : "Close"}</Button>
            {canEdit && <Button disabled={busy} onClick={save}>{isNew ? "Create" : "Save"}</Button>}
          </div>
        </div>
        {!isNew && item && (
          <p className="text-xs text-slate-400">
            Status: {STATUS_LABEL[item.status as Status]}
            {item.completed_at ? ` · completed ${date(item.completed_at)}` : ""} · created {date(item.created_at)}
          </p>
        )}
      </div>
    </Drawer>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
