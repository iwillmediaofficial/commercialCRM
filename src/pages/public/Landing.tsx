import { Link } from "react-router";
import { MODULES, PERIOD_LABEL, inr, type BillingPeriod } from "../../lib/format";
import { productName, useSiteInfo, whatsappNumber, type SitePlan } from "../../lib/site";
import { PublicShell } from "./PublicShell";

// Marketing page for signed-out visitors at "/". Plans and contact details
// come from public_site_info(), so the Super Admin edits them in the app.

const FEATURES: { title: string; text: string; icon: string }[] = [
  {
    title: "Leads pipeline",
    text: "Track every enquiry from first call to won. Share public lead forms on your website or ads and new leads land straight in your pipeline.",
    icon: "M3 4h18l-7 8v6l-4 2v-8L3 4z",
  },
  {
    title: "Clients",
    text: "One place for each client's contacts, GST details, work, invoices and ad budgets, so anyone on the team can pick up where others left off.",
    icon: "M16 11a4 4 0 1 0-8 0M4 21a8 8 0 0 1 16 0M12 7a3 3 0 1 0 0-6",
  },
  {
    title: "Work board and timesheets",
    text: "Plan tasks on a board, start a timer when you begin, and get timesheets per person and per client without filling spreadsheets.",
    icon: "M12 8v4l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  },
  {
    title: "GST invoices and recurring billing",
    text: "Make GST-ready invoices in a minute, set up monthly retainers that bill themselves, and see what is due on the billing calendar.",
    icon: "M7 3h10v18l-3-2-2 2-2-2-3 2V3zM10 8h4M10 12h4",
  },
  {
    title: "Ad fund tracking",
    text: "Record money collected from clients for ads against what you actually spent on each platform. Balances carry forward month to month.",
    icon: "M3 17l6-6 4 4 8-8M15 7h6v6",
  },
  {
    title: "Team roles and live timers",
    text: "Give owners, managers and staff the right level of access, and see who is working on what right now with the live timer monitor.",
    icon: "M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7l8-4z",
  },
];

const PRICE_KEYS: [BillingPeriod, keyof SitePlan][] = [
  ["monthly", "price_monthly"],
  ["quarterly", "price_quarterly"],
  ["half_yearly", "price_half_yearly"],
  ["yearly", "price_yearly"],
];

const PERIOD_SHORT: Record<BillingPeriod, string> = {
  monthly: "month",
  quarterly: "3 months",
  half_yearly: "6 months",
  yearly: "year",
};

// Monthly price when sold monthly, else the cheapest period on offer.
function headlinePrice(p: SitePlan): { amount: string; per: string } | null {
  if (p.price_monthly != null) return { amount: inr(p.price_monthly), per: PERIOD_SHORT.monthly };
  const offers = PRICE_KEYS.filter(([, k]) => p[k] != null).map(([period, k]) => ({ period, price: Number(p[k]) }));
  if (!offers.length) return null;
  const best = offers.reduce((a, b) => (b.price < a.price ? b : a));
  return { amount: inr(best.price), per: PERIOD_SHORT[best.period] };
}

// Other periods this plan is sold for, e.g. "₹24,999 for 1 year".
function otherPrices(p: SitePlan, shownPer: string) {
  return PRICE_KEYS.filter(([period, k]) => p[k] != null && PERIOD_SHORT[period] !== shownPer).map(
    ([period, k]) => `${inr(Number(p[k]))} for ${PERIOD_LABEL[period]}`,
  );
}

function limit(n: number | null, what: string) {
  return n == null ? `Unlimited ${what}` : `Up to ${n.toLocaleString("en-IN")} ${n === 1 ? what.replace(/s$/, "") : what}`;
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 20 20" className="mt-1 h-4 w-4 shrink-0 text-indigo-600" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 10l4 4 8-8" />
    </svg>
  );
}

export default function Landing() {
  const info = useSiteInfo();
  const name = productName(info);
  const plans = info?.plans ?? [];
  const trial = info?.trial_days ?? 0;
  const email = info?.support_email;
  const phone = info?.support_phone;

  return (
    <PublicShell info={info}>
      {/* Hero */}
      <section className="bg-gradient-to-b from-indigo-50 to-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
          <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">{name}</p>
          <h1 className="mt-3 max-w-3xl text-3xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            The CRM for digital marketing agencies and service businesses
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-slate-600">
            Leads, clients, tasks and time, GST invoices and recurring billing, and ad fund tracking, all in one place.
            Each company's data is private to that company.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a href="#contact" className="rounded-md bg-indigo-600 px-5 py-3 text-center font-medium text-white hover:bg-indigo-700">
              Get started
            </a>
            <Link to="/signup" className="rounded-md bg-white px-5 py-3 text-center font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
              Have a PIN? Create account
            </Link>
          </div>
          {trial > 0 && (
            <p className="mt-4 text-sm text-slate-500">Try it free for {trial} days.</p>
          )}
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Everything your agency runs on</h2>
        <p className="mt-2 max-w-2xl text-slate-600">Built for how Indian agencies actually work: retainers, GST and client ad budgets.</p>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-lg bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-indigo-50 text-indigo-600">
                <Icon d={f.icon} />
              </div>
              <h3 className="mt-4 font-semibold text-slate-900">{f.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      {plans.length > 0 && (
        <section id="pricing" className="border-y border-slate-200 bg-slate-50">
          <div className="mx-auto max-w-6xl px-4 py-16">
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Pricing</h2>
            <p className="mt-2 text-slate-600">
              Simple prepaid plans. Pay for the period you choose, with no automatic renewal.
              {trial > 0 && ` Every new company starts with a free ${trial}-day trial.`}
            </p>
            <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {plans.map((p) => {
                const price = headlinePrice(p);
                const others = price ? otherPrices(p, price.per) : [];
                const mods = MODULES.filter(([m]) => p.modules?.includes(m));
                return (
                  <div key={p.name} className="flex flex-col rounded-lg bg-white p-6 shadow-sm ring-1 ring-slate-200">
                    <h3 className="text-lg font-semibold text-slate-900">{p.name}</h3>
                    {p.description && <p className="mt-1 text-sm text-slate-600">{p.description}</p>}
                    <div className="mt-4">
                      {price ? (
                        <p>
                          <span className="text-3xl font-bold text-slate-900">{price.amount}</span>
                          <span className="text-slate-500"> / {price.per}</span>
                        </p>
                      ) : (
                        <p className="text-2xl font-bold text-slate-900">Contact us</p>
                      )}
                      {others.length > 0 && <p className="mt-1 text-xs text-slate-500">Also {others.join(", ")}</p>}
                    </div>
                    <ul className="mt-5 flex-1 space-y-2 text-sm text-slate-700">
                      <li className="flex gap-2"><Check />{limit(p.staff_limit, "staff")}</li>
                      <li className="flex gap-2"><Check />{limit(p.client_limit, "clients")}</li>
                      <li className="flex gap-2"><Check />Clients and team roles</li>
                      {mods.map(([m, label]) => (
                        <li key={m} className="flex gap-2"><Check />{label}</li>
                      ))}
                    </ul>
                    <a href="#contact" className="mt-6 rounded-md bg-indigo-600 px-4 py-2 text-center text-sm font-medium text-white hover:bg-indigo-700">
                      Talk to us
                    </a>
                  </div>
                );
              })}
            </div>
            {info?.seller_gstin && <p className="mt-6 text-sm text-slate-500">Prices include GST.</p>}
          </div>
        </section>
      )}

      {/* Getting started */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">How to get started</h2>
        <ol className="mt-10 grid gap-6 md:grid-cols-3">
          {[
            ["Contact us", "Tell us about your business and pick a plan. Ask for a free trial if you want to look around first."],
            ["We set up your company", "We create your company account and give you a one-time PIN."],
            ["Sign up with the PIN", "Create your login with the PIN, then invite your team from inside the app."],
          ].map(([title, text], i) => (
            <li key={title} className="rounded-lg bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-sm font-semibold text-white">{i + 1}</span>
              <h3 className="mt-4 font-semibold text-slate-900">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
            </li>
          ))}
        </ol>
        <p className="mt-6 text-sm text-slate-600">
          Already have a PIN? <Link className="font-medium text-indigo-600" to="/signup">Create your account</Link>.
        </p>
      </section>

      {/* Contact */}
      <section id="contact" className="border-t border-slate-200 bg-indigo-600 text-white">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Talk to us</h2>
          <p className="mt-2 max-w-2xl text-indigo-100">
            Questions, a demo or a trial account. Get in touch and we will set you up.
          </p>
          {email || phone ? (
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              {email && (
                <a href={`mailto:${email}`} className="rounded-md bg-white px-5 py-3 text-center font-medium text-indigo-700 hover:bg-indigo-50">
                  Email {email}
                </a>
              )}
              {phone && (
                <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="rounded-md px-5 py-3 text-center font-medium text-white ring-1 ring-white/60 hover:bg-white/10">
                  Call {phone}
                </a>
              )}
              {phone && (
                <a
                  href={`https://wa.me/${whatsappNumber(phone)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md px-5 py-3 text-center font-medium text-white ring-1 ring-white/60 hover:bg-white/10"
                >
                  WhatsApp us
                </a>
              )}
            </div>
          ) : (
            <p className="mt-8 text-indigo-100">Contact details will appear here soon.</p>
          )}
        </div>
      </section>
    </PublicShell>
  );
}
