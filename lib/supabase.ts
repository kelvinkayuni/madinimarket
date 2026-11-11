import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseTabStorageKey } from "@/lib/client-website-session";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const SUPABASE_PASSWORD_RECOVERY_KEY = "madinimarket-password-recovery";
export const SUPABASE_PASSWORD_RECOVERY_LIFETIME = 30 * 60 * 1000;

export const isSupabaseConfigured = Boolean(
  supabaseUrl && supabasePublicKey,
);

let browserClient: SupabaseClient | null = null;

export function getSupabaseBrowserClient() {
  if (!supabaseUrl || !supabasePublicKey) {
    throw new Error("Supabase is not configured. Add its URL and anon key to .env.local.");
  }

  browserClient ??= createClient(supabaseUrl, supabasePublicKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: window.sessionStorage,
      storageKey: getSupabaseTabStorageKey(),
    },
  });

  return browserClient;
}
