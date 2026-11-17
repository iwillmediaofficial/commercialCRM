import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "../../../lib/supabase";
import { useAuth } from "../../../lib/auth";
import { useWorkspace } from "../../../lib/workspace";
import { Alert, Button, Modal, Textarea } from "../../../components/ui";
import { OUTCOMES } from "./LeadTimeline";
import { QUICK_PICKS, fromLocalInput, toLocalInput, whenLabel } from "./followUp";
import type { Lead } from "./LeadModal";

// Tapping Call or WhatsApp anywhere logs the contact straight away (so it counts
// as contact and the lead isn't passed on), then asks "How did it go?" so the
// outcome, a note and the next follow-up can be added in one go.

type ContactKind = "call" | "whatsapp";
export type ContactLead = { id: string; name: string };
type LeadPatch = Partial<Pick<Lead, "stage" | "follow_up_at" | "follow_up_date" | "last_remark" | "last_remark_at" | "first_contacted_at" | "last_contacted_at">>;
type OnChange = (patch: LeadPatch) => void;

type Pending = { activityId: string; kind: ContactKind; lead: ContactLead; at: number };

type Ctx = { logContact: (lead: ContactLead, kind: ContactKind, onChange?: OnChange) => void };
const ContactContext = createContext<Ctx>({ logContact: () => {} });

export function useContactLog() {
  return useContext(ContactContext);
}

const LEAD_FIELDS = "stage, follow_up_at, follow_up_date, last_remark, last_remark_at, first_contacted_at, last_contacted_at";
const DAY = 24 * 3600 * 1000;

function storeKey(ws: string) {
  return `contact-prompt:${ws}`;
}
function readStored(ws: string): Pending | null {
  try {
    const raw = sessionStorage.getItem(storeKey(ws));
    if (!raw) return null;
    const p = JSON.parse(raw) as Pending;
    return p && p.activityId && Date.now() - p.at < DAY ? p : null;
  } catch {
    return null;
  }
}
function writeStored(ws: string, p: Pending | null) {
  try {
    if (p) sessionStorage.setItem(storeKey(ws), JSON.stringify(p));
    else sessionStorage.removeItem(storeKey(ws));
  } catch {
    // Private mode or blocked storage: the prompt just won't survive a reload.
  }
}

export function ContactLogProvider({ children }: { children: ReactNode }) {
  const { workspace, canWrite } = useWorkspace();
  const { session } = useAuth();
  const me = session?.user.id ?? "";
  const [pending, setPending] = useState<Pending | null>(() => readStored(workspace.id));
  const [error, setError] = useState("");
  const callbacks = useRef(new Map<string, OnChange>());

  const show = useCallback(
    (p: Pending | null) => {
      writeStored(workspace.id, p);
      setPending(p);
    },
    [workspace.id],
  );

  const freshLead = useCallback(async (leadId: string) => {
    const { data } = await supabase.from("leads").select(LEAD_FIELDS).eq("id", leadId).maybeSingle();
    return data;
  }, []);

  const logContact = useCallback(
    (lead: ContactLead, kind: ContactKind, onChange?: OnChange) => {
      if (!canWrite || !me) return;
      // A second tap on the same lead within two minutes reuses the entry.
      if (pending && pending.lead.id === lead.id && pending.kind === kind && Date.now() - pending.at < 120_000) {
        if (onChange) callbacks.current.set(pending.activityId, onChange);
        return;
      }
      setError("");
      (async () => {
        const { data, error } = await supabase
          .from("lead_activities")
          .insert({ workspace_id: workspace.id, lead_id: lead.id, kind, created_by: me })
          .select("id")
          .single();
        if (error) {
          setError(`The ${kind === "call" ? "call" : "WhatsApp"} wasn't logged: ${error.message}`);
          return;
        }
        if (onChange) callbacks.current.set(data.id, onChange);
        show({ activityId: data.id, kind, lead: { id: lead.id, name: lead.name }, at: Date.now() });
        // Logging it can move a New lead to Contacted: let the screen know.
        const fresh = await freshLead(lead.id);
        if (fresh) onChange?.(fresh);
      })();
    },
    [canWrite, me, pending, workspace.id, show, freshLead],
  );

  function close() {
    if (pending) callbacks.current.delete(pending.activityId);
    show(null);
  }

  return (
    <ContactContext.Provider value={{ logContact }}>
      {children}
      {error && !pending && (
        <div className="fixed bottom-4 left-1/2 z-50 w-[min(28rem,calc(100%-2rem))] -translate-x-1/2">
          <Alert>
            <div className="flex items-start justify-between gap-3">
              <span>{error}</span>
              <button className="text-xs font-semibold underline" onClick={() => setError("")}>Dismiss</button>
            </div>
          </Alert>
        </div>
      )}
      {pending && (
        <HowDidItGo
          key={pending.activityId}
          pending={pending}
          loadLead={freshLead}
          onClose={close}
          onSaved={(patch) => {
            callbacks.current.get(pending.activityId)?.(patch);
            close();
          }}
        />
      )}
    </ContactContext.Provider>
  );
}

function HowDidItGo({
  pending,
  loadLead,
  onClose,
  onSaved,
}: {
  pending: Pending;
  loadLead: (id: string) => Promise<LeadPatch | null>;
  onClose: () => void;
  onSaved: (patch: LeadPatch) => void;
}) {
  const [lead, setLead] = useState<LeadPatch | null>(null);
  const [outcome, setOutcome] = useState("");
  const [body, setBody] = useState("");
  const [next, setNext] = useState<string | null>(null); // keep | quick pick key | custom | clear
  const [custom, setCustom] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isCall = pending.kind === "call";
  const what = isCall ? "call" : "WhatsApp";

  useEffect(() => {
    loadLead(pending.lead.id).then((l) => {
      setLead(l);
      // Nothing scheduled yet: suggest tomorrow.
      setNext((n) => n ?? (l?.follow_up_at ? "keep" : "tomorrow"));
    });
  }, [loadLead, pending.lead.id]);

  const closed = lead?.stage === "won" || lead?.stage === "lost";
  const followUpAt = lead?.follow_up_at ?? null;
  const loggedAt = new Date(pending.at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

  async function save() {
    setError("");
    let nextAt: string | null | undefined; // undefined = leave as is
    if (!closed && next === "clear") nextAt = null;
    else if (!closed && next === "custom") {
      if (!custom) return setError("Pick the date and time of the next follow-up.");
      nextAt = fromLocalInput(custom);
    } else if (!closed && next && next !== "keep") nextAt = QUICK_PICKS.find((q) => q.key === next)?.at();
    setBusy(true);
    if (outcome || body.trim()) {
      const { data, error } = await supabase
        .from("lead_activities")
        .update({ outcome: outcome || null, body: body.trim() || null })
        .eq("id", pending.activityId)
        .select("id");
      if (error || !data?.length) {
        setBusy(false);
        return setError(error ? error.message : "This entry can no longer be changed. Add a new one from the lead's timeline.");
      }
    }
    if (nextAt !== undefined) {
      const { error } = await supabase.from("leads").update({ follow_up_at: nextAt }).eq("id", pending.lead.id);
      if (error) {
        setBusy(false);
        return setError(`Saved, but the follow-up wasn't changed: ${error.message}`);
      }
    }
    const fresh = await loadLead(pending.lead.id);
    setBusy(false);
    onSaved(fresh ?? {});
  }

  return (
    <Modal title={`How did the ${what} with ${pending.lead.name} go?`} onClose={onClose}>
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <p className="text-xs text-slate-500">
          The {what} was logged at {loggedAt} and already counts as contact. Add how it went, or skip.
        </p>

        <div className="space-y-1.5">
          <div className="text-xs font-medium text-slate-600">How did it go?</div>
          <div className="flex flex-wrap gap-1.5">
            {OUTCOMES.map(([k, l]) => (
              <button
                key={k}
                type="button"
                onClick={() => setOutcome(outcome === k ? "" : k)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 ${outcome === k ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        <Textarea
          rows={2}
          maxLength={5000}
          placeholder="Optional note, e.g. wants a quote by Friday"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />

        {lead && !closed && (
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-slate-600">
              Next follow-up <span className="font-normal text-slate-500">(now: {followUpAt ? whenLabel(followUpAt) : "none"})</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[
                ...(followUpAt ? [{ key: "keep", label: "Keep as is" }] : []),
                ...QUICK_PICKS,
                { key: "custom", label: "Pick date & time" },
                ...(followUpAt ? [{ key: "clear", label: "No follow-up" }] : [{ key: "keep", label: "No follow-up" }]),
              ].map((o) => (
                <button
                  key={o.key + o.label}
                  type="button"
                  onClick={() => {
                    setNext(o.key);
                    if (o.key === "custom" && !custom) setCustom(toLocalInput(followUpAt ?? QUICK_PICKS[1].at()));
                  }}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${next === o.key ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {next === "custom" && (
              <input
                type="datetime-local"
                className="block rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
              />
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Skip</Button>
          <Button type="button" disabled={busy || !lead} onClick={save}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </Modal>
  );
}
