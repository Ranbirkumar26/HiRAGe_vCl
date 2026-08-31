import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { getSession, portalPath } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/**
 * Landing point for both the sign-up confirmation link and the password reset
 * link. Supabase sends either a PKCE `code` or a `token_hash` depending on how
 * the project's email templates are configured, so both are handled.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next");

  const supabase = await createClient();
  let failed = "Confirmation link is invalid or has already been used.";

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${await destination(next)}`);
    failed = error.message;
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      const fallback = type === "recovery" ? "/reset-password" : null;
      return NextResponse.redirect(`${origin}${await destination(next ?? fallback)}`);
    }
    failed = error.message;
  }

  return NextResponse.redirect(
    `${origin}/sign-in?message=${encodeURIComponent(failed)}`,
  );
}

async function destination(next: string | null): Promise<string> {
  if (next) return next;
  const session = await getSession();
  return session ? portalPath(session.profile) : "/sign-in";
}
