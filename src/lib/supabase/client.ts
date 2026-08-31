"use client";

import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    // HiRAGe owns the `hirage` schema; `public` belongs to another app in
    // this Supabase project.
    { db: { schema: "hirage" } },
  );
}
