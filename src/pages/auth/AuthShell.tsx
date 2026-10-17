import type { ReactNode } from "react";
import { Link } from "react-router";
import { productName, useSiteInfo } from "../../lib/site";

const POINTS = [
  "Leads, clients and work in one place",
  "GST invoices and recurring billing",
  "Live updates as your team works",
];

export function AuthShell({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  const info = useSiteInfo();
  const name = productName(info);
  return (
    <div className="flex min-h-screen">
      <aside className="relative hidden w-[44%] max-w-xl overflow-hidden bg-sidebar p-12 text-white lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -top-40 -left-40 h-[28rem] w-[28rem] rounded-full bg-brand-600/40 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -right-32 -bottom-32 h-[24rem] w-[24rem] rounded-full bg-violet-brand/30 blur-3xl" aria-hidden />
        <Link to="/" className="relative flex items-center gap-3 text-lg font-semibold">
          <span className="h-9 w-9 rounded-xl bg-brand-gradient shadow-brand" aria-hidden />
          {name}
        </Link>
        <div className="relative mt-auto">
          <h2 className="text-3xl leading-tight font-bold tracking-tight">Run your agency from one calm, fast workspace.</h2>
          <ul className="mt-8 space-y-3 text-sm text-slate-300">
            {POINTS.map((p) => (
              <li key={p} className="flex items-center gap-3">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-[11px] text-violet-300">✓</span>
                {p}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative mt-12 text-xs text-slate-500">© {new Date().getFullYear()} {name}</div>
      </aside>
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <Link to="/" className="mb-8 flex items-center justify-center gap-2.5 font-semibold lg:hidden">
            <span className="h-8 w-8 rounded-lg bg-brand-gradient shadow-brand" aria-hidden />
            {name}
          </Link>
          <h1 className="mb-1.5 text-2xl font-bold tracking-tight">{title}</h1>
          <p className="mb-6 text-sm text-slate-500">Welcome. Enter your details to continue.</p>
          <div className="space-y-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70">{children}</div>
          {footer && <div className="mt-5 text-center text-sm text-slate-600">{footer}</div>}
          <div className="mt-8 text-center text-xs text-slate-400">
            <Link className="hover:text-slate-600" to="/terms">Terms</Link>
            <span className="mx-2">·</span>
            <Link className="hover:text-slate-600" to="/privacy">Privacy</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
