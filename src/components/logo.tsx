/**
 * Dealscope brand (D-088): a lens with three rising bars inside, drawn on the
 * brand gradient. `animated` draws it in (ring sweeps closed, bars grow, handle
 * follows) using the `.ds-*` keyframes in globals.css; reduced-motion users get
 * the finished mark. Server component, plain SVG.
 */

export const BRAND = { name: "Dealscope", tagline: "Startup funding intelligence" } as const;

/** The lens-and-bars glyph, stroked in `currentColor`. */
export function LogoGlyph({ size = 20, animated = false, className = "" }: { size?: number; animated?: boolean; className?: string }) {
  const a = animated ? "ds-animate" : "";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`${a} ${className}`}>
      <circle className="ds-ring" cx="10.5" cy="10.5" r="7" strokeWidth="2.2" pathLength={100} transform="rotate(-90 10.5 10.5)" />
      <path className="ds-handle" d="M15.7 15.7 20.6 20.6" strokeWidth="2.6" pathLength={100} />
      <rect className="ds-bar ds-bar-1" x="6.9" y="11" width="1.9" height="3" rx="0.95" fill="currentColor" stroke="none" />
      <rect className="ds-bar ds-bar-2" x="9.55" y="9" width="1.9" height="5" rx="0.95" fill="currentColor" stroke="none" />
      <rect className="ds-bar ds-bar-3" x="12.2" y="7" width="1.9" height="7" rx="0.95" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Gradient tile with the glyph: the app icon. */
export function LogoMark({ size = 36, animated = false, className = "" }: { size?: number; animated?: boolean; className?: string }) {
  return (
    <span
      className={`bg-grad grid shrink-0 place-items-center text-white shadow-[0_6px_16px_-6px_rgb(99_102_241/0.7)] ${className}`}
      style={{ width: size, height: size, borderRadius: size * 0.3 }}
    >
      <LogoGlyph size={Math.round(size * 0.58)} animated={animated} />
    </span>
  );
}

/** "Deal" in the text colour, "scope" in the gradient. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-[family-name:var(--font-heading)] font-extrabold tracking-tight ${className}`}>
      Deal<span className="text-gradient">scope</span>
    </span>
  );
}

/**
 * Intro shown on every full page load (refresh or first visit): the mark draws
 * itself, the name rises in, then the overlay fades. Pure CSS, so it also
 * clears without JavaScript; client-side navigation never replays it because
 * the root layout stays mounted.
 */
export function Splash() {
  return (
    <div className="ds-splash no-print" aria-hidden>
      <div className="flex flex-col items-center gap-4">
        <LogoMark size={76} animated className="ds-splash-mark" />
        <div className="ds-splash-text text-center">
          <Wordmark className="text-3xl" />
          <p className="mt-1 text-sm font-medium text-muted">{BRAND.tagline}</p>
        </div>
      </div>
    </div>
  );
}
