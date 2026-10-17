import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, type MemberRole } from "./supabase";

export type Membership = {
  workspace_id: string;
  role: MemberRole;
  workspace: { id: string; name: string; slug: string };
};

type AuthState = {
  loading: boolean;
  session: Session | null;
  isPlatformAdmin: boolean;
  memberships: Membership[];
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const loadedUser = useRef<string | null>(null);

  const load = useCallback(async (s: Session | null) => {
    setSession(s);
    // A different person signed in: hold the screens until their companies load.
    // Token refreshes for the same person reload quietly.
    if (s && s.user.id !== loadedUser.current) setLoading(true);
    loadedUser.current = s?.user.id ?? null;
    if (!s) {
      setIsPlatformAdmin(false);
      setMemberships([]);
      setLoading(false);
      return;
    }
    const [admin, members] = await Promise.all([
      supabase.rpc("is_platform_admin"),
      supabase
        .from("workspace_members")
        .select("workspace_id, role, workspace:workspaces(id, name, slug)")
        .eq("user_id", s.user.id)
        .eq("is_active", true),
    ]);
    // On a failed lookup keep what we had rather than hiding someone's access.
    if (!admin.error) setIsPlatformAdmin(Boolean(admin.data));
    if (!members.error) setMemberships((members.data ?? []) as unknown as Membership[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => load(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      // Defer so Supabase finishes its own work before we query.
      setTimeout(() => load(s), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  const value: AuthState = {
    loading,
    session,
    isPlatformAdmin,
    memberships,
    refresh: () => load(session),
    signOut: async () => {
      await supabase.auth.signOut();
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
