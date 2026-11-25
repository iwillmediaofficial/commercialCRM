import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { supabase, type Tables } from "../../../lib/supabase";
import type { Json } from "../../../lib/database.types";
import { useWorkspace } from "../../../lib/workspace";
import { nameOf, useMembers } from "../../../lib/members";
import { downloadCsv } from "../../../lib/format";
import { Alert, Badge, Button, Card, Empty, Select, Spinner } from "../../../components/ui";
import { SOURCES } from "./leadShared";
import { LogoLoader } from "../../../components/Loader";
import { MAX_ROWS, ROLES, buildRows, checkRows, guessRole, phoneKey, readFile, type Role, type Sheet } from "./leadImportParse";

type Batch = Tables<"lead_imports">;
type Skipped = { row: number; name?: string; phone?: string; email?: string; reason: string };
type Assign = "rotation" | "person" | "none";

const CHUNK = 200;

const ASSIGN_LABEL: Record<string, string> = { rotation: "Shared by rotation", person: "One person", none: "Unassigned" };

export default function LeadImport() {
  const { workspace, isAdmin, canWrite, hasModule } = useWorkspace();
  const people = useMembers(workspace.id);

  const [fileName, setFileName] = useState("");
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [source, setSource] = useState("Meta Ads");
  const [assign, setAssign] = useState<Assign>("rotation");
  const [assignee, setAssignee] = useState("");
  const [existing, setExisting] = useState<{ phones: Set<string>; emails: Set<string> } | null>(null);
  const [rotationCount, setRotationCount] = useState<number | null>(null);
  const [reading, setReading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ imported: number; skipped: Skipped[] } | null>(null);
  const [error, setError] = useState("");
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [undoing, setUndoing] = useState<string | null>(null);
  const [confirmUndo, setConfirmUndo] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const loadBatches = useCallback(async () => {
    const { data, error } = await supabase
      .from("lead_imports")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) setError(error.message);
    setBatches(data ?? []);
  }, [workspace.id]);

  useEffect(() => {
    loadBatches();
    supabase
      .from("lead_assignment_members")
      .select("user_id", { count: "exact", head: true })
      .eq("workspace_id", workspace.id)
      .is("form_id", null)
      .eq("in_rotation", true)
      .eq("is_away", false)
      .then(({ count }) => setRotationCount(count ?? 0));
  }, [loadBatches, workspace.id]);

  // Phones and emails already in the CRM, for the preview's duplicate count.
  async function loadExisting() {
    const phones = new Set<string>();
    const emails = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("leads")
        .select("phone, email")
        .eq("workspace_id", workspace.id)
        .range(from, from + 999);
      if (error) throw error;
      for (const l of data ?? []) {
        const k = phoneKey(l.phone ?? "");
        if (k) phones.add(k);
        if (l.email) emails.add(l.email.trim().toLowerCase());
      }
      if (!data || data.length < 1000) break;
    }
    setExisting({ phones, emails });
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    setError("");
    setResult(null);
    setNotice("");
    setFileName(file.name);
    setReading(true);
    try {
      if (!/\.(xlsx|xls|csv|tsv|txt)$/i.test(file.name)) {
        throw new Error("Please choose an Excel (.xlsx) or CSV file.");
      }
      const s = await Promise.race([
        readFile(file),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Reading the file took too long. Try saving it as CSV from Excel and import that.")), 45_000)),
      ]);
      if (s.rows.length > MAX_ROWS) {
        throw new Error(`This file has ${s.rows.length.toLocaleString("en-IN")} leads. One import can take up to ${MAX_ROWS.toLocaleString("en-IN")}, so please split it into smaller files.`);
      }
      const r = s.headers.map(guessRole);
      setSheet(s);
      setRoles(r);
      setFileName(file.name);
      await loadExisting();
    } catch (e) {
      setSheet(null);
      setError(e instanceof Error ? e.message : "Couldn't read that file.");
    }
    setReading(false);
  }

  function reset() {
    setSheet(null);
    setRoles([]);
    setFileName("");
    setResult(null);
    setProgress(null);
  }

  const rows = useMemo(() => (sheet ? buildRows(sheet, roles) : []), [sheet, roles]);
  const check = useMemo(() => (existing ? checkRows(rows, existing.phones, existing.emails) : null), [rows, existing]);
  const hasPhoneOrEmail = roles.includes("phone") || roles.includes("email");
  const staff = people.filter((p) => p.is_active);

  async function runImport() {
    if (!sheet || !check) return;
    setError("");
    if (!hasPhoneOrEmail) return setError("Pick which column has the phone number (or email).");
    if (assign === "person" && !assignee) return setError("Pick the person who should get these leads.");
    if (check.ok.length === 0) return setError("There are no new leads to import in this file.");

    // Send every row: the server makes the final duplicate check.
    const send = rows;
    setProgress({ done: 0, total: send.length });
    const { data: id, error: e1 } = await supabase.rpc("start_lead_import", {
      p_workspace_id: workspace.id,
      p_file_name: fileName,
      p_source: source,
      p_assign: assign,
      p_assignee: assign === "person" ? assignee : null,
      p_total: send.length,
    });
    if (e1 || !id) {
      setProgress(null);
      return setError(e1?.message ?? "Couldn't start the import.");
    }
    let imported = 0;
    const skipped: Skipped[] = [];
    for (let i = 0; i < send.length; i += CHUNK) {
      const part = send.slice(i, i + CHUNK);
      const { data, error } = await supabase.rpc("import_lead_rows", { p_import_id: id, p_rows: part as unknown as Json });
      if (error) {
        setError(`Stopped after ${imported} leads: ${error.message}. The leads imported so far are saved; you can undo them below.`);
        break;
      }
      const res = data as { imported: number; skipped: Skipped[] };
      imported += res.imported;
      skipped.push(...res.skipped);
      setProgress({ done: Math.min(i + CHUNK, send.length), total: send.length });
    }
    await supabase.rpc("finish_lead_import", { p_import_id: id });
    setResult({ imported, skipped });
    setProgress(null);
    setSheet(null);
    loadBatches();
  }

  async function undo(b: Batch) {
    setConfirmUndo(null);
    setUndoing(b.id);
    setError("");
    setNotice("");
    const { data, error } = await supabase
      .from("leads")
      .delete()
      .eq("workspace_id", workspace.id)
      .eq("import_id", b.id)
      .eq("stage", "new")
      .is("first_contacted_at", null)
      .select("id");
    if (error) {
      setUndoing(null);
      return setError(error.message);
    }
    const { data: res, error: e2 } = await supabase.rpc("mark_lead_import_undone", { p_import_id: b.id, p_removed: data?.length ?? 0 });
    setUndoing(null);
    if (e2) return setError(e2.message);
    const r = res as { removed: number; kept: number };
    setNotice(`Removed ${r.removed} lead${r.removed === 1 ? "" : "s"}.${r.kept ? ` ${r.kept} already worked on ${r.kept === 1 ? "was" : "were"} kept.` : ""}`);
    loadBatches();
  }

  if (!hasModule("leads")) return <Alert tone="info">Leads aren't turned on for this company.</Alert>;
  if (!isAdmin || !canWrite) return <Alert tone="info">Only owners and admins can import leads.</Alert>;

  const preview = rows.slice(0, 5);
  const answerCols = roles.filter((r) => r === "answer").length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Import leads</h1>
          <p className="text-sm text-slate-500">Bring in leads from a Meta lead ad download (Excel or CSV), or any sheet with names and phone numbers.</p>
        </div>
        <Link to={`/w/${workspace.slug}/leads`} className="text-sm font-medium text-brand-600 hover:underline">Back to leads</Link>
      </div>

      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {result && (
        <Card title="Import finished">
          <p className="text-sm text-slate-700">
            <span className="font-semibold">{result.imported}</span> lead{result.imported === 1 ? "" : "s"} imported
            {result.skipped.length > 0 && <>, <span className="font-semibold">{result.skipped.length}</span> skipped</>}.
            {result.imported > 0 && " They are waiting under Follow-ups, Not contacted yet. No 1-hour deadline was set, so nobody goes overdue or gets locked because of this import."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {result.skipped.length > 0 && (
              <Button
                variant="secondary"
                onClick={() =>
                  downloadCsv(
                    "skipped-leads.csv",
                    ["Row in file", "Name", "Phone", "Email", "Why skipped"],
                    result.skipped.map((s) => [s.row, s.name, s.phone, s.email, s.reason]),
                  )
                }
              >
                Download skipped rows
              </Button>
            )}
            <Link to={`/w/${workspace.slug}/follow-ups`} className="inline-flex items-center rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-700">
              Open Follow-ups
            </Link>
            <Button variant="secondary" onClick={reset}>Import another file</Button>
          </div>
        </Card>
      )}

      {!sheet && !result && (
        <Card title="1. Choose the file">
          <label
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              if (!dragOver) setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (!reading) pick(e.dataTransfer.files?.[0]);
            }}
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-10 text-center transition ${dragOver ? "border-brand-500 bg-brand-50" : "border-slate-300 hover:border-brand-400 hover:bg-brand-50/40"} ${reading ? "pointer-events-none opacity-80" : ""}`}
          >
            {reading ? (
              <>
                <LogoLoader variant="bars" className="h-10 w-10" />
                <span className="text-sm font-semibold text-slate-700">Reading {fileName || "the file"}…</span>
                <span className="text-xs text-slate-500">Checking the leads and looking for duplicates. This takes a few seconds.</span>
              </>
            ) : (
              <>
                <span className="text-sm font-semibold text-slate-700">{dragOver ? "Drop the file here" : "Drag the Excel or CSV file here, or click to pick it"}</span>
                <span className="text-xs text-slate-500">
                  In Meta Ads Manager or Business Suite, open your lead form and download the leads. .xlsx and .csv files, up to {MAX_ROWS.toLocaleString("en-IN")} leads each.
                </span>
              </>
            )}
            <input
              type="file"
              className="sr-only"
              accept=".xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              disabled={reading}
              onChange={(e) => {
                pick(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
        </Card>
      )}

      {sheet && (
        <>
          <Card title={`2. Check the columns: ${fileName}`} actions={<Button variant="secondary" onClick={reset}>Choose another file</Button>}>
            <p className="mb-3 text-sm text-slate-600">
              We matched each column for you. Change any that look wrong. Columns set to "Save as answer" show on the lead as the customer's form answers.
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {sheet.headers.map((h, i) => (
                <div key={i} className="rounded-lg bg-slate-50 p-2.5 ring-1 ring-slate-200">
                  <div className="truncate text-xs font-semibold text-slate-700" title={h}>{h}</div>
                  <div className="mb-1.5 truncate text-xs text-slate-500" title={sheet.rows[0]?.[i]}>e.g. {sheet.rows.find((r) => r[i])?.[i] || "(empty)"}</div>
                  <Select value={roles[i]} onChange={(e) => setRoles(roles.map((r, j) => (j === i ? (e.target.value as Role) : r)))} aria-label={`Column ${h}`}>
                    {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                </div>
              ))}
            </div>
            {!hasPhoneOrEmail && <div className="mt-3"><Alert tone="warning">No column is set to Phone or Email. Pick the column with the phone number.</Alert></div>}
          </Card>

          <Card title="3. Preview">
            {!check ? (
              <Spinner />
            ) : (
              <>
                <div className="mb-4 flex flex-wrap gap-2 text-sm">
                  <Badge tone="bg-green-100 text-green-800">{check.ok.length} new</Badge>
                  {check.existing.length > 0 && <Badge tone="bg-amber-100 text-amber-800">{check.existing.length} already in the CRM (skipped)</Badge>}
                  {check.repeated.length > 0 && <Badge tone="bg-amber-100 text-amber-800">{check.repeated.length} repeated in the file (skipped)</Badge>}
                  {check.noContact.length > 0 && <Badge tone="bg-red-100 text-red-700">{check.noContact.length} with no phone or email (skipped)</Badge>}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="text-xs uppercase text-slate-500">
                      <tr>
                        <th className="py-2 pr-3">Name</th>
                        <th className="py-2 pr-3">Phone</th>
                        <th className="py-2 pr-3">Email</th>
                        <th className="py-2 pr-3">Campaign</th>
                        <th className="py-2">Answers</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {preview.map((r) => (
                        <tr key={r.row} className="align-top">
                          <td className="py-2 pr-3 font-medium text-slate-800">{r.name || <span className="text-slate-400">(uses phone)</span>}</td>
                          <td className="py-2 pr-3">{r.phone}</td>
                          <td className="py-2 pr-3">{r.email}</td>
                          <td className="max-w-[14rem] py-2 pr-3 text-xs text-slate-600">{r.campaign}</td>
                          <td className="py-2 text-xs text-slate-600">
                            {Object.entries(r.answers).slice(0, 3).map(([k, v]) => <div key={k}><span className="text-slate-500">{k}:</span> {v}</div>)}
                            {Object.keys(r.answers).length > 3 && <div className="text-slate-400">+{Object.keys(r.answers).length - 3} more</div>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Showing the first {preview.length} of {rows.length} rows{answerCols ? `, with ${answerCols} answer column${answerCols === 1 ? "" : "s"}` : ""}.
                </p>
              </>
            )}
          </Card>

          <Card title="4. Who gets these leads?">
            <fieldset disabled={!!progress} className="space-y-4">
              <div className="space-y-2">
                {(["rotation", "person", "none"] as Assign[]).map((a) => (
                  <label key={a} className="flex items-start gap-2 text-sm">
                    <input type="radio" name="assign" className="mt-1" checked={assign === a} onChange={() => setAssign(a)} />
                    <span>
                      <span className="font-medium text-slate-700">
                        {a === "rotation" ? "Share them by turns with the lead rotation team" : a === "person" ? "Give them all to one person" : "Leave them unassigned"}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {a === "rotation"
                          ? rotationCount === 0
                            ? "Nobody is in the rotation right now. Add people on the Lead assignment page first."
                            : `Handed out one by one to the ${rotationCount ?? ""} people in the rotation who aren't away.`
                          : a === "person"
                            ? "Good for a small file or one salesperson."
                            : "An admin can hand them out later from the Leads page."}
                      </span>
                    </span>
                  </label>
                ))}
                {assign === "person" && (
                  <div className="max-w-xs pl-6">
                    <Select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Person">
                      <option value="">Pick a person</option>
                      {staff.map((p) => <option key={p.user_id} value={p.user_id}>{p.full_name}</option>)}
                    </Select>
                  </div>
                )}
              </div>
              <div className="max-w-xs">
                <span className="mb-1 block text-sm font-medium text-slate-700">Lead source</span>
                <Select value={source} onChange={(e) => setSource(e.target.value)}>
                  {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
              </div>
              <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800">
                Imported leads don't get the automatic first-call deadline and aren't passed on, so a big file won't make your team overdue or trigger the Stuck lock. They wait under Follow-ups, Not contacted yet. Each person gets one alert with how many leads they got.
              </p>
            </fieldset>

            {progress && (
              <div className="mt-4">
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full bg-brand-600 transition-all" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
                </div>
                <p className="mt-1 text-xs text-slate-500">Importing… {progress.done} of {progress.total} rows checked. Keep this page open.</p>
              </div>
            )}

            <div className="mt-4 flex justify-end">
              <Button onClick={runImport} disabled={!!progress || !check || check.ok.length === 0 || !hasPhoneOrEmail}>
                {progress ? "Importing…" : `Import ${check?.ok.length ?? 0} lead${check?.ok.length === 1 ? "" : "s"}`}
              </Button>
            </div>
          </Card>
        </>
      )}

      <Card title="Past imports">
        {!batches ? (
          <Spinner />
        ) : batches.length === 0 ? (
          <Empty>No imports yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 pr-3">File</th>
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">Imported</th>
                  <th className="py-2 pr-3">Skipped</th>
                  <th className="py-2 pr-3">Given to</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {batches.map((b) => (
                  <tr key={b.id}>
                    <td className="max-w-[16rem] truncate py-2 pr-3 font-medium text-slate-800" title={b.file_name}>{b.file_name}</td>
                    <td className="py-2 pr-3 text-slate-600">
                      {new Date(b.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                      {b.created_by && <span className="block text-xs text-slate-400">by {nameOf(people, b.created_by) || "a former member"}</span>}
                    </td>
                    <td className="py-2 pr-3">{b.imported}</td>
                    <td className="py-2 pr-3">{b.skipped}</td>
                    <td className="py-2 pr-3 text-slate-600">{b.assign_mode === "person" ? nameOf(people, b.assignee) || "One person" : ASSIGN_LABEL[b.assign_mode]}</td>
                    <td className="py-2 text-right">
                      {b.undone_at ? (
                        <span className="text-xs text-slate-500">Undone, {b.undone_count ?? 0} removed</span>
                      ) : b.imported > 0 && confirmUndo === b.id ? (
                        <div className="flex flex-col items-end gap-1.5">
                          <span className="text-xs text-slate-600">Remove these leads? Ones already contacted are kept.</span>
                          <div className="flex gap-2">
                            <Button variant="secondary" onClick={() => setConfirmUndo(null)}>Cancel</Button>
                            <Button variant="danger" onClick={() => undo(b)}>Yes, remove</Button>
                          </div>
                        </div>
                      ) : b.imported > 0 ? (
                        <Button variant="danger" onClick={() => setConfirmUndo(b.id)} disabled={undoing === b.id}>
                          {undoing === b.id ? "Removing…" : "Undo this import"}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
