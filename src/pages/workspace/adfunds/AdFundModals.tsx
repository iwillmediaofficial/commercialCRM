import { useState, type FormEvent } from "react";
import { supabase, type Tables } from "../../../lib/supabase";
import { useWorkspace } from "../../../lib/workspace";
import { useAuth } from "../../../lib/auth";
import { inr, MODES, type PaymentMode } from "../../../lib/format";
import { Alert, Button, Field, Input, Modal, Select, Textarea } from "../../../components/ui";
import { firstDay, monthOf, PAYERS, type PayerType } from "./adFundMath";
import { AD_PLATFORMS, platformLabel } from "../clients/platforms";

export type Client = Tables<"clients">;
export type Upload = Tables<"ad_fund_uploads">;
export type Collection = Tables<"ad_fund_collections">;
export type Adjustment = Tables<"ad_fund_adjustments">;

export const platformName = platformLabel;

// Stored lowercase (meta, google, ...). Free text that matches a known platform maps to its key.
function platformKey(text: string) {
  const t = text.trim().toLowerCase();
  return AD_PLATFORMS.find(([k, l]) => k === t || l.toLowerCase() === t)?.[0] ?? t;
}

export const ADJ_KINDS: [string, string][] = [
  ["opening_balance", "Opening balance"],
  ["carryover", "Offline carryover"],
  ["correction", "Correction"],
];
export const ADJ_LABEL = Object.fromEntries(ADJ_KINDS) as Record<string, string>;

const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time

function Actions({ busy, onClose, label }: { busy: boolean; onClose: () => void; label: string }) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
      <Button type="submit" disabled={busy}>{busy ? "Saving…" : label}</Button>
    </div>
  );
}

// Add or edit an ad upload. `available` tells how much unused fund the client has
// for a given month, so we can warn before over-drawing it.
export function UploadModal({ clients, upload, defaultClient, available, onClose, onSaved }: {
  clients: Client[];
  upload?: Upload;
  defaultClient?: string;
  available: (clientId: string, month: string, excludeUploadId?: string) => number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { workspace } = useWorkspace();
  const { session } = useAuth();
  const [f, setF] = useState({
    client_id: upload?.client_id ?? defaultClient ?? clients[0]?.id ?? "",
    platform: upload?.platform ?? "",
    amount: upload ? String(upload.amount) : "",
    payer_type: (upload?.payer_type ?? "company") as PayerType,
    payer_name: upload?.payer_name ?? "",
    upload_date: upload?.upload_date ?? today(),
    notes: upload?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const client = clients.find((c) => c.id === f.client_id);
  // The client's own platforms first; if none are set, offer the standard list.
  const platforms = client?.ad_platforms?.length ? client.ad_platforms : AD_PLATFORMS.map(([k]) => k);
  const listed = platforms.some((x) => x === f.platform);
  const [custom, setCustom] = useState(!!upload && !platforms.includes(upload.platform));
  const avail = f.client_id && f.upload_date ? available(f.client_id, monthOf(f.upload_date), upload?.id) : 0;
  const amt = Number(f.amount || 0);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!f.client_id) return setError("Pick a client.");
    if (!f.platform.trim()) return setError("Choose or type the platform.");
    if (!(amt > 0)) return setError("Enter an amount above zero.");
    if (f.payer_type === "personal" && !f.payer_name.trim()) return setError("Enter who paid for a personal payment.");
    setBusy(true);
    const row = {
      client_id: f.client_id,
      platform: platformKey(f.platform),
      amount: amt,
      payer_type: f.payer_type,
      payer_name: f.payer_type === "personal" ? f.payer_name.trim() : f.payer_name.trim() || null,
      upload_date: f.upload_date,
      notes: f.notes.trim() || null,
    };
    const { error } = upload
      ? await supabase.from("ad_fund_uploads").update(row).eq("workspace_id", workspace.id).eq("id", upload.id)
      : await supabase.from("ad_fund_uploads").insert({ ...row, workspace_id: workspace.id, recorded_by: session?.user.id ?? null });
    setBusy(false);
    if (error) return setError(error.message);
    onSaved();
  }

  return (
    <Modal title={upload ? "Edit ad upload" : "Add ad upload"} onClose={onClose}>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={save}>
        {error && <div className="sm:col-span-2"><Alert>{error}</Alert></div>}
        <Field label="Client">
          <Select value={f.client_id} onChange={(e) => { setF({ ...f, client_id: e.target.value, platform: "" }); setCustom(false); }}>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </Select>
        </Field>
        <Field label="Platform">
          {!custom ? (
            <Select
              value={listed ? f.platform : ""}
              onChange={(e) => e.target.value === "__other" ? (setCustom(true), setF({ ...f, platform: "" })) : setF({ ...f, platform: e.target.value })}
            >
              <option value="">Choose…</option>
              {platforms.map((x) => <option key={x} value={x}>{platformName(x)}</option>)}
              <option value="__other">Something else…</option>
            </Select>
          ) : (
            <Input value={f.platform} placeholder="Type the platform" onChange={(e) => setF({ ...f, platform: e.target.value })} />
          )}
        </Field>
        <Field label="Amount (₹)">
          <Input type="number" min="0.01" step="0.01" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </Field>
        <Field label="Date">
          <Input type="date" required value={f.upload_date} onChange={(e) => setF({ ...f, upload_date: e.target.value })} />
        </Field>
        <Field label="Who paid?">
          <Select value={f.payer_type} onChange={(e) => setF({ ...f, payer_type: e.target.value as PayerType })}>
            {PAYERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <Field label={f.payer_type === "personal" ? "Paid by (name)" : "Paid by (optional)"}>
          <Input required={f.payer_type === "personal"} value={f.payer_name} onChange={(e) => setF({ ...f, payer_name: e.target.value })} />
        </Field>
        <div className="sm:col-span-2 text-xs text-slate-500">
          {f.payer_type === "company" || f.payer_type === "personal"
            ? "Your money was used, so this adds to the client's To Collect."
            : f.payer_type === "client"
              ? "The client paid directly. Nothing to collect."
              : `Taken from the client's unused fund. Nothing to collect. Available this month: ${inr(avail)}.`}
        </div>
        {f.payer_type === "unused_fund" && amt > avail && (
          <div className="sm:col-span-2">
            <Alert tone="warning">This is more than the {inr(avail)} unused fund available for that month. You can still save it; the unused balance will go below zero.</Alert>
          </div>
        )}
        <div className="sm:col-span-2">
          <Field label="Notes">
            <Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </Field>
        </div>
        <div className="sm:col-span-2"><Actions busy={busy} onClose={onClose} label={upload ? "Save changes" : "Add upload"} /></div>
      </form>
    </Modal>
  );
}

// Money received from the client towards what they owe (To Collect).
export function CollectionModal({ clients, collection, defaultClient, owed, onClose, onSaved }: {
  clients: Client[];
  collection?: Collection;
  defaultClient?: string;
  owed: (clientId: string) => number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { workspace } = useWorkspace();
  const { session } = useAuth();
  const [f, setF] = useState({
    client_id: collection?.client_id ?? defaultClient ?? clients[0]?.id ?? "",
    amount: collection ? String(collection.amount) : "",
    received_on: collection?.received_on ?? today(),
    method: (collection?.method ?? "upi") as PaymentMode,
    reference_no: collection?.reference_no ?? "",
    notes: collection?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    const amount = Number(f.amount || 0);
    if (!f.client_id) return setError("Pick a client.");
    if (!(amount > 0)) return setError("Enter an amount above zero.");
    setBusy(true);
    const row = {
      client_id: f.client_id,
      amount,
      received_on: f.received_on,
      method: f.method,
      reference_no: f.reference_no.trim() || null,
      notes: f.notes.trim() || null,
    };
    const { error } = collection
      ? await supabase.from("ad_fund_collections").update(row).eq("workspace_id", workspace.id).eq("id", collection.id)
      : await supabase.from("ad_fund_collections").insert({ ...row, workspace_id: workspace.id, recorded_by: session?.user.id ?? null });
    setBusy(false);
    if (error) return setError(error.message);
    onSaved();
  }

  return (
    <Modal title={collection ? "Edit collection" : "Add collection"} onClose={onClose}>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={save}>
        {error && <div className="sm:col-span-2"><Alert>{error}</Alert></div>}
        <Field label="Client" hint={f.client_id ? `Still to collect: ${inr(owed(f.client_id))}` : undefined}>
          <Select value={f.client_id} onChange={(e) => setF({ ...f, client_id: e.target.value })}>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </Select>
        </Field>
        <Field label="Amount received (₹)">
          <Input type="number" min="0.01" step="0.01" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </Field>
        <Field label="Received on">
          <Input type="date" required value={f.received_on} onChange={(e) => setF({ ...f, received_on: e.target.value })} />
        </Field>
        <Field label="Payment mode">
          <Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as PaymentMode })}>
            {MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Reference / UTR no.">
            <Input value={f.reference_no} onChange={(e) => setF({ ...f, reference_no: e.target.value })} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Notes">
            <Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </Field>
        </div>
        <div className="sm:col-span-2"><Actions busy={busy} onClose={onClose} label={collection ? "Save changes" : "Add collection"} /></div>
      </form>
    </Modal>
  );
}

// Original Fund (CRUD) entry: opening balance, offline carryover or correction.
export function AdjustmentModal({ clientId, adjustment, defaultMonth, onClose, onSaved }: {
  clientId: string;
  adjustment?: Adjustment;
  defaultMonth: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { workspace } = useWorkspace();
  const { session } = useAuth();
  const [f, setF] = useState({
    month: adjustment ? monthOf(adjustment.year_month) : defaultMonth,
    kind: adjustment?.kind ?? "opening_balance",
    amount: adjustment ? String(adjustment.amount) : "",
    notes: adjustment?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    const amount = Number(f.amount);
    if (!f.amount || !Number.isFinite(amount) || amount === 0) return setError("Enter an amount (use a minus sign to reduce).");
    if (!/^\d{4}-\d{2}$/.test(f.month)) return setError("Pick a month.");
    setBusy(true);
    const row = { year_month: firstDay(f.month), kind: f.kind, amount, notes: f.notes.trim() || null };
    const { error } = adjustment
      ? await supabase.from("ad_fund_adjustments").update(row).eq("workspace_id", workspace.id).eq("id", adjustment.id)
      : await supabase.from("ad_fund_adjustments").insert({ ...row, client_id: clientId, workspace_id: workspace.id, recorded_by: session?.user.id ?? null });
    setBusy(false);
    if (error) return setError(error.message);
    onSaved();
  }

  return (
    <Modal title={adjustment ? "Edit original fund entry" : "Add original fund entry"} onClose={onClose}>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={save}>
        {error && <div className="sm:col-span-2"><Alert>{error}</Alert></div>}
        <Field label="Type">
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            {ADJ_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Month it applies to" hint="Added to the unused fund carried into this month.">
          <Input type="month" required value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} />
        </Field>
        <Field label="Amount (₹)" hint="Use a minus sign to reduce the fund, e.g. -5000.">
          <Input type="number" step="0.01" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Notes">
            <Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </Field>
        </div>
        <div className="sm:col-span-2"><Actions busy={busy} onClose={onClose} label={adjustment ? "Save changes" : "Add entry"} /></div>
      </form>
    </Modal>
  );
}
