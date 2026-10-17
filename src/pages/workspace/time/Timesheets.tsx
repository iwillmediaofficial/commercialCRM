import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, type Tables } from "../../../lib/supabase";
import { useAuth } from "../../../lib/auth";
import { useWorkspace } from "../../../lib/workspace";
import { nameOf, useMembers } from "../../../lib/members";
import { date, downloadCsv } from "../../../lib/format";
import { Alert, Badge, Button, Card, Empty, Field, Input, Select, Spinner } from "../../../components/ui";
import { dateTime, hours, localDay, secondsOf, TIMER_EVENT } from "./timeUtil";
import { LiveMonitor } from "./LiveMonitor";
import { EntryModal } from "./EntryModal";

export type Entry = Tables<"time_entries">;
type Opt = { id: string; label: string; client_id?: string | null };

const LIMIT = 2000;

export default function Timesheets() {
  const { workspace, isAdmin, canWrite, role } = useWorkspace();
  const { session } = useAuth();
  const me = session?.user.id;
  const seeAll = isAdmin || role === null; // admins and the Super Admin support view
  const people = useMembers(workspace.id);

  const monthStart = useMemo(() => {
    const d = new Date();
    return localDay(new Date(d.getFullYear(), d.getMonth(), 1));
  }, []);
  const [filters, setFilters] = useState({ person: "", client: "", item: "", from: monthStart, to: localDay() });
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [clients, setClients] = useState<Opt[]>([]);
  const [items, setItems] = useState<Opt[]>([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Entry | "new" | null>(null);
  const [now, setNow] = useState(Date.now());
  const [staffManual, setStaffManual] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from("clients").select("id, company_name").eq("workspace_id", workspace.id).order("company_name"),
      supabase.from("work_items").select("id, title, client_id").eq("workspace_id", workspace.id).order("title"),
      supabase.from("workspace_settings").select("staff_manual_time").eq("workspace_id", workspace.id).maybeSingle(),
    ]).then(([c, w, s]) => {
      setStaffManual(!!s.data?.staff_manual_time);
      setClients((c.data ?? []).map((x) => ({ id: x.id, label: x.company_name })));
      setItems((w.data ?? []).map((x) => ({ id: x.id, label: x.title, client_id: x.client_id })));
    });
  }, [workspace.id]);

  const load = useCallback(async () => {
    let q = supabase.from("time_entries").select("*").eq("workspace_id", workspace.id);
    if (filters.person) q = q.eq("user_id", filters.person);
    if (filters.client === "none") q = q.is("client_id", null);
    else if (filters.client) q = q.eq("client_id", filters.client);
    if (filters.item === "none") q = q.is("work_item_id", null);
    else if (filters.item) q = q.eq("work_item_id", filters.item);
    if (filters.from) q = q.gte("started_at", new Date(`${filters.from}T00:00:00`).toISOString());
    if (filters.to) {
      const end = new Date(`${filters.to}T00:00:00`);
      end.setDate(end.getDate() + 1);
      q = q.lt("started_at", end.toISOString());
    }
    const { data, error } = await q.order("started_at", { ascending: false }).limit(LIMIT);
    if (error) setError(error.message);
    setEntries(data ?? []);
    setNow(Date.now());
  }, [workspace.id, filters]);

  useEffect(() => {
    load();
    window.addEventListener(TIMER_EVENT, load);
    return () => window.removeEventListener(TIMER_EVENT, load);
  }, [load]);

  const label = (list: Opt[], id: string | null) => (id ? list.find((x) => x.id === id)?.label ?? "" : "");
  const personName = (id: string) => nameOf(people, id) || (id === me ? "You" : "Member");

  const totals = useMemo(() => {
    let all = 0;
    let billable = 0;
    const byPerson: Record<string, number> = {};
    for (const e of entries ?? []) {
      if (!e.stopped_at) continue;
      const s = e.duration_seconds ?? 0;
      all += s;
      if (e.is_billable) billable += s;
      byPerson[e.user_id] = (byPerson[e.user_id] ?? 0) + s;
    }
    return { all, billable, byPerson };
  }, [entries]);

  function exportCsv() {
    if (!entries) return;
    downloadCsv(
      `timesheet-${filters.from || "start"}-to-${filters.to || "today"}.csv`,
      ["Person", "Date", "Start", "End", "Hours", "Work item", "Client", "Billable", "Notes"],
      entries.map((e) => [
        personName(e.user_id),
        date(e.started_at),
        new Date(e.started_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
        e.stopped_at ? new Date(e.stopped_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "Running",
        e.stopped_at ? ((e.duration_seconds ?? 0) / 3600).toFixed(2) : "",
        label(items, e.work_item_id),
        label(clients, e.client_id),
        e.is_billable ? "Yes" : "No",
        e.notes ?? "",
      ]),
    );
  }

  async function remove(e: Entry) {
    if (!confirm(`Delete this ${hours(secondsOf(e), 2)} entry for ${personName(e.user_id)}?`)) return;
    setError("");
    const { error } = await supabase.from("time_entries").delete().eq("workspace_id", workspace.id).eq("id", e.id);
    if (error) setError(error.message);
    load();
  }

  const setFilter = (k: keyof typeof filters, v: string) => setFilters((f) => ({ ...f, [k]: v }));
  const adminWrite = isAdmin && canWrite;
  // Staff add or fix their own time by hand only when the company allows it.
  const ownWrite = adminWrite || (canWrite && staffManual);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Time</h1>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={!entries?.length} onClick={exportCsv}>Export CSV</Button>
          {ownWrite && <Button onClick={() => setEditing("new")}>+ Add entry</Button>}
        </div>
      </div>

      {seeAll && <LiveMonitor people={people} items={items} clients={clients} />}

      {error && <Alert>{error}</Alert>}

      <Card title={seeAll ? "Time ledger" : "My time"}>
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {seeAll && (
            <Field label="Person">
              <Select value={filters.person} onChange={(e) => setFilter("person", e.target.value)}>
                <option value="">Everyone</option>
                {people.map((p) => <option key={p.user_id} value={p.user_id}>{p.full_name}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Client">
            <Select value={filters.client} onChange={(e) => setFilter("client", e.target.value)}>
              <option value="">All clients</option>
              <option value="none">No client</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </Select>
          </Field>
          <Field label="Work item">
            <Select value={filters.item} onChange={(e) => setFilter("item", e.target.value)}>
              <option value="">All work</option>
              <option value="none">No work item</option>
              {items.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </Select>
          </Field>
          <Field label="From">
            <Input type="date" value={filters.from} onChange={(e) => setFilter("from", e.target.value)} />
          </Field>
          <Field label="To">
            <Input type="date" value={filters.to} onChange={(e) => setFilter("to", e.target.value)} />
          </Field>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-2 text-center">
          <Stat label="Total" value={hours(totals.all)} />
          <Stat label="Billable" value={hours(totals.billable)} />
          <Stat label="Entries" value={String(entries?.length ?? 0)} />
        </div>

        {seeAll && Object.keys(totals.byPerson).length > 1 && (
          <div className="mb-4 flex flex-wrap gap-2 text-xs">
            {Object.entries(totals.byPerson)
              .sort((a, b) => b[1] - a[1])
              .map(([u, s]) => (
                <span key={u} className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">
                  {personName(u)}: <b>{hours(s, 1)}</b>
                </span>
              ))}
          </div>
        )}

        {!entries ? (
          <Spinner />
        ) : entries.length === 0 ? (
          <Empty>No time logged for these filters. Start a timer from the bar at the top of the page.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  {seeAll && <th className="py-2 pr-3">Person</th>}
                  <th className="py-2 pr-3">When</th>
                  <th className="pr-3">Work</th>
                  <th className="pr-3 text-right">Hours</th>
                  <th className="pr-3">Notes</th>
                  {ownWrite && <th></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.map((e) => (
                  <tr key={e.id} className="align-top">
                    {seeAll && <td className="py-2 pr-3 font-medium">{personName(e.user_id)}</td>}
                    <td className="whitespace-nowrap py-2 pr-3">
                      {dateTime(e.started_at)}
                      <div className="text-xs text-slate-500">
                        to {e.stopped_at ? new Date(e.stopped_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "now"}
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      {label(items, e.work_item_id) || <span className="text-slate-400">General</span>}
                      {e.client_id && <div className="text-xs text-slate-500">{label(clients, e.client_id)}</div>}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right">
                      {e.stopped_at ? hours(e.duration_seconds ?? 0) : <Badge tone="bg-green-100 text-green-800">Running · {hours(secondsOf(e, now), 1)}</Badge>}
                      {!e.is_billable && <div className="text-xs text-slate-400">Not billable</div>}
                    </td>
                    <td className="max-w-xs py-2 pr-3 text-slate-600">{e.notes}</td>
                    {ownWrite && (
                      <td className="whitespace-nowrap py-2 text-right">
                        {(adminWrite || e.user_id === me) && (
                          <button className="text-xs text-indigo-600 hover:underline" onClick={() => setEditing(e)}>Edit</button>
                        )}
                        {adminWrite && <button className="ml-3 text-xs text-red-600 hover:underline" onClick={() => remove(e)}>Delete</button>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {entries.length >= LIMIT && (
              <p className="mt-2 text-xs text-slate-500">Showing the latest {LIMIT} entries. Narrow the dates to see older ones.</p>
            )}
          </div>
        )}
      </Card>

      {editing && (
        <EntryModal
          entry={editing === "new" ? null : editing}
          people={adminWrite ? people : people.filter((p) => p.user_id === me)}
          items={items}
          clients={clients}
          me={me}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 p-3">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
