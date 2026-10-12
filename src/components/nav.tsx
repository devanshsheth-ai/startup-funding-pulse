"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/trends", label: "Trends" },
  { href: "/investors", label: "Investors" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/alerts", label: "Alerts" },
  { href: "/explorer", label: "Explorer" },
  { href: "/sectors", label: "Sectors" },
  { href: "/digests", label: "Briefs" },
  { href: "/methodology", label: "Methodology" },
  { href: "/settings", label: "Settings" },
  { href: "/health", label: "Health" },
];

/** Top navigation, horizontally scrollable on small screens. Carries `?profile=` across pages. */
export function Nav() {
  const path = usePathname();
  const sp = useSearchParams();
  const profile = sp.get("profile");
  return (
    <nav aria-label="Main" className="no-scrollbar flex gap-1 overflow-x-auto text-sm">
      {LINKS.map((l) => {
        const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={profile ? `${l.href}?profile=${encodeURIComponent(profile)}` : l.href}
            className={`shrink-0 rounded-xl px-3 py-1.5 font-medium transition-all duration-200 ${
              active ? "bg-grad text-white shadow-[0_4px_14px_-4px_rgb(99_102_241/0.6)]" : "text-muted hover:bg-accent-soft hover:text-accent"
            }`}
            aria-current={active ? "page" : undefined}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
