import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { authStorage } from "./authStorage";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

if (!url || !key) {
  throw new Error("Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (see .env.example).");
}

export const supabase = createClient<Database>(url, key, { auth: { storage: authStorage } });

export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export type MemberRole = Database["public"]["Enums"]["member_role"];
