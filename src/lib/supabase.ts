import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env, assertSupabase } from "../env";

let client: SupabaseClient | null = null;

/** Service-role client — bypasses RLS. Never expose to the browser. */
export function db(): SupabaseClient {
  assertSupabase();
  if (!client) client = createClient(env.supabaseUrl, env.supabaseServiceKey);
  return client;
}

export function isDbConfigured(): boolean {
  return Boolean(env.supabaseUrl && env.supabaseServiceKey);
}
