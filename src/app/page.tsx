// Next.js requires page components to be default exports (DECISIONS.md D-008).
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Startup Funding Pulse</h1>
      <p className="text-base leading-relaxed opacity-80">
        Weekly Indian startup funding intelligence: ranked deals, statistically gated patterns,
        and portfolio adjacency alerts. The data pipeline is under construction. No deals are
        shown until they have been collected from real sources.
      </p>
      <p className="text-sm opacity-70">
        Infrastructure status:{" "}
        <a className="underline underline-offset-4" href="/api/health/db">
          /api/health/db
        </a>
      </p>
    </main>
  );
}
