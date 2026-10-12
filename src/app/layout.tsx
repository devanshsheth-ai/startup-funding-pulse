import type { Metadata } from "next";
import { Geist_Mono, Inter, Plus_Jakarta_Sans } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import { Nav } from "@/components/nav";
import { ThemeToggle } from "@/components/theme-toggle";
import "./globals.css";

// Plus Jakarta Sans for headings and figures, Inter for body copy (D-077).
const heading = Plus_Jakarta_Sans({ variable: "--font-heading", subsets: ["latin"], weight: ["500", "600", "700", "800"] });
const body = Inter({ variable: "--font-body", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Startup Funding Pulse",
  description: "Weekly Indian startup funding intelligence: ranked deals, statistically gated patterns, and portfolio adjacency alerts.",
};

// Runs before first paint. Light by default; dark only when the user chose it. Static string, no user input.
const THEME_SCRIPT = `try{if(localStorage.getItem("fp_theme")==="dark")document.documentElement.classList.add("dark")}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${heading.variable} ${body.variable} ${mono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <header className="no-print sticky top-0 z-30 border-b border-line/70 bg-card/75 backdrop-blur-xl">
          <div className="mx-auto flex w-full max-w-7xl items-center gap-4 px-4 py-2.5">
            <Link href="/" className="group flex shrink-0 items-center gap-2.5" aria-label="Funding Pulse home">
              <span className="bg-grad grid h-9 w-9 place-items-center rounded-xl text-white shadow-[0_6px_16px_-6px_rgb(99_102_241/0.7)] transition-transform duration-300 group-hover:rotate-6 group-hover:scale-105">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M3 12h4l3-8 4 16 3-8h4" />
                </svg>
              </span>
              <span className="hidden leading-tight sm:block">
                <span className="block font-[family-name:var(--font-heading)] text-[15px] font-extrabold tracking-tight">Funding Pulse</span>
                <span className="block text-[11px] text-muted">India startup intelligence</span>
              </span>
            </Link>
            <div className="min-w-0 flex-1">
              <Suspense fallback={<div className="h-9" />}>
                <Nav />
              </Suspense>
            </div>
            <ThemeToggle />
          </div>
        </header>
        <div className="flex flex-1 flex-col">{children}</div>
        <footer className="no-print mt-8 border-t border-line/70 bg-card/60 backdrop-blur">
          <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-5 text-xs text-muted">
            <span className="flex items-center gap-2">
              <span className="live-dot" aria-hidden /> Live data from Indian startup publications · statistics in SQL · narration by Gemini with cited evidence
            </span>
            <span className="flex gap-4">
              <Link className="hover:text-accent" href="/methodology">
                Methodology
              </Link>
              <Link className="hover:text-accent" href="/health">
                System health
              </Link>
              <Link className="hover:text-accent" href="/brief/latest">
                Latest brief
              </Link>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
