import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "HiRAGe",
  description: "Resume shortlisting powered by retrieval augmented generation.",
};

/** Applies the stored theme before first paint so the page never flashes. */
const THEME_BOOTSTRAP = `
(function () {
  try {
    var stored = localStorage.getItem('hirage-theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (stored === 'dark' || (!stored && prefersDark)) {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
