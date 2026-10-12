import type { Metadata } from "next";
import { Geist_Mono, Inter, Inter_Tight } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import { BRAND, LogoGlyph, Splash, Wordmark } from "@/components/logo";
import { Nav } from "@/components/nav";
import { ThemeToggle } from "@/components/theme-toggle";
import "./globals.css";

// Inter Tight for headings and figures (tight display tracking), Inter for body copy.
const heading = Inter_Tight({ variable: "--font-heading", subsets: ["latin"], weight: ["500", "600", "700", "800"] });
const body = Inter({ variable: "--font-body", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: `${BRAND.name} — ${BRAND.tagline}`,
  description: "Dealscope: weekly Indian startup funding intelligence with ranked deals, statistically gated patterns, and portfolio adjacency alerts.",
  applicationName: BRAND.name,
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
        <Splash />
        <header className="no-print sticky top-0 z-30 px-3 pt-3 sm:px-4">
          <div className="mx-auto flex w-full max-w-7xl items-center gap-4 rounded-full bg-[#121214] py-2 pl-2.5 pr-2 text-white shadow-[0_14px_40px_-18px_rgb(0_0_0/0.7)] ring-1 ring-white/10">
            <Link href="/" className="ds-hover group flex shrink-0 items-center gap-2.5 pr-2" aria-label={`${BRAND.name} home`}>
              <span className="ds-tile grid h-9 w-9 place-items-center rounded-full transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-105">
                <LogoGlyph size={20} />
              </span>
              <span className="hidden leading-tight sm:block">
                <Wordmark onDark className="block text-[17px]" />
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
              <span className="live-dot" aria-hidden /> <span className="font-semibold text-foreground">{BRAND.name}</span> · Live data from Indian startup publications · statistics in SQL · narration by Gemini with cited evidence
            </span>
            <span className="flex gap-4">
              <Link className="hover:text-accent" href="/methodology">
                Methodology
              </Link>
              <Link className="hover:text-accent" href="/health">
                System health
              </Link>
              <Link className="hover:text-accent" href="/brief">
                Latest brief
              </Link>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
