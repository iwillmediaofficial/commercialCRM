import { useState } from "react";
import { supabase } from "../../../lib/supabase";
import type { Json } from "../../../lib/database.types";
import { Alert, Button, Card, Input } from "../../../components/ui";
import { toKey } from "../leads/leadShared";
import { DEFAULT_QUESTIONS, MAX_OPTIONS, MAX_QUESTIONS, parseQuestions, type LeadQuestion } from "../leads/leadQuestions";

// Owners edit the quick-check questions staff answer on the Follow-ups page.

type Draft = { key: string; label: string; options: string; show_in_list: boolean };
const toDraft = (q: LeadQuestion): Draft => ({ key: q.key, label: q.label, options: q.options.join(", "), show_in_list: !!q.show_in_list });

export default function LeadQuestionsEditor({ workspaceId, initial, readOnly }: { workspaceId: string; initial: Json; readOnly: boolean }) {
  const [rows, setRows] = useState<Draft[]>(() => parseQuestions(initial).map(toDraft));
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const change = (i: number, patch: Partial<Draft>) => {
    setSaved(false);
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };
  const move = (i: number, d: number) => {
    setSaved(false);
    setRows((rs) => {
      const out = [...rs];
      const [x] = out.splice(i, 1);
      out.splice(i + d, 0, x);
      return out;
    });
  };

  async function save() {
    setError("");
    setSaved(false);
    const used = new Set<string>();
    const out: LeadQuestion[] = [];
    for (const [i, r] of rows.entries()) {
      const label = r.label.trim();
      const options = [...new Set(r.options.split(",").map((o) => o.trim()).filter(Boolean))];
      if (!label) return setError(`Question ${i + 1} needs a name.`);
      if (label.length > 60) return setError(`"${label}" is too long. Keep questions under 60 characters.`);
      if (options.length < 2) return setError(`"${label}" needs at least 2 answers, separated by commas.`);
      if (options.length > MAX_OPTIONS) return setError(`"${label}" can have at most ${MAX_OPTIONS} answers.`);
      if (options.some((o) => o.length > 30)) return setError(`Keep each answer of "${label}" under 30 characters.`);
      // Existing questions keep their key so earlier answers still match.
      let key = r.key || toKey(label) || `q${i + 1}`;
      let n = 2;
      while (used.has(key)) key = `${r.key || toKey(label)}_${n++}`;
      used.add(key);
      out.push({ key, label, options, ...(r.show_in_list ? { show_in_list: true } : {}) });
    }
    setSaving(true);
    const { error } = await supabase.from("workspace_settings").update({ lead_questions: out as unknown as Json }).eq("workspace_id", workspaceId);
    setSaving(false);
    if (error) return setError(error.message);
    setRows(out.map(toDraft));
    setSaved(true);
  }

  return (
    <Card title="Follow-up questions">
      <p className="-mt-2 mb-4 text-sm text-slate-500">
        Staff answer these with one tap when they follow up a lead. Tick "Show on list" to see that answer next to the lead's name.
      </p>
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={i} className="grid gap-2 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]">
            <Input aria-label={`Question ${i + 1}`} placeholder="Question, e.g. Budget confirmed?" maxLength={60} disabled={readOnly} value={r.label} onChange={(e) => change(i, { label: e.target.value })} />
            <Input aria-label={`Answers for question ${i + 1}`} placeholder="Answers, separated by commas" disabled={readOnly} value={r.options} onChange={(e) => change(i, { options: e.target.value })} />
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="inline-flex items-center gap-1.5 text-slate-700">
                <input type="checkbox" disabled={readOnly} checked={r.show_in_list} onChange={(e) => change(i, { show_in_list: e.target.checked })} />
                Show on list
              </label>
              {!readOnly && (
                <>
                  <button type="button" className="rounded px-1.5 text-slate-500 hover:bg-white disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                  <button type="button" className="rounded px-1.5 text-slate-500 hover:bg-white disabled:opacity-30" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                  <button type="button" className="font-medium text-red-600 hover:underline" onClick={() => { setSaved(false); setRows((rs) => rs.filter((_, j) => j !== i)); }}>Remove</button>
                </>
              )}
            </div>
          </div>
        ))}
        {!rows.length && <p className="text-sm text-slate-500">No questions. Staff will only see Contacted, Stage and the follow-up date.</p>}
      </div>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
      {saved && <div className="mt-3"><Alert tone="success">Questions saved.</Alert></div>}
      {!readOnly && (
        <div className="mt-4 flex flex-wrap justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" disabled={rows.length >= MAX_QUESTIONS} onClick={() => { setSaved(false); setRows((rs) => [...rs, { key: "", label: "", options: "Yes, No", show_in_list: false }]); }}>
              Add question
            </Button>
            <Button type="button" variant="secondary" onClick={() => { setSaved(false); setRows(DEFAULT_QUESTIONS.map(toDraft)); }}>
              Use the default questions
            </Button>
          </div>
          <Button type="button" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save questions"}</Button>
        </div>
      )}
    </Card>
  );
}
