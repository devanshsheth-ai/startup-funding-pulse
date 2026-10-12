/** Semicircular gauge (pure SVG, server-rendered) with a gradient arc and an animated sweep. */
export function Gauge({ value, max = 100, label, caption }: { value: number; max?: number; label: string; caption?: string }) {
  const v = Math.max(0, Math.min(max, value));
  const r = 80;
  const cx = 100;
  const cy = 96;
  const len = Math.PI * r;
  const frac = v / max;
  const angle = Math.PI * (1 - frac);
  const nx = cx + (r - 22) * Math.cos(angle);
  const ny = cy - (r - 22) * Math.sin(angle);
  const mood = frac >= 0.65 ? "Hot" : frac >= 0.55 ? "Warm" : frac > 0.45 ? "Normal" : frac > 0.35 ? "Cool" : "Cold";
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 116" className="w-full max-w-[240px]" role="img" aria-label={`${label}: ${Math.round(v)} of ${max}`}>
        <defs>
          <linearGradient id="gaugeArc" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#06b6d4" />
            <stop offset="50%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#ec4899" />
          </linearGradient>
        </defs>
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="var(--grid)" strokeWidth="16" strokeLinecap="round" />
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke="url(#gaugeArc)"
          strokeWidth="16"
          strokeLinecap="round"
          strokeDasharray={`${len * frac} ${len}`}
          style={{ transition: "stroke-dasharray 1s ease" }}
        >
          <animate attributeName="stroke-dasharray" from={`0 ${len}`} to={`${len * frac} ${len}`} dur="1.1s" fill="freeze" calcMode="spline" keySplines="0.2 0.7 0.2 1" keyTimes="0;1" />
        </path>
        <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="var(--foreground)" strokeWidth="3" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="6" fill="var(--foreground)" />
        <text x={cx - r} y={cy + 16} fontSize="9" textAnchor="middle" fill="var(--muted)">
          0
        </text>
        <text x={cx + r} y={cy + 16} fontSize="9" textAnchor="middle" fill="var(--muted)">
          {max}
        </text>
      </svg>
      <div className="-mt-1 text-center">
        <div className="num text-3xl font-extrabold">
          {Math.round(v)}
          <span className="text-base font-semibold text-muted">/{max}</span>
        </div>
        <div className="text-xs font-semibold text-gradient">{mood}</div>
        {caption ? <p className="mt-1 max-w-[220px] text-[11px] text-muted">{caption}</p> : null}
      </div>
    </div>
  );
}
