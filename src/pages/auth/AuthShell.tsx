import type { ReactNode } from "react";
import { Link } from "react-router";
import { productName, useSiteInfo } from "../../lib/site";

export function AuthShell({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  const info = useSiteInfo();
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-2 block text-center text-sm font-medium text-indigo-600">{productName(info)}</Link>
        <h1 className="mb-6 text-center text-2xl font-semibold">{title}</h1>
        <div className="space-y-4 rounded-lg bg-white p-6 shadow-sm ring-1 ring-slate-200">{children}</div>
        {footer && <div className="mt-4 text-center text-sm text-slate-600">{footer}</div>}
        <div className="mt-6 text-center text-xs text-slate-400">
          <Link className="hover:text-slate-600" to="/terms">Terms</Link>
          <span className="mx-2">·</span>
          <Link className="hover:text-slate-600" to="/privacy">Privacy</Link>
        </div>
      </div>
    </div>
  );
}
