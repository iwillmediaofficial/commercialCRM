import { useEffect, useState, type FormEvent } from "react";
import { supabase, type Tables } from "../../lib/supabase";
import { Alert, Button, Card, Field, Input, Spinner } from "../../components/ui";

type S = Tables<"platform_settings">;

// Your payment details (shown to companies on their renewal screen) and subscription timings.
export default function Settings() {
  const [s, setS] = useState<S | null>(null);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  useEffect(() => {
    supabase.from("platform_settings").select("*").single().then(({ data }) => setS(data));
  }, []);

  if (!s) return <Spinner />;
  const text = (k: keyof S) => ({
    value: (s[k] as string | null) ?? "",
    onChange: (e: { target: { value: string } }) => setS({ ...s, [k]: e.target.value }),
  });
  const days = (k: "trial_days" | "grace_days" | "reminder_days") => ({
    type: "number",
    min: 0,
    required: true,
    value: s[k],
    onChange: (e: { target: { value: string } }) => setS({ ...s, [k]: Number(e.target.value) }),
  });

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!s) return;
    setMsg(null);
    const blank = (v: string | null) => v?.trim() || null;
    const { error } = await supabase
      .from("platform_settings")
      .update({
        trial_days: s.trial_days,
        grace_days: s.grace_days,
        reminder_days: s.reminder_days,
        bank_account_name: blank(s.bank_account_name),
        bank_name: blank(s.bank_name),
        bank_account_number: blank(s.bank_account_number),
        bank_ifsc: blank(s.bank_ifsc)?.toUpperCase() ?? null,
        upi_id: blank(s.upi_id),
        payment_note: blank(s.payment_note),
      })
      .eq("id", true);
    setMsg(error ? { tone: "error", text: error.message } : { tone: "success", text: "Settings saved." });
  }

  return (
    <form className="space-y-4" onSubmit={save}>
      <Card title="Subscription timings">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Free trial (days)" hint="For new companies, unless you set their own.">
            <Input {...days("trial_days")} />
          </Field>
          <Field label="Grace period (days)" hint="After the end date, before going read-only.">
            <Input {...days("grace_days")} />
          </Field>
          <Field label="Reminder (days before end)" hint="Owners and admins get an in-app reminder.">
            <Input {...days("reminder_days")} />
          </Field>
        </div>
      </Card>
      <Card title="Your payment details">
        <p className="mb-3 text-sm text-slate-500">Companies see these on their Subscription page when they renew.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Account holder name"><Input {...text("bank_account_name")} /></Field>
          <Field label="Bank name"><Input {...text("bank_name")} /></Field>
          <Field label="Account number"><Input {...text("bank_account_number")} /></Field>
          <Field label="IFSC"><Input className="uppercase" {...text("bank_ifsc")} /></Field>
          <Field label="UPI ID"><Input placeholder="name@bank" {...text("upi_id")} /></Field>
          <Field label="Note for customers" hint="e.g. Send the UTR number after paying.">
            <Input {...text("payment_note")} />
          </Field>
        </div>
      </Card>
      <div className="flex items-center gap-3">
        <Button>Save settings</Button>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      </div>
    </form>
  );
}
