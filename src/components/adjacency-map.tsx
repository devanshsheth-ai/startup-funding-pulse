import { usd } from "@/lib/format";

/**
 * Radial adjacency map (server-rendered SVG): each tracked company at the
 * centre, the startups that raised around it as satellites. Satellite size =
 * amount raised; colour = relationship. Hover a satellite for the rationale;
 * click it to open the source article.
 */

export interface AdjacencyGroup {
  portfolio: string;
  items: { company: string; relationship: string; amountUsd: number | null; url: string | null; rationale: string; stage: string }[];
}

const REL = {
  competitor: { color: "#e11d48", label: "Competitor" },
  same_layer: { color: "#f59e0b", label: "Same layer" },
  supplier: { color: "#6366f1", label: "Supplier" },
  customer: { color: "#06b6d4", label: "Customer" },
  complement: { color: "#8b5cf6", label: "Complement" },
} as const;

function relOf(r: string) {
  return REL[r as keyof typeof REL] ?? { color: "#94a3b8", label: r };
}

function Radar({ g, idx }: { g: AdjacencyGroup; idx: number }) {
  const W = 300;
  const H = 230;
  const cx = W / 2;
  const cy = H / 2 - 4;
  const items = g.items.slice(0, 8);
  const maxAmt = Math.max(1, ...items.map((i) => i.amountUsd ?? 0));
  const R = items.length > 5 ? 86 : 78;
  const words = g.portfolio.split(" ");
  const line1 = words.slice(0, Math.ceil(words.length / 2)).join(" ");
  const line2 = words.slice(Math.ceil(words.length / 2)).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${items.length} raises adjacent to ${g.portfolio}`}>
      <defs>
        <radialGradient id={`core-${idx}`} cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#a5b4fc" />
          <stop offset="0.55" stopColor="#6366f1" />
          <stop offset="1" stopColor="#7c3aed" />
        </radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="var(--grid)" strokeDasharray="3 5" />
      <circle cx={cx} cy={cy} r={R * 0.55} fill="none" stroke="var(--grid)" strokeDasharray="2 6" />
      {items.map((it, i) => {
        // Small groups sit on a diagonal so one or two satellites do not stack vertically.
        const a = (items.length <= 2 ? -Math.PI * 0.8 : -Math.PI / 2) + (2 * Math.PI * i) / items.length;
        const x = cx + R * Math.cos(a);
        const y = cy + R * Math.sin(a);
        const r = 6 + 12 * Math.sqrt((it.amountUsd ?? 0) / maxAmt);
        const rel = relOf(it.relationship);
        const below = Math.sin(a) > 0.2;
        const label = it.company.length > 14 ? `${it.company.slice(0, 13)}…` : it.company;
        const node = (
          <g className="animate-in" style={{ animationDelay: `${150 + i * 70}ms` }}>
            <title>{`${it.company} — ${rel.label}, ${it.stage}, ${usd(it.amountUsd)}. ${it.rationale}`}</title>
            <line x1={cx} y1={cy} x2={x} y2={y} stroke={rel.color} strokeOpacity={0.45} strokeWidth={2} strokeLinecap="round" />
            <circle cx={x} cy={y} r={r + 4} fill={rel.color} fillOpacity={0.15} />
            <circle cx={x} cy={y} r={r} fill={rel.color} stroke="var(--card)" strokeWidth={2} />
            <text x={x} y={below ? y + r + 13 : y - r - 6} textAnchor="middle" fontSize="10.5" fontWeight={600} fill="var(--foreground)">
              {label}
            </text>
          </g>
        );
        return it.url ? (
          <a key={it.company + i} href={it.url} target="_blank" rel="noopener noreferrer">
            {node}
          </a>
        ) : (
          <g key={it.company + i}>{node}</g>
        );
      })}
      <circle cx={cx} cy={cy} r={34} fill={`url(#core-${idx})`} stroke="var(--card)" strokeWidth={3} />
      <text x={cx} y={line2 ? cy - 2 : cy + 4} textAnchor="middle" fontSize="10.5" fontWeight={700} fill="#fff">
        {line1.length > 13 ? `${line1.slice(0, 12)}…` : line1}
      </text>
      {line2 ? (
        <text x={cx} y={cy + 11} textAnchor="middle" fontSize="10.5" fontWeight={700} fill="#fff">
          {line2.length > 13 ? `${line2.slice(0, 12)}…` : line2}
        </text>
      ) : null}
    </svg>
  );
}

export function AdjacencyMap({ groups }: { groups: AdjacencyGroup[] }) {
  const used = new Set(groups.flatMap((g) => g.items.map((i) => i.relationship)));
  return (
    <div>
      <div className={`grid gap-4 ${groups.length > 1 ? "sm:grid-cols-2" : ""}`}>
        {groups.map((g, i) => (
          <div key={g.portfolio} className="rounded-2xl bg-card-2 p-2 ring-1 ring-line/60">
            <Radar g={g} idx={i} />
            <p className="pb-1 text-center text-xs text-muted">
              {g.items.length} adjacent raise{g.items.length === 1 ? "" : "s"} around <span className="font-semibold text-foreground">{g.portfolio}</span>
            </p>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted">
        {Object.entries(REL)
          .filter(([k]) => used.has(k))
          .map(([k, v]) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: v.color }} />
              {v.label}
            </span>
          ))}
        <span>· circle size = amount raised · hover for why · click for source</span>
      </div>
    </div>
  );
}
