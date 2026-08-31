import Link from "next/link";
import type { ReactNode } from "react";

import { signOutAction } from "@/lib/actions/auth";
import { ThemeToggle } from "./theme-toggle";
import { Button } from "./ui";

export interface NavLink {
  href: string;
  label: string;
}

export function PortalShell({
  navLinks,
  roleLabel,
  email,
  children,
}: {
  navLinks: NavLink[];
  roleLabel: string;
  email: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-surface">
      <header className="border-b border-[var(--border)] bg-surface-raised">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-6 py-4">
          <Link href={navLinks[0]?.href ?? "/"} className="text-lg font-semibold tracking-tight">
            Hi<span className="text-brand-green">RAG</span>e
          </Link>
          <span className="rounded-full bg-brand-blue-soft px-2.5 py-0.5 text-xs font-medium text-brand-blue">
            {roleLabel}
          </span>

          <nav className="order-3 flex w-full gap-1 text-sm md:order-none md:w-auto">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-lg px-3 py-1.5 text-muted transition hover:bg-surface hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-muted sm:inline">{email}</span>
            <ThemeToggle />
            <form action={signOutAction}>
              <Button variant="outline" type="submit">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
