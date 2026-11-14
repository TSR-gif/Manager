import "server-only";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/** Server-only Supabase client using the service role key. RLS blocks everyone else. */
export function db(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  // "local" (older installs) means the built-in database, whose key the launcher works out and hands over
  const set = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const key = set && set !== "local" ? set : process.env.MM_LOCAL_DB_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

/** After the PC switches databases (going online), the next call connects to the new one. */
export function resetDb() { client = null; }

export function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}
