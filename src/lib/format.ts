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
  const v = Number(n ?? 0);
  const text = `₹${Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  return v < 0 ? `-${text}` : text;
}

// Money still to collect; a negative balance means the client paid ahead.
export function toCollectLabel(n: number) {
  return n < 0 ? `${inr(-n)} advance` : inr(n);
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

// Indian states and union territories with their GST state codes.
export const INDIAN_STATES: [string, string][] = [
  ["Andaman and Nicobar Islands", "35"],
  ["Andhra Pradesh", "37"],
  ["Arunachal Pradesh", "12"],
  ["Assam", "18"],
  ["Bihar", "10"],
  ["Chandigarh", "04"],
  ["Chhattisgarh", "22"],
  ["Dadra and Nagar Haveli and Daman and Diu", "26"],
  ["Delhi", "07"],
  ["Goa", "30"],
  ["Gujarat", "24"],
  ["Haryana", "06"],
  ["Himachal Pradesh", "02"],
  ["Jammu and Kashmir", "01"],
  ["Jharkhand", "20"],
  ["Karnataka", "29"],
  ["Kerala", "32"],
  ["Ladakh", "38"],
  ["Lakshadweep", "31"],
  ["Madhya Pradesh", "23"],
  ["Maharashtra", "27"],
  ["Manipur", "14"],
  ["Meghalaya", "17"],
  ["Mizoram", "15"],
  ["Nagaland", "13"],
  ["Odisha", "21"],
  ["Puducherry", "34"],
  ["Punjab", "03"],
  ["Rajasthan", "08"],
  ["Sikkim", "11"],
  ["Tamil Nadu", "33"],
  ["Telangana", "36"],
  ["Tripura", "16"],
  ["Uttar Pradesh", "09"],
  ["Uttarakhand", "05"],
  ["West Bengal", "19"],
];

// Amount in words with Indian numbering (lakh, crore), e.g. "Rupees One Thousand and Fifty Paise Only".
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function twoDigits(n: number) {
  return n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "");
}
function indianWords(n: number): string {
  if (n === 0) return "";
  const crore = Math.floor(n / 1e7);
  const lakh = Math.floor(n / 1e5) % 100;
  const thousand = Math.floor(n / 1000) % 100;
  const hundred = Math.floor(n / 100) % 10;
  const rest = n % 100;
  return [
    crore ? indianWords(crore) + " Crore" : "",
    lakh ? twoDigits(lakh) + " Lakh" : "",
    thousand ? twoDigits(thousand) + " Thousand" : "",
    hundred ? ONES[hundred] + " Hundred" : "",
    rest ? twoDigits(rest) : "",
  ].filter(Boolean).join(" ");
}
export function rupeesInWords(amount: number) {
  const paiseTotal = Math.round(Math.abs(amount) * 100);
  const rupees = Math.floor(paiseTotal / 100);
  const paise = paiseTotal % 100;
  const r = `Rupees ${rupees ? indianWords(rupees) : "Zero"}`;
  return paise ? `${r} and ${twoDigits(paise)} Paise Only` : `${r} Only`;
}
