import type { ReactNode } from "react";

import { PortalShell } from "@/components/portal-shell";
import { requireCandidate } from "@/lib/auth/session";

const NAV_LINKS = [
  { href: "/candidate", label: "Jobs" },
  { href: "/candidate/applications", label: "Applications" },
  { href: "/candidate/notifications", label: "Notifications" },
  { href: "/candidate/profile", label: "Profile" },
];

export default async function CandidateLayout({ children }: { children: ReactNode }) {
  const session = await requireCandidate();

  return (
    <PortalShell navLinks={NAV_LINKS} roleLabel="Candidate" email={session.email}>
      {children}
    </PortalShell>
  );
}
