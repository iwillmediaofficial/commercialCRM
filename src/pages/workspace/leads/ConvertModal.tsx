import { useState } from "react";
import { Link } from "react-router";
import { supabase } from "../../../lib/supabase";
import { useWorkspace } from "../../../lib/workspace";
import { Alert, Button, Modal } from "../../../components/ui";
import type { Lead } from "./LeadModal";

const linkBtn = "inline-flex items-center justify-center rounded-md bg-white px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50";

// Asked when a lead is marked Won: turn it into a client (and an onboarding task).
export default function ConvertModal({ lead, onClose, onDone }: { lead: Lead; onClose: () => void; onDone: (clientId: string) => void }) {
  const { workspace, hasModule, isAdmin, canWrite } = useWorkspace();
  const work = hasModule("work");
  const [withWork, setWithWork] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; limit: boolean } | null>(null);
  const [done, setDone] = useState<{ client_id: string; work_item_id?: string | null } | null>(null);

  async function convert() {
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.rpc("convert_lead_to_client", { p_lead_id: lead.id, p_create_work_item: work && withWork });
    setBusy(false);
    if (error) return setError({ message: error.message, limit: /client limit/i.test(error.message) || error.hint === "client_limit" });
    const res = data as { client_id: string; work_item_id?: string | null };
    setDone(res);
    onDone(res.client_id);
  }

  const company = lead.company?.trim() || lead.name;
  const base = `/w/${workspace.slug}`;

  if (!isAdmin || !canWrite) {
    return (
      <Modal title="Lead won" onClose={onClose}>
        <div className="space-y-4">
          <Alert tone="success">Well done! "{lead.name}" is marked as won.</Alert>
          <p className="text-sm text-slate-600">An admin can now turn this lead into a client from the Leads page.</p>
          <div className="flex justify-end"><Button onClick={onClose}>OK</Button></div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Lead won: make it a client?" onClose={onClose}>
      {done ? (
        <div className="space-y-4">
          <Alert tone="success">
            {company} is now an active client{done.work_item_id ? ", and an onboarding task has been created" : ""}.
          </Alert>
          <div className="flex flex-wrap justify-end gap-2">
            {done.work_item_id && <Link className={linkBtn} to={`${base}/work`}>Open work</Link>}
            <Link className={linkBtn} to={`${base}/clients`}>Open clients</Link>
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {error && (
            error.limit ? (
              <Alert tone="warning">
                {error.message} To add this client, mark an old client as inactive on the Clients page, or upgrade your plan on the{" "}
                <Link className="font-medium underline" to={`${base}/billing`}>Subscription</Link> page. The lead stays marked as won.
              </Alert>
            ) : (
              <Alert>{error.message}</Alert>
            )
          )}
          <p className="text-sm text-slate-600">
            This adds <strong>{company}</strong> to your clients with {lead.name}'s phone and email, so you can start billing and work.
          </p>
          {work && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={withWork} onChange={(e) => setWithWork(e.target.checked)} />
              <span>
                Also create an onboarding work item
                <span className="block text-xs text-slate-500">"Onboard {company}", high priority{lead.assigned_to ? ", given to the person handling this lead" : ""}.</span>
              </span>
            </label>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Not now</Button>
            <Button onClick={convert} disabled={busy}>{busy ? "Creating…" : "Create client"}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
