import { Link } from "react-router";
import { useAuth } from "../lib/auth";
import { NotificationBell } from "./NotificationBell";
import { StoredImage } from "./Files";

export function TopBar({
  title,
  workspace,
  logoPath,
}: {
  title: string;
  workspace?: { id: string; slug: string };
  logoPath?: string | null;
}) {
  const { session, isPlatformAdmin, memberships, signOut } = useAuth();
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link to="/" className="flex min-w-0 items-center gap-2 font-semibold">
          {logoPath && <StoredImage storageKey={logoPath} className="h-7 w-7 shrink-0 rounded object-cover" />}
          <span className="truncate">{title}</span>
        </Link>
        <div className="flex items-center gap-3 text-sm">
          {workspace && <NotificationBell workspace={workspace} />}
          {isPlatformAdmin && <Link className="text-slate-600 hover:text-slate-900" to="/admin">Super Admin</Link>}
          {memberships.length > 1 && <Link className="text-slate-600 hover:text-slate-900" to="/">Switch company</Link>}
          <span className="hidden text-slate-500 sm:inline">{session?.user.email}</span>
          <button className="text-slate-600 hover:text-slate-900" onClick={signOut}>Sign out</button>
        </div>
      </div>
    </header>
  );
}
