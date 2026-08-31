import { ResetPasswordForm } from "@/components/auth-forms";
import { createClient } from "@/lib/supabase/server";

export default async function ResetPasswordPage() {
  // Following the emailed link exchanges it for a session, so the presence of a
  // user here is what proves the request is legitimate.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return <ResetPasswordForm authorised={Boolean(user)} />;
}
