// Lead links: a secret address per company that turns anything posted to it
// (Google Sheet script, Zapier, Make, Pabbly) into a live lead. The receiving
// end is the lead-link edge function; see supabase/functions/lead-link.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { supabase, type Tables } from "../../../lib/supabase";
import type { Json } from "../../../lib/database.types";
import { useWorkspace } from "../../../lib/workspace";
import { nameOf, useMembers } from "../../../lib/members";
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, Select, Spinner } from "../../../components/ui";
import { SOURCES } from "./leadShared";
import { ROLES, guessRole, norm, prettyHeader, type Role } from "./leadImportParse";

type LeadLink = Tables<"lead_links">;
type LinkEvent = Tables<"lead_link_events">;
type Assign = "rotation" | "person" | "none";
type Tab = "setup" | "fields" | "received";
type Tool = "sheet" | "zapier" | "make" | "pabbly";

const FUNCTIONS_URL = `${(import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, "")}/functions/v1/lead-link`;
const linkUrl = (token: string) => `${FUNCTIONS_URL}?key=${token}`;

const ASSIGN_LABEL: Record<Assign, string> = { rotation: "Shared by rotation", person: "One person", none: "Unassigned" };
const STATUS: Record<string, { label: string; tone: string }> = {
  added: { label: "Added", tone: "bg-green-100 text-green-800" },
  duplicate: { label: "Already in the CRM", tone: "bg-amber-100 text-amber-800" },
  rejected: { label: "Rejected", tone: "bg-red-100 text-red-700" },
  test: { label: "Test", tone: "bg-sky-100 text-sky-800" },
};
const VIA: Record<string, string> = { "google-sheet": "Google Sheet", zapier: "Zapier", make: "Make", pabbly: "Pabbly", web: "Web" };
// Fields our own script and tools add that aren't part of the lead.
const HELPER_FIELDS = new Set(["test", "via", "sheet", "key"]);

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function ago(iso: string | null) {
  if (!iso) return "never";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return when(iso);
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// Tab names typed on the Set up tab: one per line or comma separated.
function parseTabs(text: string) {
  return [...new Set(text.split(/[\n,]/).map((t) => t.trim()).filter(Boolean))].slice(0, 50);
}

function sheetScript(link: LeadLink, tabs: string[]) {
  const tabList = tabs.length ? `[\n${tabs.map((t) => `  ${JSON.stringify(t)},`).join("\n")}\n]` : "[]";
  return `// IWILL CRM: send new rows of this Google Sheet to the lead link "${link.name.replace(/["\\]/g, "")}".
//
// 1. Paste all of this into Extensions > Apps Script (replace what is there) and press Save.
// 2. In the bar at the top pick "setup", press Run, and allow access when Google asks.
// From then on every new row reaches the CRM within a minute. Row 1 of each tab must hold the headers.
// Each lead is tagged with the name of the tab it came from.
// To also send rows that were already there, run "sendAllRows" once
// (leads already in the CRM are skipped).

const LEAD_LINK = "${linkUrl(link.token)}";

// Which tabs to send. Type the tab names exactly as they show at the bottom of the sheet.
// Leave the list empty, like [], to send every tab (new tabs are picked up by themselves).
const TABS = ${tabList};

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("sendNewRows").timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger("sendNewRows").forSpreadsheet(SpreadsheetApp.getActive()).onChange().create();
  var props = PropertiesService.getDocumentProperties();
  props.deleteAllProperties();
  var sheets = leadSheets_();
  if (!sheets.length) throw new Error("None of the tabs in TABS were found. Check the names: " + TABS.join(", "));
  // Start after the rows already there, so old leads aren't sent.
  sheets.forEach(function (sheet) { props.setProperty(key_(sheet), String(Math.max(sheet.getLastRow(), 1))); });
  var res = UrlFetchApp.fetch(LEAD_LINK, {
    method: "post", contentType: "application/json", muteHttpExceptions: true,
    payload: JSON.stringify({ test: true, via: "google-sheet", sheet: sheets.map(function (s) { return s.getName(); }).join(", ") }),
  });
  Logger.log("Watching tabs: " + sheets.map(function (s) { return s.getName(); }).join(", "));
  Logger.log("Connection test: " + res.getResponseCode() + " " + res.getContentText());
}

function sendAllRows() {
  var props = PropertiesService.getDocumentProperties();
  leadSheets_().forEach(function (sheet) { props.setProperty(key_(sheet), "1"); });
  sendNewRows();
}

function sendNewRows() {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(1000)) return;
  try {
    leadSheets_().forEach(sendTab_);
  } finally {
    lock.releaseLock();
  }
}

function sendTab_(sheet) {
  var props = PropertiesService.getDocumentProperties();
  var last = sheet.getLastRow();
  var saved = props.getProperty(key_(sheet));
  // A tab added after setup is new, so all of its rows are new leads.
  var done = saved === null ? 1 : Number(saved);
  if (last < done) { props.setProperty(key_(sheet), String(last)); return; }
  while (last > done) {
    var count = Math.min(last - done, 50);
    var width = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
    var rows = sheet.getRange(done + 1, 1, count, width).getDisplayValues();
    var leads = [];
    rows.forEach(function (r) {
      var lead = {};
      headers.forEach(function (h, i) { if (h && r[i] !== "") lead[h] = r[i]; });
      if (Object.keys(lead).length) { lead["Sheet tab"] = sheet.getName(); leads.push(lead); }
    });
    if (leads.length) {
      var res = UrlFetchApp.fetch(LEAD_LINK, {
        method: "post", contentType: "application/json", muteHttpExceptions: true,
        payload: JSON.stringify({ leads: leads, via: "google-sheet" }),
      });
      var code = res.getResponseCode();
      // Not reachable, turned off or too busy: keep the rows and try again next minute.
      if (code !== 200 && code !== 400 && code !== 413) { Logger.log(sheet.getName() + ": will retry (" + code + "): " + res.getContentText()); return; }
      if (code !== 200) Logger.log(sheet.getName() + ": skipped rows " + (done + 1) + "-" + (done + count) + ": " + res.getContentText());
    }
    done += count;
    props.setProperty(key_(sheet), String(done));
  }
}

function leadSheets_() {
  var book = SpreadsheetApp.getActive();
  if (!TABS.length) return book.getSheets();
  return TABS.map(function (name) {
    var s = book.getSheetByName(name);
    if (!s) Logger.log("Tab not found: " + name);
    return s;
  }).filter(function (s) { return s; });
}

function key_(sheet) {
  return "lastRow:" + sheet.getSheetId();
}
`;
}

export default function LeadLinks() {
  const { workspace, isAdmin, canWrite, hasModule } = useWorkspace();
  const people = useMembers(workspace.id);
  const [links, setLinks] = useState<LeadLink[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<LeadLink | "new" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("lead_links").select("*").eq("workspace_id", workspace.id).order("created_at");
    if (error) setError(error.message);
    setLinks(data ?? []);
    setSelected((s) => (s && data?.some((l) => l.id === s) ? s : data?.[0]?.id ?? null));
  }, [workspace.id]);

  useEffect(() => {
    load();
  }, [load]);

  if (!hasModule("leads")) return <Alert tone="info">Leads aren't turned on for this company.</Alert>;
  if (!isAdmin) return <Alert tone="info">Only owners and admins can manage lead links.</Alert>;
  if (!links) return <Spinner />;

  const link = links.find((l) => l.id === selected) ?? null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Lead links</h1>
          <p className="text-sm text-slate-500">
            Get Meta leads into the CRM the moment they come in, through a Google Sheet or Zapier, Make or Pabbly. No Meta approval needed.
          </p>
        </div>
        <div className="flex gap-2">
          <Link to={`/w/${workspace.slug}/leads`} className="self-center text-sm font-medium text-brand-600 hover:underline">Back to leads</Link>
          {canWrite && links.length > 0 && links.length < 10 && <Button onClick={() => setEditing("new")}>+ New lead link</Button>}
        </div>
      </div>

      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {links.length === 0 ? (
        <Card>
          <div className="mx-auto max-w-xl py-6 text-center">
            <h2 className="text-base font-semibold text-slate-800">Make your first lead link</h2>
            <p className="mt-2 text-sm text-slate-600">
              A lead link is a secret address for your company. Whatever is sent to it becomes a lead straight away, with the 1-hour first-call rule,
              the lead rotation and pass-on, just like a lead from your own form. Leads already in the CRM (same phone number) are skipped.
            </p>
            <div className="mt-4 grid gap-3 text-left sm:grid-cols-2">
              <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
                <div className="text-sm font-semibold text-slate-800">Google Sheet</div>
                <p className="mt-1 text-xs text-slate-600">Your Meta leads already go to a sheet? Paste our script into it and each new row is sent to the CRM.</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
                <div className="text-sm font-semibold text-slate-800">Zapier, Make or Pabbly</div>
                <p className="mt-1 text-xs text-slate-600">Connect "Facebook Lead Ads, new lead" straight to the link. The quickest way.</p>
              </div>
            </div>
            {canWrite && <Button className="mt-5" onClick={() => setEditing("new")}>Make a lead link</Button>}
          </div>
        </Card>
      ) : (
        <>
          {links.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {links.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setSelected(l.id)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition ${l.id === selected ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"}`}
                >
                  {l.name}
                  {!l.is_active && <span className="ml-1.5 text-xs opacity-75">(off)</span>}
                </button>
              ))}
            </div>
          )}
          {link && (
            <LinkDetail
              key={link.id}
              link={link}
              canWrite={canWrite}
              assigneeName={nameOf(people, link.assignee)}
              onEdit={() => setEditing(link)}
              onChanged={(l, msg) => {
                setLinks((ls) => (ls ?? []).map((x) => (x.id === l.id ? l : x)));
                setError("");
                setNotice(msg ?? "");
              }}
              onDeleted={(msg) => {
                setNotice(msg);
                load();
              }}
              onError={(m) => {
                setNotice("");
                setError(m);
              }}
            />
          )}
        </>
      )}

      {editing && (
        <LinkModal
          link={editing === "new" ? null : editing}
          workspaceId={workspace.id}
          people={people.filter((p) => p.is_active)}
          onClose={() => setEditing(null)}
          onSaved={(l, created) => {
            setEditing(null);
            setError("");
            setNotice(created ? `"${l.name}" is ready. Follow the steps under Set up to connect it.` : "Saved.");
            load().then(() => setSelected(l.id));
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One link: address, actions and the three tabs.
// ---------------------------------------------------------------------------
function LinkDetail({ link, canWrite, assigneeName, onEdit, onChanged, onDeleted, onError }: {
  link: LeadLink;
  canWrite: boolean;
  assigneeName: string;
  onEdit: () => void;
  onChanged: (l: LeadLink, notice?: string) => void;
  onDeleted: (notice: string) => void;
  onError: (m: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("setup");
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<"rotate" | "delete" | null>(null);
  const [busy, setBusy] = useState(false);
  const url = linkUrl(link.token);
  const masked = `${FUNCTIONS_URL}?key=${link.token.slice(0, 6)}${"•".repeat(18)}`;

  async function copy() {
    if (await copyText(url)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setShow(true);
    }
  }

  async function toggle() {
    setBusy(true);
    const { data, error } = await supabase.from("lead_links").update({ is_active: !link.is_active }).eq("id", link.id).select("*").single();
    setBusy(false);
    if (error || !data) return onError(error?.message ?? "Couldn't save.");
    onChanged(data, data.is_active ? "The link is on again." : "The link is off. Anything sent to it is refused until you turn it back on.");
  }

  async function rotate() {
    setConfirm(null);
    setBusy(true);
    const { data: token, error } = await supabase.rpc("rotate_lead_link_token", { p_link_id: link.id });
    setBusy(false);
    if (error || !token) return onError(error?.message ?? "Couldn't make a new address.");
    setShow(true);
    onChanged({ ...link, token }, "New address made. The old one has stopped working: paste the new one (or the new script) wherever the old one was.");
  }

  async function remove() {
    setConfirm(null);
    setBusy(true);
    const { error } = await supabase.from("lead_links").delete().eq("id", link.id);
    setBusy(false);
    if (error) return onError(error.message);
    onDeleted(`"${link.name}" was deleted. Leads it brought in stay in the CRM.`);
  }

  return (
    <>
      <Card
        title={link.name}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={link.is_active ? "bg-green-100 text-green-800" : "bg-slate-200 text-slate-600"}>{link.is_active ? "On" : "Off"}</Badge>
            {canWrite && <Button variant="secondary" onClick={onEdit}>Edit</Button>}
          </div>
        }
      >
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <div className="text-xs text-slate-500">Leads added</div>
            <div className="font-semibold text-slate-800">{link.added_count}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Last received</div>
            <div className="font-semibold text-slate-800">{ago(link.last_received_at)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Who gets the leads</div>
            <div className="font-semibold text-slate-800">
              {link.assign_mode === "person" ? assigneeName || "One person" : ASSIGN_LABEL[link.assign_mode as Assign]} · {link.source}
            </div>
          </div>
        </div>

        <div className="mt-4">
          <div className="mb-1 text-sm font-medium text-slate-700">Your lead link</div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              readOnly
              value={show ? url : masked}
              onFocus={(e) => show && e.target.select()}
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700"
              aria-label="Lead link"
            />
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setShow((s) => !s)}>{show ? "Hide" : "Show"}</Button>
              <Button onClick={copy}>{copied ? "Copied" : "Copy link"}</Button>
            </div>
          </div>
          <p className="mt-1 text-xs text-slate-500">Keep it private: anyone with this link can add leads to your CRM. If it gets out, make a new address.</p>
        </div>

        {canWrite && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            <Button variant="secondary" onClick={toggle} disabled={busy}>{link.is_active ? "Turn off" : "Turn on"}</Button>
            <Button variant="secondary" onClick={() => setConfirm("rotate")} disabled={busy}>Make a new address</Button>
            <Button variant="danger" onClick={() => setConfirm("delete")} disabled={busy}>Delete</Button>
          </div>
        )}
        {confirm && (
          <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
            {confirm === "rotate"
              ? "The current address stops working right away. You'll need to paste the new one into your sheet script or Zapier/Make/Pabbly."
              : "Delete this link? Anything still sending to it will be refused. Leads it already brought in stay in the CRM."}
            <div className="mt-2 flex gap-2">
              <Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button>
              <Button variant="danger" onClick={confirm === "rotate" ? rotate : remove}>{confirm === "rotate" ? "Yes, make a new address" : "Yes, delete"}</Button>
            </div>
          </div>
        )}
      </Card>

      <div className="flex gap-1 border-b border-slate-200">
        {(["setup", "fields", "received"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === t ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}
          >
            {t === "setup" ? "Set up" : t === "fields" ? "Fields" : "Received"}
          </button>
        ))}
      </div>

      {tab === "setup" && <SetupGuide link={link} url={url} />}
      {tab === "fields" && <FieldsTab link={link} canWrite={canWrite} onSaved={(l) => onChanged(l, "Field matches saved. New leads use them right away.")} onError={onError} />}
      {tab === "received" && <ReceivedTab link={link} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Set up guides
// ---------------------------------------------------------------------------
function SetupGuide({ link, url }: { link: LeadLink; url: string }) {
  const [tool, setTool] = useState<Tool>("sheet");
  const [copied, setCopied] = useState("");
  const [tabsText, setTabsText] = useState(() => {
    try {
      return localStorage.getItem(`lead-link-tabs:${link.id}`) ?? "";
    } catch {
      return "";
    }
  });
  const tabs = useMemo(() => parseTabs(tabsText), [tabsText]);
  const script = useMemo(() => sheetScript(link, tabs), [link, tabs]);
  useEffect(() => {
    try {
      localStorage.setItem(`lead-link-tabs:${link.id}`, tabsText);
    } catch {
      // Remembering the tabs is only a convenience.
    }
  }, [link.id, tabsText]);

  async function copy(what: string, text: string) {
    if (await copyText(text)) {
      setCopied(what);
      setTimeout(() => setCopied((c) => (c === what ? "" : c)), 2000);
    }
  }

  const step = (n: number, body: ReactNode) => (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">{n}</span>
      <div className="min-w-0 flex-1 text-sm text-slate-700">{body}</div>
    </li>
  );
  const copyUrl = (
    <Button variant="secondary" className="mt-1.5" onClick={() => copy("url", url)}>{copied === "url" ? "Copied" : "Copy lead link"}</Button>
  );

  return (
    <Card>
      <div className="mb-4 flex flex-wrap gap-2">
        {([["sheet", "Google Sheet"], ["zapier", "Zapier"], ["make", "Make"], ["pabbly", "Pabbly"]] as [Tool, string][]).map(([t, l]) => (
          <button
            key={t}
            onClick={() => setTool(t)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ${tool === t ? "bg-brand-50 text-brand-700 ring-brand-300" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"}`}
          >
            {l}
          </button>
        ))}
      </div>

      {tool === "sheet" && (
        <ol className="space-y-4">
          {step(1, <>Get your Meta leads into a Google Sheet. Meta can't do this by itself, so use a free connector such as Pabbly Connect, LeadsBridge or Zapier: trigger "Facebook Lead Ads, new lead", action "Google Sheets, add row". Make sure row 1 has the column names (full_name, phone_number, email and your questions).</>)}
          {step(2, <>Open that sheet and go to <b>Extensions, Apps Script</b>.</>)}
          {step(3, (
            <>
              <span className="font-medium">Which tabs have the leads?</span> Type the tab names exactly as they show at the bottom of your sheet, one per line. Leave it empty to send every tab, including tabs you add later.
              <textarea
                value={tabsText}
                onChange={(e) => setTabsText(e.target.value)}
                rows={3}
                placeholder={"e.g.\nDiwali 2026 offer 10%\nNRI Nov20"}
                className="mt-2 block w-full max-w-md rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand-400 focus:outline-none"
                aria-label="Tab names"
              />
              <span className="mt-1 block text-xs text-slate-500">
                {tabs.length ? `The script will watch ${tabs.length} tab${tabs.length === 1 ? "" : "s"}: ${tabs.join(", ")}.` : "The script will watch every tab."} Each lead shows which tab it came from.
              </span>
            </>
          ))}
          {step(4, (
            <>
              Delete what's in the editor, paste this script, and press <b>Save</b>. Your lead link and tabs are already in it. To change the tabs later, copy the script again, paste it, and run setup again.
              <div className="mt-2 flex gap-2">
                <Button onClick={() => copy("script", script)}>{copied === "script" ? "Copied" : "Copy script"}</Button>
              </div>
              <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">{script}</pre>
            </>
          ))}
          {step(5, <>In the bar at the top, pick <b>setup</b> and press <b>Run</b>. Google asks you to allow the script: choose your account, then Advanced, Go to the project, Allow.</>)}
          {step(6, <>Open the <b>Received</b> tab here. You should see a <b>Test</b> line within a few seconds. From now on every new row reaches the CRM within a minute.</>)}
          <li className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800">
            Rows already in the sheet are not sent, so old leads don't flood your team. To send them too, run <b>sendAllRows</b> once (leads already in the CRM are skipped), or use Leads, Import.
          </li>
        </ol>
      )}

      {tool === "zapier" && (
        <ol className="space-y-4">
          {step(1, <>In Zapier, make a Zap. Trigger: <b>Facebook Lead Ads</b>, event <b>New Lead</b>. Connect your Facebook account and pick the page and form.</>)}
          {step(2, <>Action: <b>Webhooks by Zapier</b>, event <b>POST</b>.</>)}
          {step(3, <>URL: paste your lead link. Payload Type: <b>json</b>. Leave <b>Data</b> empty to send every field of the lead, or add the fields you want (full_name, phone_number, email, your questions).{copyUrl}</>)}
          {step(4, <>Press <b>Test step</b>, then check the <b>Received</b> tab here, and turn the Zap on.</>)}
          <li className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Webhooks by Zapier needs a paid Zapier plan. Pabbly and Make have free plans for small volumes.</li>
        </ol>
      )}

      {tool === "make" && (
        <ol className="space-y-4">
          {step(1, <>In Make, create a scenario. First module: <b>Facebook Lead Ads, Watch New Leads</b>. Pick the page and form.</>)}
          {step(2, <>Add <b>HTTP, Make a request</b>. Method <b>POST</b>, URL your lead link.{copyUrl}</>)}
          {step(3, <>Body type <b>Raw</b>, content type <b>JSON (application/json)</b>. Request content, for example: <code className="rounded bg-slate-100 px-1 text-xs">{'{"full_name": "…", "phone_number": "…", "email": "…"}'}</code> with the lead's fields mapped in, plus any questions.</>)}
          {step(4, <>Run once, check the <b>Received</b> tab here, then turn the scenario on (schedule: immediately).</>)}
        </ol>
      )}

      {tool === "pabbly" && (
        <ol className="space-y-4">
          {step(1, <>In Pabbly Connect, create a workflow. Trigger: <b>Facebook Lead Ads, New Lead</b>. Connect and pick the page and form.</>)}
          {step(2, <>Action: <b>API (Pabbly)</b>, action event <b>Execute API Request</b>. Method <b>POST</b>, payload type <b>JSON</b>, URL your lead link.{copyUrl}</>)}
          {step(3, <>Under data, add full_name, phone_number, email and your questions, each mapped from the trigger.</>)}
          {step(4, <>Save and send a test, then check the <b>Received</b> tab here.</>)}
        </ol>
      )}

      <details className="mt-5 text-xs text-slate-500">
        <summary className="cursor-pointer font-medium text-slate-600">For developers</summary>
        <p className="mt-2">
          POST JSON (one lead, a list, or {"{ \"leads\": [...] }"}, up to 50) or a form to the link. Meta's field_data format works too.
          Send {"{ \"test\": true }"} to check the connection. Answers 200 with what happened to each lead; 404 wrong key, 410 link off, 429 too many (300 per 10 minutes).
        </p>
      </details>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Fields: how each incoming field is used.
// ---------------------------------------------------------------------------
function FieldsTab({ link, canWrite, onSaved, onError }: { link: LeadLink; canWrite: boolean; onSaved: (l: LeadLink) => void; onError: (m: string) => void }) {
  const [seen, setSeen] = useState<{ key: string; example: string }[] | null>(null);
  const [map, setMap] = useState<Record<string, Role>>(() => ({ ...(link.field_map as Record<string, Role>) }));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase
      .from("lead_link_events")
      .select("fields")
      .eq("link_id", link.id)
      .neq("status", "test")
      .order("received_at", { ascending: false })
      .limit(100)
      .then(({ data }) => {
        const found = new Map<string, string>();
        for (const e of data ?? []) {
          const f = (e.fields && typeof e.fields === "object" && !Array.isArray(e.fields) ? e.fields : {}) as Record<string, Json>;
          for (const [k, v] of Object.entries(f)) {
            if (HELPER_FIELDS.has(norm(k)) || found.has(k)) continue;
            found.set(k, String(v ?? ""));
          }
        }
        setSeen([...found].map(([key, example]) => ({ key, example })));
      });
  }, [link.id]);

  const roleOf = (k: string) => map[norm(k)] ?? guessRole(k);
  const changed = JSON.stringify(map) !== JSON.stringify(link.field_map ?? {});
  const hasPhone = seen?.some((f) => ["phone", "email"].includes(roleOf(f.key)));

  async function save() {
    // Store only the choices that differ from the automatic match.
    const clean: Record<string, Role> = {};
    for (const [k, r] of Object.entries(map)) if (r !== guessRole(k)) clean[k] = r;
    setSaving(true);
    const { data, error } = await supabase.from("lead_links").update({ field_map: clean }).eq("id", link.id).select("*").single();
    setSaving(false);
    if (error || !data) return onError(error?.message ?? "Couldn't save.");
    setMap({ ...(data.field_map as Record<string, Role>) });
    onSaved(data);
  }

  if (!seen) return <Spinner />;
  return (
    <Card title="How each field is used">
      {seen.length === 0 ? (
        <Empty>No leads have come in yet. Once the first lead arrives, its fields show here and you can change how each one is used.</Empty>
      ) : (
        <>
          <p className="mb-3 text-sm text-slate-600">
            These are the fields this link has received. We matched each one for you. Fields set to "Save as answer" show on the lead as the customer's form answers.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {seen.map((f) => (
              <div key={f.key} className="rounded-lg bg-slate-50 p-2.5 ring-1 ring-slate-200">
                <div className="truncate text-xs font-semibold text-slate-700" title={f.key}>{f.key}</div>
                <div className="mb-1.5 truncate text-xs text-slate-500" title={f.example}>e.g. {f.example || "(empty)"}</div>
                <Select
                  value={roleOf(f.key)}
                  disabled={!canWrite}
                  onChange={(e) => setMap({ ...map, [norm(f.key)]: e.target.value as Role })}
                  aria-label={`Field ${f.key}`}
                >
                  {ROLES.map(([v, l]) => <option key={v} value={v}>{v === "answer" ? `Save as answer (${prettyHeader(f.key)})` : v === "skip" ? "Don't save" : l}</option>)}
                </Select>
              </div>
            ))}
          </div>
          {!hasPhone && <div className="mt-3"><Alert tone="warning">No field is set to Phone or Email, so leads will be rejected. Pick the field with the phone number.</Alert></div>}
          {canWrite && (
            <div className="mt-4 flex justify-end gap-2">
              {changed && <Button variant="secondary" onClick={() => setMap({ ...(link.field_map as Record<string, Role>) })}>Undo changes</Button>}
              <Button onClick={save} disabled={!changed || saving}>{saving ? "Saving…" : "Save"}</Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Received: the last 100 things sent to the link, refreshed every 15 s.
// ---------------------------------------------------------------------------
function ReceivedTab({ link }: { link: LeadLink }) {
  const { workspace } = useWorkspace();
  const [events, setEvents] = useState<LinkEvent[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("lead_link_events")
      .select("*")
      .eq("link_id", link.id)
      .order("received_at", { ascending: false })
      .limit(100);
    setEvents(data ?? []);
  }, [link.id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  if (!events) return <Spinner />;
  return (
    <Card title="Received" actions={<Button variant="secondary" onClick={load}>Refresh</Button>}>
      {events.length === 0 ? (
        <Empty>Nothing yet. Follow the Set up steps; the test and every lead sent to this link show here.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 pr-3">When</th>
                <th className="py-2 pr-3">Result</th>
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Phone / email</th>
                <th className="py-2 pr-3">From</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {events.map((e) => {
                const s = STATUS[e.status] ?? STATUS.rejected;
                const fields = (e.fields && typeof e.fields === "object" && !Array.isArray(e.fields) ? e.fields : {}) as Record<string, Json>;
                return (
                  <tr key={e.id} className="align-top">
                    <td className="whitespace-nowrap py-2 pr-3 text-slate-600">{when(e.received_at)}</td>
                    <td className="py-2 pr-3">
                      <Badge tone={s.tone}>{s.label}</Badge>
                      {e.status === "rejected" && e.reason && <div className="mt-0.5 text-xs text-red-700">{e.reason}</div>}
                    </td>
                    <td className="py-2 pr-3 font-medium text-slate-800">{e.name || <span className="text-slate-400">—</span>}</td>
                    <td className="py-2 pr-3 text-slate-600">{e.phone || e.email || <span className="text-slate-400">—</span>}</td>
                    <td className="py-2 pr-3 text-slate-600">{VIA[e.via ?? ""] ?? e.via ?? ""}</td>
                    <td className="whitespace-nowrap py-2 text-right">
                      {e.lead_id && (
                        <Link to={`/w/${workspace.slug}/leads?open=${e.lead_id}`} className="mr-3 text-xs font-medium text-brand-600 hover:underline">
                          Open lead
                        </Link>
                      )}
                      {Object.keys(fields).length > 0 && (
                        <button className="text-xs font-medium text-slate-500 hover:text-slate-800" onClick={() => setOpen(open === e.id ? null : e.id)}>
                          {open === e.id ? "Hide fields" : "Fields"}
                        </button>
                      )}
                      {open === e.id && (
                        <div className="mt-2 max-w-xs whitespace-normal rounded-lg bg-slate-50 p-2 text-left text-xs ring-1 ring-slate-200">
                          {Object.entries(fields).map(([k, v]) => (
                            <div key={k}><span className="text-slate-500">{k}:</span> {String(v)}</div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">The last 100 are shown. The log keeps 30 days.</p>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Create / edit
// ---------------------------------------------------------------------------
function LinkModal({ link, workspaceId, people, onClose, onSaved }: {
  link: LeadLink | null;
  workspaceId: string;
  people: { user_id: string; full_name: string }[];
  onClose: () => void;
  onSaved: (l: LeadLink, created: boolean) => void;
}) {
  const [name, setName] = useState(link?.name ?? (link ? "" : "Meta leads"));
  const [source, setSource] = useState(link?.source ?? "Meta Ads");
  const [assign, setAssign] = useState<Assign>((link?.assign_mode as Assign) ?? "rotation");
  const [assignee, setAssignee] = useState(link?.assignee ?? "");
  const [rotationCount, setRotationCount] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase
      .from("lead_assignment_members")
      .select("user_id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .is("form_id", null)
      .eq("in_rotation", true)
      .eq("is_away", false)
      .then(({ count }) => setRotationCount(count ?? 0));
  }, [workspaceId]);

  async function save() {
    setError("");
    if (!name.trim()) return setError("Give the link a name, for example the campaign or form it is for.");
    if (assign === "person" && !assignee) return setError("Pick the person who should get these leads.");
    setSaving(true);
    const values = { name: name.trim(), source, assign_mode: assign, assignee: assign === "person" ? assignee : null };
    const res = link
      ? await supabase.from("lead_links").update(values).eq("id", link.id).select("*").single()
      : await supabase.from("lead_links").insert({ ...values, workspace_id: workspaceId }).select("*").single();
    setSaving(false);
    if (res.error || !res.data) return setError(res.error?.message ?? "Couldn't save.");
    onSaved(res.data, !link);
  }

  return (
    <Modal title={link ? "Edit lead link" : "New lead link"} onClose={onClose}>
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Name" hint="Only your team sees this, for example the campaign or form it is for.">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
        </Field>
        <div>
          <span className="mb-1 block text-sm font-medium text-slate-700">Who gets these leads?</span>
          <div className="space-y-2">
            {(["rotation", "person", "none"] as Assign[]).map((a) => (
              <div key={a}>
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name="assign" className="mt-1" checked={assign === a} onChange={() => setAssign(a)} />
                <span>
                  <span className="font-medium text-slate-700">
                    {a === "rotation" ? "Share them by turns with the lead rotation team" : a === "person" ? "Give them all to one person" : "Leave them unassigned"}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {a === "rotation"
                      ? rotationCount === 0
                        ? "Nobody is in the rotation right now. Add people on the Lead assignment page, or leads will come in unassigned."
                        : `Each lead goes to the next of the ${rotationCount ?? ""} people in the rotation, and is passed on if they don't contact it in time.`
                      : a === "person"
                        ? "Good for one salesperson."
                        : "An admin hands them out from the Leads page."}
                  </span>
                </span>
              </label>
              {a === "person" && assign === "person" && (
                <div className="mt-2 max-w-xs pl-6">
                  <Select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Person">
                    <option value="">Pick a person</option>
                    {people.map((p) => <option key={p.user_id} value={p.user_id}>{p.full_name}</option>)}
                  </Select>
                </div>
              )}
              </div>
            ))}
          </div>
        </div>
        <Field label="Lead source">
          <Select value={source} onChange={(e) => setSource(e.target.value)}>
            {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
        <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800">
          Leads from this link are live leads: the person who gets one has your first-call time limit to contact it, the same as a lead from your own form.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : link ? "Save" : "Make the link"}</Button>
        </div>
      </div>
    </Modal>
  );
}
