// Ad fund maths. Pure functions only (no React, no Supabase), so every number
// on the Ad funds page comes from one place.
//
// All money is handled in whole paise (integers) internally so that sums never
// pick up floating point dust; values are converted back to rupees on output.
//
// A "month" is a "YYYY-MM" string.

export type PayerType = "company" | "personal" | "client" | "unused_fund";

export const PAYERS: [PayerType, string][] = [
  ["company", "Company account"],
  ["personal", "Personal payment"],
  ["client", "Paid by client"],
  ["unused_fund", "From unused fund"],
];
export const PAYER_LABEL = Object.fromEntries(PAYERS) as Record<PayerType, string>;

export type UploadLite = { client_id: string; amount: number; payer_type: string; upload_date: string };
export type CollectionLite = { client_id: string; amount: number; received_on: string };
export type AdjustmentLite = { client_id: string; amount: number; year_month: string };

export type MonthRow = {
  month: string;
  started: boolean; // false = before this client's ad fund ledger began (target not counted)
  target: number; // monthly ad target
  adjustments: number; // Original Fund (CRUD) entries dated this month
  previousUnused: number; // carryover coming into this month (incl. this month's adjustments)
  originalFund: number; // (target + previousUnused) - unused-fund uploads this month
  company: number;
  personal: number;
  client: number;
  unusedFund: number;
  totalSpent: number; // all four payer types
  fronted: number; // company + personal this month (agency cash put in)
  collected: number; // collections received this month
  toCollect: number; // outstanding agency cash at month end (all history)
  unusedThisMonth: number; // carried into next month
};

const p = (rupees: number | string | null | undefined) => Math.round(Number(rupees ?? 0) * 100);
const r = (paise: number) => paise / 100;

// "2026-10-16" or "2026-10-01" -> "2026-10"
export function monthOf(d: string) {
  return d.slice(0, 7);
}

export function currentMonth(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// Shift a month by n (n may be negative).
export function addMonths(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

// "2026-10" -> "2026-10-01" (the adjustments table stores the first day of the month).
export function firstDay(month: string) {
  return `${month}-01`;
}

export function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

// Month-by-month ledger for ONE client up to and including `until`.
// Inputs must already be filtered to that client.
// The ledger (and the monthly target) starts at the earlier of: the client's first
// upload or Original Fund entry, or `today` (the current calendar month). So a
// client with no history starts this month; use an opening balance entry to
// bring in money from before that.
export function clientLedger(
  monthlyTarget: number,
  uploads: UploadLite[],
  collections: CollectionLite[],
  adjustments: AdjustmentLite[],
  until: string,
  today: string = currentMonth(),
): MonthRow[] {
  const target = p(monthlyTarget);
  const spend = new Map<string, Record<PayerType, number>>();
  const adj = new Map<string, number>();
  const coll = new Map<string, number>();
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

  for (const u of uploads) {
    const k = monthOf(u.upload_date);
    const row = spend.get(k) ?? { company: 0, personal: 0, client: 0, unused_fund: 0 };
    const t = (u.payer_type in row ? u.payer_type : "company") as PayerType;
    row[t] += p(u.amount);
    spend.set(k, row);
  }
  for (const a of adjustments) add(adj, monthOf(a.year_month), p(a.amount));
  for (const c of collections) add(coll, monthOf(c.received_on), p(c.amount));

  // Fund start: first upload / Original Fund month, or this calendar month if earlier.
  // Before it nothing is carried and no target counts. To Collect also counts any
  // collection recorded earlier (an advance), so the loop starts at the earliest of all.
  const fundStart = [...spend.keys(), ...adj.keys(), today].sort()[0];
  const start = [...spend.keys(), ...adj.keys(), ...coll.keys(), until].sort()[0];

  const rows: MonthRow[] = [];
  let carry = 0; // unused carried out of the previous month (paise)
  let owed = 0; // running To Collect (paise)
  for (let m = start; m <= until; m = addMonths(m, 1)) {
    const s = spend.get(m) ?? { company: 0, personal: 0, client: 0, unused_fund: 0 };
    const active = m >= fundStart;
    const a = adj.get(m) ?? 0;
    const collected = coll.get(m) ?? 0;

    // Target only counts once the client's fund ledger has started.
    const tgt = active ? target : 0;
    // Previous unused = last month's unused + Original Fund entries for this month.
    const previousUnused = carry + a;
    // Original Fund = (monthly target + all previously unused) - this month's unused-fund uploads.
    const originalFund = tgt + previousUnused - s.unused_fund;
    // Total spent = every upload this month, whoever paid.
    const totalSpent = s.company + s.personal + s.client + s.unused_fund;
    // Unused this month = original fund - uploads not drawn from unused fund
    //                   = target + previous unused - total spent. Carries to next month.
    const unusedThisMonth = originalFund - (s.company + s.personal + s.client);
    // Fronted = agency cash put in (company + personal). Client-paid and unused-fund uploads never add.
    const fronted = s.company + s.personal;
    // To Collect = running (all fronted so far) - (all collected so far).
    owed += fronted - collected;

    rows.push({
      month: m,
      started: active,
      target: r(tgt),
      adjustments: r(a),
      previousUnused: r(previousUnused),
      originalFund: r(originalFund),
      company: r(s.company),
      personal: r(s.personal),
      client: r(s.client),
      unusedFund: r(s.unused_fund),
      totalSpent: r(totalSpent),
      fronted: r(fronted),
      collected: r(collected),
      toCollect: r(owed),
      unusedThisMonth: r(unusedThisMonth),
    });
    carry = unusedThisMonth;
  }
  return rows;
}

// The grid row for one client in one month (an empty month if the client has no history yet).
export function clientMonth(
  monthlyTarget: number,
  uploads: UploadLite[],
  collections: CollectionLite[],
  adjustments: AdjustmentLite[],
  month: string,
): MonthRow {
  const rows = clientLedger(monthlyTarget, uploads, collections, adjustments, month);
  return rows[rows.length - 1]; // always the row for `month`
}

function emptyRow(month: string): MonthRow {
  return {
    month, started: true, target: 0, adjustments: 0, previousUnused: 0, originalFund: 0,
    company: 0, personal: 0, client: 0, unusedFund: 0, totalSpent: 0,
    fronted: 0, collected: 0, toCollect: 0, unusedThisMonth: 0,
  };
}

// Column totals for the grid. Every column is a plain sum across clients.
export function totalRow(rows: MonthRow[], month: string): MonthRow {
  const keys: (keyof MonthRow)[] = [
    "target", "adjustments", "previousUnused", "originalFund", "company", "personal", "client",
    "unusedFund", "totalSpent", "fronted", "collected", "toCollect", "unusedThisMonth",
  ];
  const out = emptyRow(month) as unknown as Record<string, number | string | boolean>;
  for (const k of keys) out[k] = r(rows.reduce((s, x) => s + p(x[k] as number), 0));
  return out as unknown as MonthRow;
}
