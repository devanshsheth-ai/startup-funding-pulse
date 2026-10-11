"use client";

// Next.js requires error boundaries to be default exports (DECISIONS.md D-008).

/** Route-level error boundary: a calm message, never a stack trace (CLAUDE.md §6). */
export default function RouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto w-full max-w-2xl space-y-3 px-4 py-16">
      <h1 className="text-xl font-semibold">This section is temporarily unavailable</h1>
      <p className="text-sm text-muted">
        A data source or query failed. Other pages keep working, and the last good digest is still servable. Pipeline status is on{" "}
        <a className="link" href="/health">
          /health
        </a>
        .
      </p>
      <button type="button" onClick={reset} className="rounded-md border border-line px-3 py-1 text-sm">
        Try again
      </button>
    </main>
  );
}
