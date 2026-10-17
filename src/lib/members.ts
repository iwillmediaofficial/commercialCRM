import { useEffect, useState } from "react";
import { supabase, type MemberRole } from "./supabase";

export type Person = {
  user_id: string;
  role: MemberRole;
  is_active: boolean;
  full_name: string;
  email: string;
  phone: string | null;
  designation: string | null;
};

// Everyone in the workspace with their profile, for pickers and name lookups.
export function useMembers(workspaceId: string) {
  const [people, setPeople] = useState<Person[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: m } = await supabase.from("workspace_members").select("user_id, role, is_active").eq("workspace_id", workspaceId);
      const ids = (m ?? []).map((x) => x.user_id);
      const { data: p } = ids.length
        ? await supabase.from("profiles").select("id, full_name, email, phone, designation").in("id", ids)
        : { data: [] };
      if (cancelled) return;
      setPeople(
        (m ?? []).map((x) => {
          const pr = p?.find((y) => y.id === x.user_id);
          return {
            ...x,
            full_name: pr?.full_name || pr?.email || "Member",
            email: pr?.email ?? "",
            phone: pr?.phone ?? null,
            designation: pr?.designation ?? null,
          };
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);
  return people;
}

export function nameOf(people: Person[], id: string | null | undefined) {
  return (id && people.find((p) => p.user_id === id)?.full_name) || "";
}
