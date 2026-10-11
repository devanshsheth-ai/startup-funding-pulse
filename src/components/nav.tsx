"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const LINKS = [
  { href: "/", label: "This period" },
  { href: "/trends", label: "Trends" },
  { href: "/investors", label: "Investors" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/alerts", label: "Alerts" },
  { href: "/explorer", label: "Explorer" },
  { href: "/sectors", label: "Sectors" },
  { href: "/digests", label: "Digests" },
  { href: "/methodology", label: "Methodology" },
  { href: "/settings", label: "Settings" },
  { href: "/health", label: "Health" },
];

/** Top navigation. Carries the active `?profile=` across pages so the switcher sticks. */
export function Nav() {
  const path = usePathname();
  const sp = useSearchParams();
  const profile = sp.get("profile");
  return (
    <nav aria-label="Main" className="flex flex-wrap gap-x-1 gap-y-1 text-sm">
      {LINKS.map((l) => {
        const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={profile ? `${l.href}?profile=${encodeURIComponent(profile)}` : l.href}
            className={`rounded-md px-2.5 py-1 ${active ? "bg-foreground text-background" : "text-muted hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"}`}
            aria-current={active ? "page" : undefined}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
