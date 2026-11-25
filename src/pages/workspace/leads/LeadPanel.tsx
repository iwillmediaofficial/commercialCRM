import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { supabase } from "../../../lib/supabase";
import { useWorkspace } from "../../../lib/workspace";
import { nameOf, type Person } from "../../../lib/members";
import { Alert, Badge, Spinner, Textarea } from "../../../components/ui";
import { STAGES, STAGE_LABEL, STAGE_TONE, formAnswerList, humanize, type Stage } from "./leadShared";
import { LOST_REASONS, QUICK_PICKS, followUpState, followUpTone, fromLocalInput, telLink, toLocalInput, waLink, whenLabel } from "./followUp";
import { useContactLog } from "./ContactPrompt";
import LeadTimeline from "./LeadTimeline";
import { originLabel, useLeadOrigins } from "./leadOrigins";
import type { Lead } from "./LeadModal";
import { answerTone, parseAnswers, type Answers, type LeadQuestion } from "./leadQuestions";

// The right-hand side of the Follow-ups desk: everything needed to work one lead,
// then "Save and open next lead".

type Props = {
  leadId: string;
  questions: LeadQuestion[];
  people: Person[];
  me: string;
  hasNext: boolean;
  onSaved: (leadId: string) => void;
  onBack: () => void;
  // Inside the lead drawer: the drawer shows the name and has Details / Timeline tabs,
  // so "Full details" switches tab and the history lives on the Timeline tab.
  inDrawer?: boolean;
  onFullDetails?: () => void;
};

const CONTACT_KINDS = ["call", "whatsapp", "meeting"];

export default function LeadPanel({ leadId, questions, people, me, hasNext, onSaved, onBack, inDrawer, onFullDetails }: Props) {
  const { workspace, isAdmin, canWrite } = useWorkspace();
  const origins = useLeadOrigins(workspace.id);
  const { logContact } = useContactLog();
  const [lead, setLead] = useState<Lead | null>(null);
  const [contacts, setContacts] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // What the person is changing; saved together.
  const [answers, setAnswers] = useState<Answers>({});
  const [stage, setStage] = useState<Stage>("new");
  const [lostReason, setLostReason] = useState("");
  const [remark, setRemark] = useState("");
  const [pick, setPick] = useState(""); // quick pick key, "custom", or "" = keep
  const [custom, setCustom] = useState("");
  const [assigned, setAssigned] = useState("");

  const countContacts = useCallback(async () => {
    const { count } = await supabase
      .from("lead_activities")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", leadId)
      .in("kind", CONTACT_KINDS);
    setContacts(count ?? 0);
  }, [leadId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from("leads").select("*").eq("id", leadId).maybeSingle();
      if (cancelled) return;
      if (error) setError(error.message);
      if (!data) return setLead(null);
      setLead(data);
      setAnswers(parseAnswers(data.answers));
      setStage(data.stage as Stage);
      setLostReason(data.lost_reason ?? "");
      setAssigned(data.assigned_to ?? "");
    })();
    countContacts();
    return () => {
      cancelled = true;
    };
  }, [leadId, countContacts]);

  if (!lead) return error ? <Alert>{error}</Alert> : <div className="py-10"><Spinner /></div>;

  const closed = stage === "won" || stage === "lost";
  const tel = telLink(lead.phone);
  const wa = waLink(lead.phone);
  const fuState = followUpState(lead.follow_up_at);
  const newFollowUp = pick === "custom" ? fromLocalInput(custom) : pick ? QUICK_PICKS.find((q) => q.key === pick)?.at() ?? null : null;

  function contact(kind: "call" | "whatsapp") {
    if (!lead) return;
    logContact(lead, kind, (patch) => {
      setLead((l) => (l ? { ...l, ...patch } : l));
      if (patch.stage) setStage(patch.stage as Stage);
      countContacts();
    });
  }

  async function save() {
    if (!lead) return;
    setError("");
    if (stage === "lost" && !lostReason) return setError("Pick why the lead was lost.");
    const hasFuture = !!lead.follow_up_at && new Date(lead.follow_up_at).getTime() > Date.now();
    if (!closed && pick === "custom" && !custom) return setError("Pick the date and time of the next follow-up.");
    if (!closed && !newFollowUp && !hasFuture) return setError("Pick when to follow up next, or mark the lead Won or Lost.");

    const patch: Partial<Lead> = {};
    const cleaned = Object.fromEntries(Object.entries(answers).filter(([, v]) => v));
    if (JSON.stringify(cleaned) !== JSON.stringify(parseAnswers(lead.answers))) patch.answers = cleaned;
    if (stage !== lead.stage) patch.stage = stage;
    if (stage === "lost" && lostReason !== lead.lost_reason) patch.lost_reason = lostReason;
    if (closed && lead.follow_up_at) patch.follow_up_at = null;
    if (!closed && newFollowUp) patch.follow_up_at = newFollowUp;
    if (isAdmin && (assigned || null) !== lead.assigned_to) patch.assigned_to = assigned || null;

    setBusy(true);
    if (remark.trim()) {
      const r = await supabase
        .from("lead_activities")
        .insert({ workspace_id: workspace.id, lead_id: lead.id, kind: "remark", body: remark.trim(), created_by: me });
      if (r.error) {
        setBusy(false);
        return setError(`The remark wasn't saved: ${r.error.message}`);
      }
    }
    if (Object.keys(patch).length) {
      const { error } = await supabase.from("leads").update(patch).eq("workspace_id", workspace.id).eq("id", lead.id);
      if (error) {
        setBusy(false);
        return setError(error.message);
      }
    }
    setBusy(false);
    onSaved(lead.id);
  }

  const pill = (on: boolean, onTone = "bg-brand-600 text-white ring-brand-600") =>
    `rounded-full px-3 py-1 text-sm font-medium ring-1 transition disabled:opacity-60 ${on ? onTone : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {!inDrawer && (
            <>
              <button type="button" onClick={onBack} className="mb-2 text-sm font-semibold text-brand-600 lg:hidden">
                ← Back to list
              </button>
              <h2 className="break-words text-xl font-semibold text-slate-900">{lead.name}</h2>
            </>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
            {lead.company && <span>{lead.company}</span>}
            {lead.phone && <span className="tabular-nums">{lead.phone}</span>}
            {lead.email && <span className="break-all">{lead.email}</span>}
            <span>{lead.source}</span>
            {originLabel(lead, origins) && <Badge tone="bg-indigo-50 text-indigo-700">{originLabel(lead, origins)}</Badge>}
            <Badge tone={STAGE_TONE[lead.stage as Stage]}>{STAGE_LABEL[lead.stage as Stage] ?? lead.stage}</Badge>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 text-sm">
            {lead.follow_up_at && lead.stage !== "won" && lead.stage !== "lost" ? (
              <span className={followUpTone(lead.follow_up_at)}>
                {fuState === "overdue" ? "Overdue: " : "Next follow-up: "}
                {whenLabel(lead.follow_up_at)}
              </span>
            ) : null}
            <span className="text-slate-500">Follow-ups done: <b className="text-slate-800">{contacts}</b></span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {tel && (
            <a href={tel} onClick={() => contact("call")} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700">
              Call
            </a>
          )}
          {wa && (
            <a href={wa} target="_blank" rel="noreferrer" onClick={() => contact("whatsapp")} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700">
              WhatsApp
            </a>
          )}
          {onFullDetails ? (
            <button type="button" onClick={onFullDetails} className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
              Full details
            </button>
          ) : (
            <Link to={`/w/${workspace.slug}/leads?open=${lead.id}&tab=details`} className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
              Full details
            </Link>
          )}
        </div>
      </div>

      {(formAnswerList(lead.form_answers).length > 0 || lead.campaign_details) && (
        <section className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Customer's answers</h3>
          {formAnswerList(lead.form_answers).length > 0 && (
            <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
              {formAnswerList(lead.form_answers).map(([k, a]) => (
                <div key={k}>
                  <dt className="text-xs text-slate-500">{humanize(k)}</dt>
                  <dd className="break-words font-medium text-slate-800">{a}</dd>
                </div>
              ))}
            </dl>
          )}
          {lead.campaign_details && <p className="mt-2 text-xs text-slate-500">{lead.campaign_details}</p>}
        </section>
      )}

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Quick check</h3>
        <div className="grid items-center gap-x-4 gap-y-3 sm:grid-cols-[150px_minmax(0,1fr)]">
          <div className="text-sm font-medium text-slate-700">Contacted?</div>
          <div className="text-sm text-slate-500">
            {lead.first_contacted_at ? (
              <><b className="text-green-700">Yes</b>, filled in when someone tapped Call or WhatsApp</>
            ) : (
              "Not yet. Tap Call or WhatsApp above."
            )}
          </div>
          {questions.map((q) => (
            <div key={q.key} className="contents">
              <div className="text-sm font-medium text-slate-700">{q.label}</div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={q.label}>
                {q.options.map((o) => (
                  <button
                    key={o}
                    type="button"
                    disabled={!canWrite}
                    aria-pressed={answers[q.key] === o}
                    onClick={() => setAnswers((a) => ({ ...a, [q.key]: a[q.key] === o ? "" : o }))}
                    className={pill(answers[q.key] === o, answerTone(o).on)}
                  >
                    {o}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {canWrite && (
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Update</h3>
          <div className="grid items-start gap-x-4 gap-y-3 sm:grid-cols-[150px_minmax(0,1fr)]">
            <label htmlFor="lp-stage" className="pt-2 text-sm font-medium text-slate-700">Stage</label>
            <select
              id="lp-stage"
              className="w-full max-w-xs rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              value={stage}
              onChange={(e) => setStage(e.target.value as Stage)}
            >
              {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>

            {stage === "lost" && (
              <>
                <label htmlFor="lp-lost" className="pt-2 text-sm font-medium text-slate-700">Why was it lost?</label>
                <select
                  id="lp-lost"
                  className="w-full max-w-xs rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  value={lostReason}
                  onChange={(e) => setLostReason(e.target.value)}
                >
                  <option value="">Pick a reason</option>
                  {[...new Set([...LOST_REASONS, ...(lostReason ? [lostReason] : [])])].map((r) => <option key={r}>{r}</option>)}
                </select>
              </>
            )}

            <label htmlFor="lp-remark" className="pt-2 text-sm font-medium text-slate-700">What happened?</label>
            <Textarea
              id="lp-remark"
              rows={2}
              maxLength={5000}
              placeholder="One line is enough, e.g. Interested, will visit the showroom on Saturday"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
            />

            {!closed && (
              <>
                <div className="pt-1 text-sm font-medium text-slate-700">Next follow-up</div>
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {[...QUICK_PICKS, { key: "custom", label: "Pick date & time" }].map((q) => (
                      <button
                        key={q.key}
                        type="button"
                        aria-pressed={pick === q.key}
                        onClick={() => {
                          setPick(pick === q.key ? "" : q.key);
                          if (q.key === "custom" && !custom) setCustom(toLocalInput(lead.follow_up_at ?? QUICK_PICKS[1].at()));
                        }}
                        className={pill(pick === q.key)}
                      >
                        {q.label}
                      </button>
                    ))}
                  </div>
                  {pick === "custom" && (
                    <input
                      type="datetime-local"
                      aria-label="Next follow-up date and time"
                      className="block rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm"
                      value={custom}
                      onChange={(e) => setCustom(e.target.value)}
                    />
                  )}
                  <p className="text-xs text-slate-500">
                    {newFollowUp ? <>Next: <b className="text-slate-800">{whenLabel(newFollowUp)}</b></>
                      : lead.follow_up_at ? `Now set for ${whenLabel(lead.follow_up_at)}.`
                      : "Nothing scheduled yet."}
                  </p>
                </div>
              </>
            )}

            <label htmlFor="lp-assign" className="pt-2 text-sm font-medium text-slate-700">Assigned to</label>
            {isAdmin ? (
              <select
                id="lp-assign"
                className="w-full max-w-xs rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                value={assigned}
                onChange={(e) => setAssigned(e.target.value)}
              >
                <option value="">Nobody</option>
                {people.filter((p) => p.is_active || p.user_id === lead.assigned_to).map((p) => (
                  <option key={p.user_id} value={p.user_id}>{p.user_id === me ? `${p.full_name} (me)` : p.full_name}</option>
                ))}
              </select>
            ) : (
              <div id="lp-assign" className="pt-2 text-sm text-slate-700">{nameOf(people, lead.assigned_to) || "Nobody"}</div>
            )}
          </div>

          {error && <Alert>{error}</Alert>}
          <button
            type="button"
            disabled={busy}
            onClick={save}
            className="w-full rounded-lg bg-brand-gradient px-4 py-3 text-base font-semibold text-white shadow-brand hover:brightness-110 disabled:opacity-60"
          >
            {busy ? "Saving…" : hasNext ? "Save and open next lead →" : "Save"}
          </button>
        </section>
      )}

      {!inDrawer && (
      <section className="space-y-3 border-t border-slate-100 pt-4">
        <h3 className="text-sm font-semibold text-slate-800">History</h3>
        <LeadTimeline
          key={lead.id}
          leadId={lead.id}
          stage={lead.stage}
          followUpAt={lead.follow_up_at}
          people={people}
          me={me}
          forms={{}}
          hideForm
          onLeadChanged={(p) => setLead((l) => (l ? { ...l, ...p } : l))}
        />
      </section>
      )}
    </div>
  );
}
