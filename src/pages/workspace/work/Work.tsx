import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { useSearchParams } from "react-router";
import { supabase } from "../../../lib/supabase";
import { useAuth } from "../../../lib/auth";
import { useWorkspace } from "../../../lib/workspace";
import { useLiveTable } from "../../../lib/realtime";
import { useMembers } from "../../../lib/members";
import { date } from "../../../lib/format";
import { Alert, Badge, Button, Card, Empty, Input, Select, Spinner } from "../../../components/ui";
import { hours, localDay, TIMER_EVENT } from "../time/timeUtil";
import { ItemDrawer } from "./ItemDrawer";
import {
  checklistOf, dueState, PRIORITIES, PRIORITY_LABEL, PRIORITY_TONE, STATUSES, STATUS_LABEL, STATUS_TONE,
  type ClientOpt, type Priority, type Status, type WorkItem,
} from "./workTypes";

type View = "board" | "list";

export default function Work() {
  const { workspace, isAdmin, canWrite } = useWorkspace();
  const { session } = useAuth();
  const me = session?.user.id;
  const people = useMembers(workspace.id);
  const [params, setParams] = useSearchParams();

  const [items, setItems] = useState<WorkItem[] | null>(null);
  const [assign, setAssign] = useState<Record<string, string[]>>({});
  const [logged, setLogged] = useState<Record<string, number>>({});
  const [clients, setClients] = useState<ClientOpt[]>([]);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>(() => {
    try {
      return (localStorage.getItem("work-view") as View) || "board";
    } catch {
      return "board";
    }
  });
  const [filters, setFilters] = useState({ q: "", status: "", priority: "", client: "", assignee: "", due: "" });
  const [open, setOpen] = useState<WorkItem | "new" | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<Status | null>(null);

  const load = useCallback(async () => {
    const [w, a, c, t] = await Promise.all([
      supabase.from("work_items").select("*").eq("workspace_id", workspace.id).order("position").order("created_at"),
      supabase.from("work_item_assignees").select("work_item_id, user_id").eq("workspace_id", workspace.id),
      supabase.from("clients").select("id, company_name").eq("workspace_id", workspace.id).order("company_name"),
      supabase
        .from("time_entries")
        .select("work_item_id, duration_seconds")
        .eq("workspace_id", workspace.id)
        .not("work_item_id", "is", null)
        .not("stopped_at", "is", null),
    ]);
    if (w.error) setError(w.error.message);
    setItems(w.data ?? []);
    const am: Record<string, string[]> = {};
    for (const r of a.data ?? []) (am[r.work_item_id] ??= []).push(r.user_id);
    setAssign(am);
    setClients(c.data ?? []);
    const lm: Record<string, number> = {};
    for (const r of t.data ?? []) if (r.work_item_id) lm[r.work_item_id] = (lm[r.work_item_id] ?? 0) + (r.duration_seconds ?? 0);
    setLogged(lm);
  }, [workspace.id]);

  useEffect(() => {
    load();
    window.addEventListener(TIMER_EVENT, load);
    return () => window.removeEventListener(TIMER_EVENT, load);
  }, [load]);

  useLiveTable("work_items", `workspace_id=eq.${workspace.id}`, load);

  // Opening a work item from a notification or search (?open=<work item id>), or a new one (?new=1).
  const openId = params.get("open");
  const wantsNew = params.get("new") === "1";
  useEffect(() => {
    if ((!openId && !wantsNew) || !items) return;
    const it = openId ? items.find((x) => x.id === openId) : null;
    if (it) setOpen(it);
    else if (wantsNew && isAdmin && canWrite) setOpen("new");
    setParams((p) => {
      p.delete("open");
      p.delete("new");
      return p;
    }, { replace: true });
  }, [openId, wantsNew, items, isAdmin, canWrite, setParams]);

  function changeView(v: View) {
    setView(v);
    try {
      localStorage.setItem("work-view", v);
    } catch {
      /* ignore */
    }
  }

  const today = localDay();
  const clientName = useCallback((id: string | null) => clients.find((c) => c.id === id)?.company_name ?? "", [clients]);
  const canMove = (it: WorkItem) => canWrite && (isAdmin || (!!me && (assign[it.id] ?? []).includes(me)));

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return (items ?? []).filter((it) => {
      if (q && !it.title.toLowerCase().includes(q) && !clientName(it.client_id).toLowerCase().includes(q)) return false;
      if (filters.status && it.status !== filters.status) return false;
      if (filters.priority && it.priority !== filters.priority) return false;
      if (filters.client && (filters.client === "none" ? it.client_id : it.client_id !== filters.client)) return false;
      if (filters.assignee) {
        const who = assign[it.id] ?? [];
        if (filters.assignee === "none" ? who.length > 0 : !who.includes(filters.assignee)) return false;
      }
      if (filters.due) {
        const d = dueState(it, today);
        if (filters.due === "overdue" && d !== "overdue") return false;
        if (filters.due === "soon" && !d) return false;
      }
      return true;
    });
  }, [items, filters, assign, clientName, today]);

  async function drop(status: Status, beforeId: string | null) {
    const id = dragId;
    setDragId(null);
    setOverCol(null);
    if (!id || !items || id === beforeId) return;
    const moving = items.find((x) => x.id === id);
    if (!moving || !canMove(moving)) return;
    setError("");

    // New order of the target column (all items, not just the filtered ones).
    const col = items.filter((x) => x.status === status && x.id !== id);
    let idx = beforeId ? col.findIndex((x) => x.id === beforeId) : col.length;
    if (idx < 0) idx = col.length;
    const prev = col[idx - 1];
    const next = col[idx];

    let updates: { id: string; position: number }[];
    let pos: number;
    if (!prev && !next) pos = 1000;
    else if (!prev) pos = next.position - 1000;
    else if (!next) pos = prev.position + 1000;
    else pos = Math.floor((prev.position + next.position) / 2);

    const roomy = (!prev || pos > prev.position) && (!next || pos < next.position);
    if (roomy || !isAdmin) {
      updates = [{ id, position: pos }];
    } else {
      // No gap left: admins renumber the whole column.
      const ordered = [...col.slice(0, idx), moving, ...col.slice(idx)];
      updates = ordered.map((x, i) => ({ id: x.id, position: (i + 1) * 1000 })).filter((u) => {
        const cur = items.find((x) => x.id === u.id);
        return u.id === id || cur?.position !== u.position;
      });
      pos = updates.find((u) => u.id === id)!.position;
    }

    // Optimistic update.
    setItems((list) =>
      (list ?? [])
        .map((x) => {
          const u = updates.find((y) => y.id === x.id);
          return x.id === id ? { ...x, status, position: pos } : u ? { ...x, position: u.position } : x;
        })
        .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at)),
    );

    for (const u of updates) {
      const patch = u.id === id ? { status, position: u.position } : { position: u.position };
      const { error } = await supabase.from("work_items").update(patch).eq("workspace_id", workspace.id).eq("id", u.id);
      if (error) {
        setError(error.message);
        break;
      }
    }
    load();
  }

  if (!items) return <Spinner />;

  const setFilter = (k: keyof typeof filters, v: string) => setFilters((f) => ({ ...f, [k]: v }));
  const anyFilter = Object.values(filters).some(Boolean);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Work items</h1>
        <div className="flex gap-2">
          <div className="inline-flex overflow-hidden rounded-md ring-1 ring-slate-300">
            {(["board", "list"] as View[]).map((v) => (
              <button
                key={v}
                className={`px-3 py-1.5 text-sm ${view === v ? "bg-indigo-600 text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`}
                onClick={() => changeView(v)}
              >
                {v === "board" ? "Board" : "List"}
              </button>
            ))}
          </div>
          {isAdmin && canWrite && <Button onClick={() => setOpen("new")}>+ New work item</Button>}
        </div>
      </div>

      {error && <Alert>{error}</Alert>}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Input className="col-span-2 sm:col-span-1" placeholder="Search" value={filters.q} onChange={(e) => setFilter("q", e.target.value)} />
        {view === "list" && (
          <Select value={filters.status} onChange={(e) => setFilter("status", e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        )}
        <Select value={filters.priority} onChange={(e) => setFilter("priority", e.target.value)} aria-label="Priority">
          <option value="">All priorities</option>
          {PRIORITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <Select value={filters.client} onChange={(e) => setFilter("client", e.target.value)} aria-label="Client">
          <option value="">All clients</option>
          <option value="none">No client</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
        </Select>
        <Select value={filters.assignee} onChange={(e) => setFilter("assignee", e.target.value)} aria-label="Assigned to">
          <option value="">Anyone</option>
          {me && <option value={me}>Me</option>}
          <option value="none">Not assigned</option>
          {people.filter((p) => p.user_id !== me).map((p) => <option key={p.user_id} value={p.user_id}>{p.full_name}</option>)}
        </Select>
        <Select value={filters.due} onChange={(e) => setFilter("due", e.target.value)} aria-label="Due">
          <option value="">Any due date</option>
          <option value="soon">Due soon or overdue</option>
          <option value="overdue">Overdue</option>
        </Select>
      </div>
      {anyFilter && (
        <button className="text-sm text-indigo-600 hover:underline" onClick={() => setFilters({ q: "", status: "", priority: "", client: "", assignee: "", due: "" })}>
          Clear filters
        </button>
      )}

      {items.length === 0 ? (
        <Card>
          <Empty>
            {isAdmin ? "No work items yet. Create one to start planning your team's work." : "Nothing is assigned to you yet."}
          </Empty>
        </Card>
      ) : view === "board" ? (
        <div className="-mx-4 overflow-x-auto px-4 pb-2">
          <div className="grid min-w-[880px] grid-cols-4 gap-3">
            {STATUSES.map(([status, label]) => {
              const col = filtered.filter((x) => x.status === status);
              return (
                <div
                  key={status}
                  className={`flex min-h-48 flex-col rounded-lg p-2 ${overCol === status ? "bg-indigo-50 ring-2 ring-indigo-300" : "bg-slate-100"}`}
                  onDragOver={(e) => {
                    if (!dragId) return;
                    e.preventDefault();
                    setOverCol(status);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverCol(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    drop(status, null);
                  }}
                >
                  <div className="mb-2 flex items-center justify-between px-1">
                    <span className="text-sm font-semibold text-slate-700">{label}</span>
                    <span className="text-xs text-slate-500">{col.length}</span>
                  </div>
                  <div className="flex flex-1 flex-col gap-2">
                    {col.map((it) => (
                      <ItemCard
                        key={it.id}
                        item={it}
                        client={clientName(it.client_id)}
                        assignees={(assign[it.id] ?? []).map((u) => people.find((p) => p.user_id === u)?.full_name ?? "").filter(Boolean)}
                        logged={logged[it.id] ?? 0}
                        today={today}
                        draggable={canMove(it)}
                        dragging={dragId === it.id}
                        onOpen={() => setOpen(it)}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", it.id);
                          setDragId(it.id);
                        }}
                        onDragEnd={() => {
                          setDragId(null);
                          setOverCol(null);
                        }}
                        onDropBefore={() => drop(status, it.id)}
                      />
                    ))}
                    {col.length === 0 && <p className="py-4 text-center text-xs text-slate-400">Nothing here</p>}
                  </div>
                </div>
              );
            })}
          </div>
          {canWrite && <p className="mt-2 text-xs text-slate-500">Drag cards between columns to change their stage.</p>}
        </div>
      ) : (
        <Card>
          {filtered.length === 0 ? (
            <Empty>No work items match these filters.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-slate-500">
                  <tr>
                    <th className="py-2 pr-3">Title</th>
                    <th className="pr-3">Client</th>
                    <th className="pr-3">Status</th>
                    <th className="pr-3">Priority</th>
                    <th className="pr-3">Assigned to</th>
                    <th className="pr-3">Due</th>
                    <th className="pr-3 text-right">Hours</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((it) => {
                    const d = dueState(it, today);
                    return (
                      <tr key={it.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(it)}>
                        <td className="py-2 pr-3 font-medium">{it.title}</td>
                        <td className="pr-3">{clientName(it.client_id)}</td>
                        <td className="pr-3"><Badge tone={STATUS_TONE[it.status as Status]}>{STATUS_LABEL[it.status as Status]}</Badge></td>
                        <td className="pr-3"><Badge tone={PRIORITY_TONE[it.priority as Priority]}>{PRIORITY_LABEL[it.priority as Priority]}</Badge></td>
                        <td className="pr-3">{(assign[it.id] ?? []).map((u) => people.find((p) => p.user_id === u)?.full_name).filter(Boolean).join(", ")}</td>
                        <td className={`whitespace-nowrap pr-3 ${d === "overdue" ? "font-medium text-red-600" : d === "soon" ? "text-amber-700" : ""}`}>
                          {date(it.due_date)}
                        </td>
                        <td className="whitespace-nowrap pr-3 text-right">
                          {hours(logged[it.id] ?? 0, 1)}
                          {it.estimated_hours != null && <span className="text-slate-400"> / {Number(it.estimated_hours)} h</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {open && (
        <ItemDrawer
          key={open === "new" ? "new" : open.id}
          item={open === "new" ? null : open}
          assignees={open === "new" ? [] : assign[open.id] ?? []}
          loggedSeconds={open === "new" ? 0 : logged[open.id] ?? 0}
          clients={clients}
          people={people}
          me={me}
          onClose={() => setOpen(null)}
          onSaved={load}
        />
      )}
    </>
  );
}

function ItemCard(props: {
  item: WorkItem;
  client: string;
  assignees: string[];
  logged: number;
  today: string;
  draggable: boolean;
  dragging: boolean;
  onOpen: () => void;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
  onDropBefore: () => void;
}) {
  const { item: it, client, assignees, logged, today } = props;
  const [over, setOver] = useState(false);
  const checklist = checklistOf(it);
  const done = checklist.filter((c) => c.done).length;
  const d = dueState(it, today);
  return (
    <div
      draggable={props.draggable}
      onDragStart={props.onDragStart}
      onDragEnd={props.onDragEnd}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        props.onDropBefore();
      }}
      onClick={props.onOpen}
      className={`cursor-pointer rounded-md bg-white p-3 text-sm shadow-sm ring-1 ring-slate-200 hover:ring-indigo-300 ${
        props.dragging ? "opacity-40" : ""
      } ${over ? "border-t-4 border-indigo-400" : ""} ${props.draggable ? "active:cursor-grabbing" : ""}`}
    >
      <div className="mb-1 flex items-start justify-between gap-2">
        <span className="font-medium leading-snug">{it.title}</span>
        <Badge tone={PRIORITY_TONE[it.priority as Priority]}>{PRIORITY_LABEL[it.priority as Priority]}</Badge>
      </div>
      {client && <div className="truncate text-xs text-slate-500">{client}</div>}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        {it.due_date && (
          <span className={d === "overdue" ? "font-medium text-red-600" : d === "soon" ? "text-amber-700" : ""}>
            {d === "overdue" ? "Overdue · " : "Due "}
            {date(it.due_date)}
          </span>
        )}
        {checklist.length > 0 && <span>☑ {done}/{checklist.length}</span>}
        {(logged > 0 || it.estimated_hours != null) && (
          <span>
            ⏱ {hours(logged, 1)}
            {it.estimated_hours != null && ` / ${Number(it.estimated_hours)} h`}
          </span>
        )}
      </div>
      {assignees.length > 0 && <div className="mt-1 truncate text-xs text-slate-600">{assignees.join(", ")}</div>}
    </div>
  );
}
