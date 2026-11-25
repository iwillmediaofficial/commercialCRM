import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import type { Json } from "../../../lib/database.types";
import { toKey } from "./leadShared";

// Quick-check questions: a short list each company can edit (Settings), answered
// with one tap per lead on the Follow-ups page. Answers are stored on the lead as
// { question key: chosen option }.

export type LeadQuestion = { key: string; label: string; options: string[]; show_in_list?: boolean };
export type Answers = Record<string, string>;

export const MAX_QUESTIONS = 10;
export const MAX_OPTIONS = 6;

export const DEFAULT_QUESTIONS: LeadQuestion[] = [
  { key: "genuine", label: "Genuine lead?", options: ["Yes", "No", "Not sure"] },
  { key: "details_sent", label: "Details sent?", options: ["Yes", "No"] },
  { key: "interest", label: "Interest", options: ["Hot", "Warm", "Cold"], show_in_list: true },
];

export function parseQuestions(v: Json | null | undefined): LeadQuestion[] {
  if (!Array.isArray(v)) return DEFAULT_QUESTIONS;
  const out: LeadQuestion[] = [];
  for (const q of v) {
    if (!q || typeof q !== "object" || Array.isArray(q)) continue;
    const r = q as Record<string, unknown>;
    const label = typeof r.label === "string" ? r.label.trim() : "";
    const options = Array.isArray(r.options) ? r.options.filter((o): o is string => typeof o === "string" && !!o.trim()) : [];
    if (!label || !options.length) continue;
    out.push({ key: typeof r.key === "string" && r.key ? r.key : toKey(label), label, options, show_in_list: r.show_in_list === true });
  }
  return out;
}

export function parseAnswers(v: Json | null | undefined): Answers {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === "string")) as Answers;
}

// Colour for an answer, so Yes/No and Hot/Warm/Cold read at a glance.
const GOOD = ["yes", "done", "interested", "high"];
const BAD = ["no", "not interested", "fake", "spam"];
const HOT = ["hot", "very interested", "urgent"];
const WARM = ["warm", "medium", "maybe", "not sure"];
export function answerTone(option: string): { on: string; chip: string } {
  const o = option.trim().toLowerCase();
  if (GOOD.includes(o)) return { on: "bg-green-600 text-white ring-green-600", chip: "bg-green-100 text-green-800" };
  if (HOT.includes(o)) return { on: "bg-red-600 text-white ring-red-600", chip: "bg-red-100 text-red-700" };
  if (BAD.includes(o)) return { on: "bg-slate-600 text-white ring-slate-600", chip: "bg-slate-200 text-slate-700" };
  if (WARM.includes(o)) return { on: "bg-amber-500 text-white ring-amber-500", chip: "bg-amber-100 text-amber-800" };
  return { on: "bg-brand-600 text-white ring-brand-600", chip: "bg-brand-100 text-brand-800" };
}

export function useLeadQuestions(workspaceId: string) {
  const [questions, setQuestions] = useState<LeadQuestion[]>(DEFAULT_QUESTIONS);
  const load = useCallback(async () => {
    const { data } = await supabase.from("workspace_settings").select("lead_questions").eq("workspace_id", workspaceId).maybeSingle();
    if (data) setQuestions(parseQuestions(data.lead_questions));
  }, [workspaceId]);
  useEffect(() => {
    load();
  }, [load]);
  return questions;
}

// "Interest: Warm → Hot; Details sent?: Yes"
export function describeAnswerChange(from: Answers, to: Answers, questions: LeadQuestion[]) {
  const keys = [...new Set([...Object.keys(from), ...Object.keys(to)])];
  const label = (k: string) => questions.find((q) => q.key === k)?.label ?? k.replace(/_/g, " ");
  const parts = keys
    .filter((k) => from[k] !== to[k])
    .map((k) => (to[k] ? (from[k] ? `${label(k)} ${from[k]} → ${to[k]}` : `${label(k)} ${to[k]}`) : `${label(k)} cleared`));
  return parts.length ? `Quick check: ${parts.join("; ")}` : "Quick check updated";
}
