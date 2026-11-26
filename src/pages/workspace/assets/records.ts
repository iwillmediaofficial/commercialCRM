import type { Tables } from "../../../lib/supabase";

export type CompanyRecord = Tables<"company_records">;
export type Kind = "document" | "asset" | "domain";

export const KINDS: { key: Kind; label: string; one: string }[] = [
  { key: "document", label: "Documents", one: "document" },
  { key: "asset", label: "Assets", one: "asset" },
  { key: "domain", label: "Domains", one: "domain" },
];

export const CATEGORIES: Record<Kind, [string, string][]> = {
  document: [
    ["company_registration", "Company registration"],
    ["gst", "GST certificate"],
    ["pan_tan", "PAN / TAN"],
    ["trade_licence", "Trade licence"],
    ["msme", "MSME / Udyam"],
    ["insurance", "Insurance policy"],
    ["vehicle", "Vehicle papers (RC, permit, PUC)"],
    ["contract", "Contract / agreement"],
    ["lease", "Rent / lease agreement"],
    ["other", "Other"],
  ],
  asset: [
    ["computer", "Computer / laptop"],
    ["phone", "Phone / tablet"],
    ["equipment", "Camera / equipment"],
    ["furniture", "Furniture / fittings"],
    ["vehicle", "Vehicle"],
    ["software", "Software licence"],
    ["other", "Other"],
  ],
  domain: [["domain", "Domain"]],
};

export const REGISTRARS = ["GoDaddy", "Hostinger", "BigRock", "Namecheap", "Google / Squarespace", "Cloudflare", "ResellerClub", "Znetlive"];

export function categoryLabel(kind: string, key: string) {
  return CATEGORIES[kind as Kind]?.find(([k]) => k === key)?.[1] ?? "Other";
}

// The labels the form and list use for the shared columns.
export const LABELS: Record<Kind, { reference: string; issuedBy: string; issue: string; expiry: string; amount: string }> = {
  document: { reference: "Document number", issuedBy: "Issued by", issue: "Issue date", expiry: "Expiry date", amount: "Fee paid (₹)" },
  asset: { reference: "Serial / tag number", issuedBy: "Bought from", issue: "Purchase date", expiry: "Warranty / insurance / service due", amount: "Price (₹)" },
  domain: { reference: "Account / customer ID", issuedBy: "Registrar", issue: "Registered on", expiry: "Renewal date", amount: "Yearly cost (₹)" },
};

// Today in India as YYYY-MM-DD, so the day flips at local midnight.
export function today() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export function daysUntil(d: string) {
  return Math.round((Date.parse(d) - Date.parse(today())) / 86_400_000);
}

export type Due = { label: string; date: string; days: number };

// Every date on an item that can lapse, soonest first.
export function dueDates(r: CompanyRecord): Due[] {
  const list: [string, string | null][] = [[LABELS[r.kind as Kind]?.expiry ?? "Expiry", r.expiry_date]];
  if (r.kind === "domain") list.push(["Hosting", r.hosting_expiry], ["SSL", r.ssl_expiry]);
  return list
    .filter((x): x is [string, string] => !!x[1])
    .map(([label, date]) => ({ label, date, days: daysUntil(date) }))
    .sort((a, b) => a.days - b.days);
}

export type State = "expired" | "soon" | "ok" | "none" | "closed";

export function stateOf(r: CompanyRecord): { state: State; text: string; next: Due | null } {
  if (r.status === "closed") return { state: "closed", text: "Closed", next: null };
  const next = dueDates(r)[0] ?? null;
  if (!next) return { state: "none", text: "No expiry", next };
  const autoOnly = r.kind === "domain" && r.auto_renew && next.label === LABELS.domain.expiry;
  if (next.days < 0) return { state: "expired", text: autoOnly ? "Check renewal" : `Expired ${-next.days}d ago`, next };
  if (next.days === 0) return { state: "soon", text: "Expires today", next };
  if (next.days <= 30) return { state: "soon", text: autoOnly ? `Auto-renews in ${next.days}d` : `${next.days} days left`, next };
  return { state: "ok", text: autoOnly ? "Auto-renew on" : "Valid", next };
}

export const STATE_TONE: Record<State, string> = {
  expired: "bg-red-50 text-red-700 ring-1 ring-red-200",
  soon: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
  ok: "bg-brand-50 text-brand-700 ring-1 ring-brand-200",
  none: "bg-slate-100 text-slate-600",
  closed: "bg-slate-100 text-slate-500",
};
