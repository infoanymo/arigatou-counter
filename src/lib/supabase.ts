import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
const publishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

export const isSupabaseConfigured =
  Boolean(supabaseUrl) &&
  Boolean(publishableKey) &&
  !supabaseUrl.includes("your-project-ref") &&
  !publishableKey.includes("your_key");

export const supabase = isSupabaseConfigured
  ? createClient<Database>(supabaseUrl, publishableKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: "pkce",
        persistSession: true,
      },
    })
  : null;

export function getSupabase() {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  return supabase;
}
