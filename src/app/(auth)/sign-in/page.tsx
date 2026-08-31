import { redirect } from "next/navigation";

import { SignInForm } from "@/components/auth-forms";
import { getSession, portalPath } from "@/lib/auth/session";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const session = await getSession();
  if (session) redirect(portalPath(session.profile));

  const { message } = await searchParams;
  return <SignInForm notice={message} />;
}
