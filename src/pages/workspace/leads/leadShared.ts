import type { Json } from "../../../lib/database.types";

export type Stage = "new" | "contacted" | "qualified" | "proposal_sent" | "won" | "lost";

export const STAGES: { key: Stage; label: string; tone: string; bar: string }[] = [
  { key: "new", label: "New lead", tone: "bg-sky-100 text-sky-800", bar: "border-sky-400" },
  { key: "contacted", label: "Contacted", tone: "bg-violet-100 text-violet-800", bar: "border-violet-400" },
  { key: "qualified", label: "Qualified", tone: "bg-amber-100 text-amber-800", bar: "border-amber-400" },
  { key: "proposal_sent", label: "Proposal sent", tone: "bg-indigo-100 text-indigo-800", bar: "border-indigo-400" },
  { key: "won", label: "Won", tone: "bg-green-100 text-green-800", bar: "border-green-500" },
  { key: "lost", label: "Lost", tone: "bg-slate-200 text-slate-700", bar: "border-slate-400" },
];

export const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.key, s.label])) as Record<Stage, string>;
export const STAGE_TONE = Object.fromEntries(STAGES.map((s) => [s.key, s.tone])) as Record<Stage, string>;

export const SOURCES = ["Meta Ads", "Website", "Referral", "Cold Call", "Lead form", "Other"];

// Custom questions on a public lead form, stored in lead_forms.fields.
// Name, phone and email are always asked and are not part of this list.
export type FieldType = "text" | "textarea" | "select" | "number" | "email" | "phone";
export type FormField = { key: string; label: string; type: FieldType; required?: boolean; options?: string[] };

export const FIELD_TYPES: [FieldType, string][] = [
  ["text", "Short answer"],
  ["textarea", "Long answer"],
  ["select", "Pick from a list"],
  ["number", "Number"],
  ["email", "Email"],
  ["phone", "Phone number"],
];

export function parseFields(v: Json | null | undefined): FormField[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((f): f is Record<string, Json> => !!f && typeof f === "object" && !Array.isArray(f))
    .map((f) => ({
      key: String(f.key ?? ""),
      label: String(f.label ?? f.key ?? ""),
      type: (FIELD_TYPES.some(([t]) => t === f.type) ? f.type : "text") as FieldType,
      required: f.required === true,
      options: Array.isArray(f.options) ? f.options.map(String) : undefined,
    }))
    .filter((f) => f.key);
}

export function toKey(label: string) {
  return label.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
}

export function toSlug(text: string) {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

export const SLUG_RE = /^[a-z0-9]([a-z0-9-]{1,62}[a-z0-9])?$/;

export function humanize(key: string) {
  const s = key.replace(/[_-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Picks black or white text for a background colour so buttons stay readable.
export function textOn(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#fff";
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.65 ? "#0f172a" : "#fff";
}

export function safeColor(c: string | null | undefined) {
  return c && /^#[0-9a-f]{6}$/i.test(c.trim()) ? c.trim() : null;
}
