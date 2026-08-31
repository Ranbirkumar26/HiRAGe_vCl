import { redirect } from "next/navigation";

import { getSession, portalPath } from "@/lib/auth/session";

export default async function Home() {
  const session = await getSession();
  redirect(session ? portalPath(session.profile) : "/sign-in");
}
