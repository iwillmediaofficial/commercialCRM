// Turning incoming lead fields (Google Sheet headers, Zapier/Make/Pabbly keys,
// Meta's own field_data) into CRM lead fields. Shared by the lead-link
// function and, later, the direct Meta connection.
//
// Keep guessRole in step with src/pages/workspace/leads/leadImportParse.ts so
// Excel import and lead links match the same columns.

export type Role = "name" | "phone" | "email" | "company" | "campaign" | "date" | "answer" | "skip";
export type Fields = Record<string, string>;
export type MappedLead = {
  name: string;
  phone: string;
  email: string;
  company: string;
  campaign: string;
  answers: Record<string, string>;
  fields: Fields;
  test?: boolean;
};

export const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

// Meta's technical fields, and our own script's helper fields.
const SKIP = new Set([
  "id", "lead_id", "leadgen_id", "ad_id", "adset_id", "campaign_id", "form_id", "page_id", "is_organic",
  "lead_status", "inbox_url", "retailer_item_id", "partner_name", "vehicle", "test", "via", "key", "sheet",
]);
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

export function prettyHeader(header: string) {
  const s = header.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const CAMPAIGN_LABEL: Record<string, string> = {
  campaign_name: "Campaign", campaign: "Campaign", adset_name: "Ad set", ad_set_name: "Ad set", ad_set: "Ad set",
  ad_name: "Ad", ad: "Ad", form_name: "Form", form: "Form", platform: "Platform",
};

function niceDate(v: string) {
  const d = new Date(v);
  if (!v || isNaN(d.getTime()) || !/\d{4}/.test(v)) return v;
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function text(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v).trim();
}

// One incoming record -> flat { field: value }. Understands Meta's
// field_data ([{ name, values: [] }]) and one level of nesting
// ({ lead: { ... } } or { data: { ... } } from some tools).
export function flatten(rec: Record<string, unknown>): Fields {
  const out: Fields = {};
  const put = (k: string, v: unknown) => {
    const key = k.trim().slice(0, 120);
    const val = text(v).slice(0, 1000);
    if (key && val && Object.keys(out).length < 60) out[key] = val;
  };
  for (const [k, v] of Object.entries(rec)) {
    if (k === "field_data" && Array.isArray(v)) {
      for (const f of v as { name?: string; values?: unknown[] }[]) if (f?.name) put(f.name, f.values ?? "");
    } else if (v && typeof v === "object" && !Array.isArray(v) && ["lead", "data", "fields", "answers"].includes(k)) {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) put(k2, v2);
    } else {
      put(k, v);
    }
  }
  return out;
}

// fieldMap: { "<normalised field name>": Role } set by the company on the
// Fields tab; anything not in it is matched automatically.
export function mapLead(fields: Fields, fieldMap: Record<string, string>, test = false): MappedLead {
  const out: MappedLead = { name: "", phone: "", email: "", company: "", campaign: "", answers: {}, fields, test };
  const names: string[] = [];
  const campaign: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    const role = (fieldMap[norm(k)] as Role | undefined) ?? guessRole(k);
    if (!v || role === "skip") continue;
    if (role === "name") names.push(v);
    else if (role === "phone") out.phone ||= v.replace(/^p:/i, "").trim();
    else if (role === "email") out.email ||= v;
    else if (role === "company") out.company ||= v;
    else if (role === "campaign") campaign.push(`${CAMPAIGN_LABEL[norm(k)] ?? prettyHeader(k)}: ${v}`);
    else if (role === "date") out.answers["Lead date"] = niceDate(v);
    else out.answers[prettyHeader(k)] = v.slice(0, 500);
  }
  out.name = names.join(" ").replace(/\s+/g, " ").trim();
  out.campaign = campaign.join(" · ");
  return out;
}
