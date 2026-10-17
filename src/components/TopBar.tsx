import { Link } from "react-router";
import { UserMenu } from "./AppShell";

// Slim top bar for pages outside a company (the company picker).
export function TopBar({ title }: { title: string }) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <Link to="/" className="flex min-w-0 items-center gap-2.5 font-semibold tracking-tight">
          <span className="h-8 w-8 shrink-0 rounded-lg bg-brand-gradient shadow-brand" aria-hidden />
          <span className="truncate">{title}</span>
        </Link>
        <UserMenu />
      </div>
    </header>
  );
}
