import type { ReactNode } from "react";
import { Link } from "react-router";
import { productName, type SiteInfo } from "../../lib/site";

// Header and footer shared by the landing, terms and privacy pages.
export function PublicShell({ info, children }: { info: SiteInfo | null; children: ReactNode }) {
  const name = productName(info);
  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-800">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="truncate text-lg font-semibold text-slate-900">{name}</Link>
          <nav className="flex shrink-0 items-center gap-2 text-sm">
            <Link to="/signup" className="hidden rounded-md px-3 py-2 font-medium text-slate-700 hover:bg-slate-100 sm:inline-block">
              Have a PIN? Create account
            </Link>
            <Link to="/login" className="rounded-md bg-indigo-600 px-3 py-2 font-medium text-white hover:bg-indigo-700">
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} {info?.seller_name || name}</span>
          <nav className="flex gap-4">
            <Link to="/terms" className="hover:text-slate-800">Terms of Service</Link>
            <Link to="/privacy" className="hover:text-slate-800">Privacy Policy</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

// Shared look for the legal pages: headings, paragraphs and lists.
export function LegalPage({ title, updated, children }: { title: string; updated: string | null | undefined; children: ReactNode }) {
  return (
    <article
      className="mx-auto max-w-3xl px-4 py-10 text-[15px] leading-7 text-slate-700
        [&_a]:text-indigo-600 [&_a]:underline [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-slate-900
        [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:font-semibold [&_h3]:text-slate-900 [&_li]:mt-1 [&_p]:mt-3
        [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6"
    >
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">{title}</h1>
      {updated && <p className="!mt-2 text-sm text-slate-500">Last updated: {updated}</p>}
      {children}
    </article>
  );
}
