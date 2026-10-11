import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import { Nav } from "@/components/nav";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Startup Funding Pulse",
  description: "Weekly Indian startup funding intelligence: ranked deals, statistically gated patterns, and portfolio adjacency alerts.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <header className="border-b border-line bg-card">
          <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="font-semibold tracking-tight">
              Funding Pulse
            </Link>
            <Suspense fallback={<div className="h-7" />}>
              <Nav />
            </Suspense>
          </div>
        </header>
        <div className="flex flex-1 flex-col">{children}</div>
        <footer className="no-print border-t border-line px-4 py-4 text-center text-xs text-muted">
          Live data from Indian startup publications · statistics computed in SQL, narration by Gemini with cited evidence ·{" "}
          <Link className="link" href="/methodology">
            methodology
          </Link>{" "}
          ·{" "}
          <Link className="link" href="/health">
            system health
          </Link>
        </footer>
      </body>
    </html>
  );
}
