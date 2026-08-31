"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createAdminClient } from "../supabase/admin";
import { createClient } from "../supabase/server";
import { getSession, portalPath } from "../auth/session";
import { type ActionState, failure, messageOf, ok } from "./types";

const credentials = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

export async function signUpAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = credentials.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return failure(parsed.error.issues[0].message);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { emailRedirectTo: `${siteUrl()}/auth/callback` },
  });

  if (error) return failure(error.message);

  // Supabase returns a user with no identities when the address is already
  // registered, so that sign up cannot be used to enumerate accounts.
  if (data.user && data.user.identities?.length === 0) {
    return ok(
      "If that address is not already registered, a confirmation link is on its way.",
    );
  }

  return ok(
    "Check your inbox. Your account becomes active once you click the confirmation link.",
  );
}

export async function signInAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const submittedEmail = String(formData.get("email") ?? "");
  const parsed = credentials.safeParse({
    email: submittedEmail,
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return failure(parsed.error.issues[0].message, { email: submittedEmail });
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    // The address is handed back so a mistyped password does not cost the user
    // their email as well.
    if (error.message.toLowerCase().includes("not confirmed")) {
      return failure(
        "This address has not been confirmed yet. Click the link in the confirmation email first.",
        { email: submittedEmail },
      );
    }
    return failure("Email or password is incorrect.", { email: submittedEmail });
  }

  const session = await getSession();
  redirect(session ? portalPath(session.profile) : "/candidate");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}

export async function forgotPasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .safeParse(formData.get("email"));
  if (!email.success) return failure("Enter a valid email address.");

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${siteUrl()}/auth/callback?next=/reset-password`,
  });
  if (error) return failure(error.message);

  return ok("If an account exists for that address, a reset link is on its way.");
}

/** Used both by the reset-password page and by the profile sections. */
export async function updatePasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirm_password") ?? "");

  if (password.length < 8) return failure("Password must be at least 8 characters.");
  if (password !== confirmation) return failure("The two passwords do not match.");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return failure("Your reset link has expired. Request a new one.");

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return failure(error.message);

  return ok("Password updated.");
}

const profileFields = z.object({
  full_name: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
});

export async function updateProfileAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (!session) return failure("You are not signed in.");

  const parsed = profileFields.safeParse({
    full_name: formData.get("full_name") ?? undefined,
    phone: formData.get("phone") ?? undefined,
  });
  if (!parsed.success) return failure(parsed.error.issues[0].message);

  const update: Record<string, unknown> = {
    full_name: parsed.data.full_name || null,
    phone: parsed.data.phone || null,
    updated_at: new Date().toISOString(),
  };

  // Roles of interest exist on the candidate profile only.
  if (session.profile.role === "candidate" && formData.has("roles_of_interest")) {
    update.roles_of_interest = String(formData.get("roles_of_interest") ?? "")
      .split(",")
      .map((role) => role.trim())
      .filter(Boolean);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update(update)
    .eq("id", session.userId);
  if (error) return failure(error.message);

  revalidatePath("/admin/profile");
  revalidatePath("/candidate/profile");
  revalidatePath("/candidate");
  return ok("Profile saved.");
}

export async function deleteAccountAction(): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(session.userId);
  if (error) throw new Error(`Could not delete the account: ${messageOf(error)}`);

  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}
