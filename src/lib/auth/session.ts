import { redirect } from "next/navigation";

import { createClient } from "../supabase/server";
import { SUPER_ADMIN_EMAIL, type Profile } from "../types";

export interface Session {
  userId: string;
  email: string;
  profile: Profile;
}

/**
 * Every role decision in the app funnels through here, and every one of these
 * helpers runs on the server. Hiding a link in the UI is never the control.
 */
export async function getSession(): Promise<Session | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) return null;

  return { userId: user.id, email: user.email ?? profile.email, profile };
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return session;
}

export async function requireAdmin(): Promise<Session> {
  const session = await requireSession();
  if (session.profile.role !== "admin") redirect("/candidate");
  return session;
}

export async function requireCandidate(): Promise<Session> {
  const session = await requireSession();
  if (session.profile.role === "admin") redirect("/admin");
  return session;
}

export function isSuperAdmin(profile: Profile): boolean {
  return profile.email.toLowerCase() === SUPER_ADMIN_EMAIL;
}

export async function requireSuperAdmin(): Promise<Session> {
  const session = await requireAdmin();
  if (!isSuperAdmin(session.profile)) redirect("/admin");
  return session;
}

/** Where a signed-in user belongs, used after sign in and by the root route. */
export function portalPath(profile: Profile): string {
  return profile.role === "admin" ? "/admin" : "/candidate";
}
