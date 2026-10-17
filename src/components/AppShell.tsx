import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { Icon, type IconName } from "./icons";

export type NavItem = { to: string; label: string; icon: IconName; end?: boolean; badge?: number };
export type NavGroup = { label?: string; items: NavItem[] };

// The signed-in frame: dark sidebar on the left (a slide-in drawer on phones),
// a white top bar, and the page on a soft grey background.
export function AppShell({
  brand,
  groups,
  sidebarFooter,
  search,
  right,
  children,
}: {
  brand: ReactNode;
  groups: NavGroup[];
  sidebarFooter?: ReactNode;
  search?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);

  const sidebar = (
    <div className="flex h-full flex-col bg-sidebar bg-[radial-gradient(120%_60%_at_0%_0%,rgba(91,91,240,0.18),transparent_60%)] text-slate-300">
      <div className="px-4 pt-5 pb-3">{brand}</div>
      <nav className="scrollbar-thin flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {groups.map((g, i) => (
          <div key={g.label ?? i}>
            {g.label && <div className="px-3 pb-1.5 text-[11px] font-semibold tracking-[0.08em] text-slate-500 uppercase">{g.label}</div>}
            <ul className="space-y-0.5">
              {g.items.map((n) => (
                <li key={n.to}>
                  <NavLink
                    to={n.to}
                    end={n.end}
                    className={({ isActive }) =>
                      `group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                        isActive
                          ? "bg-gradient-to-r from-brand-600/35 to-violet-brand/15 text-white shadow-[inset_0_0_0_1px_rgba(139,92,246,0.35)]"
                          : "text-slate-400 hover:bg-white/5 hover:text-white"
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon name={n.icon} className={`h-[18px] w-[18px] shrink-0 ${isActive ? "text-violet-300" : "text-slate-500 group-hover:text-slate-300"}`} />
                        <span className="flex-1 truncate">{n.label}</span>
                        {!!n.badge && (
                          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-slate-200">{n.badge > 99 ? "99+" : n.badge}</span>
                        )}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      {sidebarFooter && <div className="p-3">{sidebarFooter}</div>}
    </div>
  );

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-label="Menu">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-2xl">{sidebar}</aside>
          <button
            className="absolute top-4 left-[min(18rem,85vw)] ml-2 rounded-full bg-white/10 p-2 text-white"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          >
            <Icon name="close" />
          </button>
        </div>
      )}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/85 backdrop-blur">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
            <button className="-ml-1 rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Open menu" onClick={() => setOpen(true)}>
              <Icon name="menu" />
            </button>
            <div className="min-w-0 flex-1">{search}</div>
            <div className="flex shrink-0 items-center gap-2 sm:gap-3">{right}</div>
          </div>
        </header>
        <main className="mx-auto max-w-[1400px] space-y-5 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

// Coloured initials circle. The colour is stable per name.
const AVATAR_TONES = [
  "from-indigo-500 to-violet-500",
  "from-emerald-500 to-teal-500",
  "from-amber-500 to-orange-500",
  "from-sky-500 to-blue-500",
  "from-pink-500 to-rose-500",
  "from-violet-500 to-purple-600",
];
export function initials(name: string) {
  const parts = name.trim().split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}
export function Avatar({ name, className = "h-9 w-9 text-xs" }: { name: string; className?: string }) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-semibold text-white ${AVATAR_TONES[h % AVATAR_TONES.length]} ${className}`}>
      {initials(name)}
    </span>
  );
}

// Avatar button with the person's name; opens a small menu.
export function UserMenu({ roleLabel }: { roleLabel?: string }) {
  const { session, isPlatformAdmin, memberships, signOut } = useAuth();
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const me = session?.user.id;
  const email = session?.user.email ?? "";

  useEffect(() => {
    if (!me) return;
    supabase.from("profiles").select("full_name").eq("id", me).maybeSingle().then(({ data }) => setName(data?.full_name ?? ""));
  }, [me]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const shown = name || email;
  return (
    <div className="relative" ref={box}>
      <button className="flex items-center gap-2.5 rounded-full p-0.5 pr-1 hover:bg-slate-100 sm:pr-2" onClick={() => setOpen(!open)} aria-label="Account menu">
        <Avatar name={shown} />
        <span className="hidden text-left leading-tight md:block">
          <span className="block max-w-36 truncate text-sm font-semibold text-slate-900">{shown}</span>
          {roleLabel && <span className="block text-xs text-slate-500 capitalize">{roleLabel}</span>}
        </span>
        <Icon name="chevronDown" className="hidden h-4 w-4 text-slate-400 md:block" />
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-slate-200">
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="truncate text-sm font-semibold">{shown}</div>
            <div className="truncate text-xs text-slate-500">{email}</div>
          </div>
          <div className="p-1.5 text-sm">
            {isPlatformAdmin && (
              <MenuLink to="/admin" icon="shield" onClick={() => setOpen(false)}>Super Admin</MenuLink>
            )}
            {memberships.length > 1 && (
              <MenuLink to="/" icon="swap" onClick={() => setOpen(false)}>Switch company</MenuLink>
            )}
            <button className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-slate-700 hover:bg-slate-50" onClick={signOut}>
              <Icon name="logout" className="h-4 w-4 text-slate-400" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuLink({ to, icon, onClick, children }: { to: string; icon: IconName; onClick: () => void; children: ReactNode }) {
  return (
    <Link to={to} onClick={onClick} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-slate-700 hover:bg-slate-50">
      <Icon name={icon} className="h-4 w-4 text-slate-400" />
      {children}
    </Link>
  );
}
