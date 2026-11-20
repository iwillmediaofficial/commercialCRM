import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { supabase, type Tables } from "../../../lib/supabase";
import { useWorkspace } from "../../../lib/workspace";
import { Alert, Button, Card, Field, Input, Select, Spinner, Textarea } from "../../../components/ui";

// WhatsApp AI assistant settings: what the assistant knows about the company,
// what it should ask, and when it hands a chat to a person. Admins only.

type Settings = Tables<"wa_ai_settings">;
type Usage = Tables<"wa_ai_usage">;

const TEXT = ["assistant_name", "greeting", "about", "products", "faqs", "contact_hours", "policies", "questions", "handoff_words"] as const;
type TextKey = (typeof TEXT)[number];
type Form = Record<TextKey, string> & { enabled: boolean; tone: string };

const EMPTY: Form = {
  enabled: false, tone: "friendly", assistant_name: "", greeting: "", about: "", products: "", faqs: "",
  contact_hours: "", policies: "", questions: "", handoff_words: "call me, manager, human, real person, complaint, refund",
};

const LIMITS: Record<TextKey, number> = {
  assistant_name: 60, greeting: 500, about: 4000, products: 8000, faqs: 8000, contact_hours: 2000, policies: 4000,
  questions: 2000, handoff_words: 500,
};

function toForm(s: Settings | null): Form {
  if (!s) return EMPTY;
  const f = { ...EMPTY, enabled: s.enabled, tone: s.tone };
  for (const k of TEXT) f[k] = (s[k] as string | null) ?? "";
  return f;
}

async function errorText(error: unknown, fallback: string) {
  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const b = await ctx.json();
      if (b?.message) return String(b.message);
    } catch {
      /* fall through */
    }
  }
  return fallback;
}

export default function AssistantSettings() {
  const { workspace, isAdmin, canWrite } = useWorkspace();
  const [row, setRow] = useState<Settings | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      const month = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).slice(0, 7) + "-01";
      const [{ data: s, error: e }, { data: u }] = await Promise.all([
        supabase.from("wa_ai_settings").select("*").eq("workspace_id", workspace.id).maybeSingle(),
        supabase.from("wa_ai_usage").select("*").eq("workspace_id", workspace.id).eq("month", month).maybeSingle(),
      ]);
      if (e) setError(e.message);
      setRow(s);
      setForm(toForm(s));
      setUsage(u);
    })();
  }, [workspace.id, isAdmin]);

  if (!isAdmin) return <Alert tone="info">Only the company's owner and admins can change the WhatsApp assistant.</Alert>;
  if (!form) return <Spinner />;

  const set = (k: keyof Form, v: string | boolean) => {
    setSaved(false);
    setForm({ ...form, [k]: v });
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    if (form.enabled && !form.about.trim() && !form.products.trim()) {
      setError("Add something about the company or its products first, so the assistant has something to answer from.");
      return;
    }
    setSaving(true);
    setError("");
    const values = {
      workspace_id: workspace.id,
      enabled: form.enabled,
      tone: form.tone,
      ...Object.fromEntries(TEXT.map((k) => [k, form[k].trim() || null])),
      handoff_words: form.handoff_words.trim() || EMPTY.handoff_words,
    };
    const { data, error } = await supabase.from("wa_ai_settings").upsert(values).select("*").single();
    setSaving(false);
    if (error) return setError(error.message);
    setRow(data);
    setSaved(true);
  }

  const limit = row?.monthly_chat_limit ?? 500;
  const readOnly = !canWrite;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to={`/w/${workspace.slug}/whatsapp`} className="text-sm text-slate-500 hover:text-slate-700">← WhatsApp</Link>
          <h1 className="text-xl font-semibold">WhatsApp AI assistant</h1>
          <p className="text-sm text-slate-500">
            The assistant answers new WhatsApp chats from what you write here, asks your questions, and hands the chat to your team when it should.
            Its replies don't count as your team contacting the lead.
          </p>
        </div>
        <div className="rounded-lg bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-slate-200/70">
          <span className="font-semibold">{usage?.chats ?? 0}</span> of {limit} AI chats used this month
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <form onSubmit={save} className="space-y-4">
          <Card title="Switch on">
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-1 h-4 w-4" checked={form.enabled} disabled={readOnly}
                onChange={(e) => set("enabled", e.target.checked)} />
              <span className="text-sm">
                <span className="font-semibold">AI replies for new chats</span>
                <span className="block text-slate-500">
                  New chats start with the assistant. Staff can take over any chat, and the assistant goes quiet as soon as someone from your team replies.
                </span>
              </span>
            </label>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="Assistant's name" hint="How it introduces itself, e.g. 'Riya from Sunrise Interiors'.">
                <Input value={form.assistant_name} maxLength={LIMITS.assistant_name} disabled={readOnly}
                  onChange={(e) => set("assistant_name", e.target.value)} />
              </Field>
              <Field label="Tone">
                <Select value={form.tone} disabled={readOnly} onChange={(e) => set("tone", e.target.value)}>
                  <option value="friendly">Friendly</option>
                  <option value="formal">Formal</option>
                </Select>
              </Field>
            </div>
          </Card>

          <Card title="What the assistant knows">
            <div className="space-y-3">
              <Area f={form} k="about" label="About the company" hint="What you do, where you are, what makes you different." set={set} readOnly={readOnly} rows={4} />
              <Area f={form} k="products" label="Products and services, with prices" hint="One per line is fine. The assistant never quotes a price that isn't written here." set={set} readOnly={readOnly} rows={6} />
              <Area f={form} k="faqs" label="Common questions and answers" hint="e.g. Q: Do you deliver? A: Yes, free within the city." set={set} readOnly={readOnly} rows={5} />
              <Area f={form} k="contact_hours" label="Hours, address and contact" set={set} readOnly={readOnly} rows={3} />
              <Area f={form} k="policies" label="Policies" hint="Payment, delivery, returns, warranty." set={set} readOnly={readOnly} rows={3} />
            </div>
          </Card>

          <Card title="Conversation">
            <div className="space-y-3">
              <Area f={form} k="greeting" label="First greeting" hint="Used when a customer just says hi." set={set} readOnly={readOnly} rows={2} />
              <Area f={form} k="questions" label="Questions to ask, one per line"
                hint="e.g. Which city are you in? / What is your budget? Answers are saved on the lead." set={set} readOnly={readOnly} rows={4} />
              <Area f={form} k="handoff_words" label="Hand the chat to a person when the customer says"
                hint="Comma separated. The assistant also hands over when the customer is ready to buy, is unhappy, or asks something it can't answer." set={set} readOnly={readOnly} rows={2} />
            </div>
          </Card>

          {error && <Alert>{error}</Alert>}
          {saved && <Alert tone="success">Saved.</Alert>}
          {!readOnly && <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>}
        </form>

        <TestBox workspaceId={workspace.id} saved={!!row} dirty={!saved && JSON.stringify(toForm(row)) !== JSON.stringify(form)} />
      </div>
    </div>
  );
}

function Area({ f, k, label, hint, set, readOnly, rows }: {
  f: Form; k: TextKey; label: string; hint?: string; set: (k: keyof Form, v: string) => void; readOnly: boolean; rows: number;
}) {
  return (
    <Field label={label} hint={hint}>
      <Textarea rows={rows} value={f[k]} maxLength={LIMITS[k]} disabled={readOnly} onChange={(e) => set(k, e.target.value)} />
    </Field>
  );
}

type Turn = { sender: "customer" | "ai"; body: string; note?: string };

function TestBox({ workspaceId, saved, dirty }: { workspaceId: string; saved: boolean; dirty: boolean }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [learned, setLearned] = useState<{ name: string; answers: Record<string, string>; summary: string } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [turns.length]);

  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    const next: Turn[] = [...turns, { sender: "customer", body }];
    setTurns(next);
    setText("");
    setBusy(true);
    setError("");
    const { data, error } = await supabase.functions.invoke("whatsapp-ai-test", {
      body: { workspace_id: workspaceId, messages: next.map(({ sender, body }) => ({ sender, body })) },
    });
    setBusy(false);
    if (!data?.ok) return setError(data?.message ?? (await errorText(error, "The assistant didn't answer. Try again.")));
    const note = data.handoff ? `Hands the chat to your team: ${data.handoff_reason || "asked for a person"}` : undefined;
    setTurns([...next, { sender: "ai", body: data.reply || "(no reply)", note }]);
    setLearned({ name: data.customer_name ?? "", answers: data.answers ?? {}, summary: data.summary ?? "" });
  }

  return (
    <Card title="Test the assistant" actions={turns.length ? (
      <button className="text-xs font-semibold text-slate-500 hover:text-slate-700" onClick={() => { setTurns([]); setLearned(null); setError(""); }}>
        Start again
      </button>
    ) : undefined}>
      <p className="mb-3 text-xs text-slate-500">
        Type as if you were a customer. Nothing is sent on WhatsApp. Each test reply counts as AI use.
      </p>
      {!saved && <Alert tone="info">Save the settings first, then test them here.</Alert>}
      {saved && dirty && <div className="mb-2"><Alert tone="warning">You have unsaved changes. The test uses the saved settings.</Alert></div>}
      <div className="max-h-[50vh] min-h-[200px] space-y-2 overflow-y-auto rounded-lg bg-slate-50 p-3">
        {turns.map((t, i) => (
          <div key={i} className={`flex ${t.sender === "ai" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm shadow-sm ${t.sender === "ai" ? "bg-green-50 ring-1 ring-green-200" : "bg-white ring-1 ring-slate-200"}`}>
              <div className="whitespace-pre-wrap break-words">{t.body}</div>
              {t.note && <div className="mt-1 text-xs font-semibold text-amber-700">{t.note}</div>}
            </div>
          </div>
        ))}
        {busy && <div className="text-right text-xs text-slate-400">The assistant is typing…</div>}
        <div ref={bottom} />
      </div>
      {error && <div className="mt-2"><Alert>{error}</Alert></div>}
      <div className="mt-2 flex gap-2">
        <Input placeholder="Hi, do you have sofas?" value={text} disabled={!saved} maxLength={2000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); send(); } }} />
        <Button onClick={send} disabled={busy || !saved || !text.trim()}>Send</Button>
      </div>
      {learned && (learned.name || Object.keys(learned.answers).length > 0 || learned.summary) && (
        <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          <div className="mb-1 font-semibold text-slate-500">What would be saved on the lead</div>
          {learned.name && <div>Name: {learned.name}</div>}
          {Object.entries(learned.answers).map(([q, a]) => <div key={q}>{q}: {a}</div>)}
          {learned.summary && <div className="mt-1 italic">{learned.summary}</div>}
        </div>
      )}
    </Card>
  );
}
