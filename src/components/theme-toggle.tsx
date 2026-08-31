"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

const STORAGE_KEY = "hirage-theme";

/** Day and night mode toggle, shared by both portals. */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    setReady(true);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
    } catch {
      // Private browsing modes can refuse storage; the toggle still works for
      // this page view, it simply will not be remembered.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to day mode" : "Switch to night mode"}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-strong)] text-muted transition hover:text-foreground"
    >
      {ready && dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
