import type { Database } from "./database.types";

export type BillingPeriod = Database["public"]["Enums"]["billing_period"];
export type PaymentMode = Database["public"]["Enums"]["payment_mode"];

export const PERIODS: [BillingPeriod, string][] = [
  ["monthly", "1 month"],
  ["quarterly", "3 months"],
  ["half_yearly", "6 months"],
  ["yearly", "1 year"],
];
export const PERIOD_LABEL = Object.fromEntries(PERIODS) as Record<BillingPeriod, string>;

export const MODES: [PaymentMode, string][] = [
  ["bank_transfer", "Bank transfer / NEFT"],
  ["upi", "UPI"],
  ["cheque", "Cheque"],
  ["cash", "Cash"],
  ["other", "Other"],
];
export const MODE_LABEL = Object.fromEntries(MODES) as Record<PaymentMode, string>;

// Optional modules a plan can switch on; the rest are always on.
export const MODULES: ["leads" | "work" | "invoicing" | "ad_funds", string][] = [
  ["leads", "Leads"],
  ["work", "Work items"],
  ["invoicing", "Invoicing and recurring billing"],
  ["ad_funds", "Ad funds"],
];

export function inr(n: number | string | null | undefined) {
  return `₹${Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function date(d: string | null | undefined) {
  return d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
}

export function daysLeft(until: string) {
  return Math.ceil((new Date(until).getTime() - Date.now()) / 86_400_000);
}

// Downloads rows as a CSV file Excel opens directly.
export function downloadCsv(filename: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
