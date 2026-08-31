import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client. Bypasses RLS entirely, so every call site must have
 * already established that the caller is allowed to do what it is about to do.
 * Never import this into a file that ships to the browser.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set",
    );
  }
  return createClient(url, key, {
    // HiRAGe owns the `hirage` schema; `public` belongs to another app in
    // this Supabase project.
    db: { schema: "hirage" },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
