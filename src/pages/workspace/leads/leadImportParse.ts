// Reading Meta lead ad exports (.xlsx, .csv, .tsv) in the browser and turning
// their columns into lead fields. Nothing here talks to the server.

export type Role = "name" | "phone" | "email" | "company" | "campaign" | "date" | "answer" | "skip";

export const ROLES: [Role, string][] = [
  ["name", "Name"],
  ["phone", "Phone"],
  ["email", "Email"],
  ["company", "Company"],
  ["campaign", "Campaign info"],
  ["date", "Lead date"],
  ["answer", "Save as answer"],
  ["skip", "Don't import"],
];

export type Sheet = { headers: string[]; rows: string[][] };

export type ImportRow = {
  row: number; // line number in the file (header is line 1)
  name: string;
  phone: string;
  email: string;
  company: string;
  campaign: string;
  answers: Record<string, string>;
};

export const MAX_ROWS = 2000;

// ---------------------------------------------------------------------------
// File reading
// ---------------------------------------------------------------------------
export async function readFile(file: File): Promise<Sheet> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".xls")) {
    throw new Error("Old .xls files can't be read. Open it in Excel and use Save As, Excel Workbook (.xlsx), or download the CSV from Meta.");
  }
  let grid: string[][];
  if (lower.endsWith(".xlsx")) {
    const { readSheet } = await import("read-excel-file/browser");
    const data = await readSheet(file);
    grid = data.map((r) => r.map(cellText));
  } else {
    grid = parseDelimited(decode(await file.arrayBuffer()));
  }
  grid = grid.filter((r) => r.some((c) => c.trim() !== ""));
  if (grid.length < 2) throw new Error("The file has no leads in it.");
  const headers = grid[0].map((h, i) => h.trim() || `Column ${i + 1}`);
  const rows = grid.slice(1).map((r) => headers.map((_, i) => (r[i] ?? "").trim()));
  return { headers, rows };
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  // Excel dates carry no time zone: keep the clock time as typed, to the minute.
  if (v instanceof Date) return isNaN(v.getTime()) ? "" : new Date(Math.round(v.getTime() / 60000) * 60000).toISOString().slice(0, 16);
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  return String(v);
}

// Meta's own CSV download is UTF-16 with tabs; Excel's "CSV UTF-8" has a BOM.
function decode(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(b.subarray(2));
  // UTF-16 without a BOM: every other byte is zero in the first line.
  if (b.length > 4 && b[1] === 0 && b[3] === 0) return new TextDecoder("utf-16le").decode(b);
  const text = new TextDecoder("utf-8").decode(b);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseDelimited(text: string): string[][] {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const delim = [",", "\t", ";"].sort((a, b) => count(b) - count(a))[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Column matching
// ---------------------------------------------------------------------------
export const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

// Meta's technical columns that mean nothing to staff.
const SKIP = new Set(["id", "lead_id", "leadgen_id", "test", "via", "key", "sheet", "ad_id", "adset_id", "campaign_id", "form_id", "is_organic", "lead_status", "inbox_url", "page_id", "retailer_item_id", "partner_name", "vehicle"]);
const CAMPAIGN = new Set(["campaign_name", "campaign", "adset_name", "ad_set_name", "ad_set", "ad_name", "ad", "form_name", "form", "platform"]);

export function guessRole(header: string): Role {
  const h = norm(header);
  if (SKIP.has(h)) return "skip";
  if (["full_name", "name", "first_name", "last_name", "customer_name", "lead_name"].includes(h)) return "name";
  if (["phone_number", "phone", "mobile", "mobile_number", "contact_number", "whatsapp_number", "phone_no", "mobile_no"].includes(h)) return "phone";
  if (["email", "email_address", "e_mail", "work_email"].includes(h)) return "email";
  if (["company_name", "company", "business_name", "organisation", "organization"].includes(h)) return "company";
  if (CAMPAIGN.has(h)) return "campaign";
  if (["created_time", "created_at", "date", "lead_date", "submitted_at", "submission_time"].includes(h)) return "date";
  return "answer";
}

// "what_is_your_budget?" -> "What is your budget?"
export function prettyHeader(header: string) {
  const s = header.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const CAMPAIGN_LABEL: Record<string, string> = {
  campaign_name: "Campaign", campaign: "Campaign", adset_name: "Ad set", ad_set_name: "Ad set", ad_set: "Ad set",
  ad_name: "Ad", ad: "Ad", form_name: "Form", form: "Form", platform: "Platform",
};

function niceDate(v: string) {
  // No offset (Excel date cells): show the clock time as it is.
  const local = /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(v);
  const d = new Date(local ? `${v}Z` : v);
  if (!v || isNaN(d.getTime())) return v;
  return d.toLocaleString("en-IN", { timeZone: local ? "UTC" : "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

// Meta writes phones as "p:+919876543210".
export function cleanPhone(v: string) {
  return v.replace(/^p:/i, "").trim();
}

export function phoneKey(v: string) {
  const d = v.replace(/\D/g, "");
  return d.length >= 7 ? d.slice(-10) : "";
}

export function buildRows(sheet: Sheet, roles: Role[]): ImportRow[] {
  return sheet.rows.map((cells, idx) => {
    const out: ImportRow = { row: idx + 2, name: "", phone: "", email: "", company: "", campaign: "", answers: {} };
    const names: string[] = [];
    const campaign: string[] = [];
    roles.forEach((role, i) => {
      const v = cells[i] ?? "";
      if (!v || role === "skip") return;
      const header = sheet.headers[i];
      if (role === "name") names.push(v);
      else if (role === "phone") out.phone ||= cleanPhone(v);
      else if (role === "email") out.email ||= v;
      else if (role === "company") out.company ||= v;
      else if (role === "campaign") campaign.push(`${CAMPAIGN_LABEL[norm(header)] ?? prettyHeader(header)}: ${v}`);
      else if (role === "date") out.answers["Lead date"] = niceDate(v);
      else out.answers[prettyHeader(header)] = v.slice(0, 500);
    });
    out.name = names.join(" ").replace(/\s+/g, " ").trim();
    out.campaign = campaign.join(" · ");
    return out;
  });
}

export type Check = { ok: ImportRow[]; noContact: ImportRow[]; repeated: ImportRow[]; existing: ImportRow[] };

// The same checks the server makes, so the preview counts match.
export function checkRows(rows: ImportRow[], existingPhones: Set<string>, existingEmails: Set<string>): Check {
  const seenPhones = new Set<string>();
  const seenEmails = new Set<string>();
  const res: Check = { ok: [], noContact: [], repeated: [], existing: [] };
  for (const r of rows) {
    const key = phoneKey(r.phone);
    const email = r.email.trim().toLowerCase();
    if (!key && !email) {
      res.noContact.push(r);
      continue;
    }
    if (key ? existingPhones.has(key) : existingEmails.has(email)) {
      res.existing.push(r);
      continue;
    }
    if (key ? seenPhones.has(key) : seenEmails.has(email)) {
      res.repeated.push(r);
      continue;
    }
    if (key) seenPhones.add(key);
    if (email) seenEmails.add(email);
    res.ok.push(r);
  }
  return res;
}
