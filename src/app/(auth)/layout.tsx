import type { ReactNode } from "react";

import { ThemeToggle } from "@/components/theme-toggle";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <header className="flex items-center justify-between px-6 py-5">
        <span className="text-lg font-semibold tracking-tight">
          Hi<span className="text-brand-green">RAG</span>e
        </span>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-start justify-center px-6 pb-16 pt-6">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
