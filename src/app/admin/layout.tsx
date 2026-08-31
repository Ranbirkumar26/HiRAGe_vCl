import type { ReactNode } from "react";

import { PortalShell } from "@/components/portal-shell";
import { isSuperAdmin, requireAdmin } from "@/lib/auth/session";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireAdmin();

  const navLinks = [
    { href: "/admin", label: "Jobs" },
    { href: "/admin/profile", label: "Profile" },
  ];
  if (isSuperAdmin(session.profile)) {
    navLinks.push({ href: "/admin/access", label: "Access" });
  }

  return (
    <PortalShell navLinks={navLinks} roleLabel="Admin" email={session.email}>
      {children}
    </PortalShell>
  );
}
