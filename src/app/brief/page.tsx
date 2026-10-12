import { and, desc, eq, isNotNull } from "drizzle-orm";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { RegenerateButton } from "@/components/admin";
import { CopyLinkButton, PrintButton } from "@/components/auto-print";
import { BriefView } from "@/components/brief";
import { Empty, Loading, Page, ProfileSwitcher } from "@/components/ui";
import { getDb } from "@/db/client";
import { digests } from "@/db/schema";
import { param, resolveProfile, type SearchParams } from "@/lib/view";
import { appUrl, buildDigest, loadProfileWithName, type DigestContent } from "@/pipeline/digest";

/**
 * /brief — the brief as a first-class page of the app (PRD §16, §18.10).
 * Shows the latest stored brief for the selected profile (or one picked from
 * its history) as a full dashboard; `?live=1` builds a fresh preview from the
 * current window without saving or emailing it.
 */

export const metadata = { title: "Brief · Startup Funding Pulse" };
// A live preview runs narration (~30–60 s).
export const maxDuration = 300;

const btnOnHero = "btn btn-sm border border-white/40 bg-white/10 text-white backdrop-blur hover:bg-white/20";

async function LivePreview({ profileId }: { profileId: string }) {
  const p = await loadProfileWithName(profileId);
  if (!p) return <Empty>Unknown profile.</Empty>;
  const mode = p.config.delivery.mode === "daily" ? "daily" : "weekly";
  const c = await buildDigest(p, mode, new Date());
  return (
    <BriefView
      c={c}
      shareUrl={`${appUrl()}/brief?profile=${profileId}`}
      actions={
        <>
          <span className="inline-flex items-center rounded-full bg-amber-300/90 px-3 py-1 text-xs font-bold text-amber-950">Live preview · not saved</span>
          <PrintButton className={btnOnHero} />
        </>
      }
    />
  );
}

async function Content({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const sp = await searchParams;
  const { all, active } = await resolveProfile(param(sp, "profile"));
  if (!active) return <Empty>Unknown profile.</Empty>;
  const live = param(sp, "live") === "1";
  const history = await getDb()
    .select({ id: digests.id, mode: digests.mode, generatedAt: digests.generatedAt, emailStatus: digests.emailStatus, shareToken: digests.shareToken, headline: digests.headline })
    .from(digests)
    .where(and(eq(digests.profileId, active.id), isNotNull(digests.content)))
    .orderBy(desc(digests.generatedAt))
    .limit(12);
  const wanted = Number(param(sp, "id"));
  const pick = history.find((h) => h.id === wanted) ?? history[0];
  const mode = active.config.delivery.mode === "daily" ? "daily" : "weekly";

  let content: DigestContent | null = null;
  if (!live && pick) {
    const [row] = await getDb().select({ content: digests.content }).from(digests).where(eq(digests.id, pick.id)).limit(1);
    content = (row?.content as DigestContent | null) ?? null;
  }
  const share = pick?.shareToken ? `${appUrl()}/share/${pick.shareToken}` : `${appUrl()}/brief?profile=${active.id}`;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <ProfileSwitcher path="/brief" sp={sp} profiles={all} active={active} />
        <div className="flex flex-wrap items-start gap-2">
          <Link href={live ? `/brief?profile=${active.id}` : `/brief?profile=${active.id}&live=1`} className="btn btn-secondary">
            {live ? "Back to the latest saved brief" : "Live preview"}
          </Link>
          <RegenerateButton key={active.id} profileId={active.id} mode={mode} />
        </div>
      </div>

      {history.length > 0 && !live ? (
        <nav aria-label="Brief history" className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {history.map((h) => {
            const on = h.id === pick?.id;
            return (
              <Link
                key={h.id}
                href={`/brief?profile=${active.id}&id=${h.id}`}
                className={`shrink-0 rounded-2xl px-4 py-2.5 text-left transition-all duration-200 ${on ? "bg-grad text-white shadow-[0_6px_18px_-6px_rgb(99_102_241/0.6)]" : "card card-hover text-foreground"}`}
              >
                <span className={`block text-xs font-semibold ${on ? "text-white/85" : "text-muted"}`}>
                  {h.generatedAt.toISOString().slice(0, 10)} · {h.mode}
                </span>
                <span className="flex items-center gap-1.5 text-sm font-bold">
                  <span className={`h-2 w-2 rounded-full ${h.emailStatus === "sent" ? "bg-emerald-400" : h.emailStatus === "failed" ? "bg-rose-400" : on ? "bg-white/60" : "bg-slate-300"}`} aria-hidden />
                  {h.emailStatus === "sent" ? "Sent" : h.emailStatus === "failed" ? "Not delivered" : "Generated"}
                </span>
              </Link>
            );
          })}
        </nav>
      ) : null}

      {live ? (
        <Suspense
          fallback={
            <div className="space-y-4">
              <p className="card p-5 text-sm text-muted">Building a live brief from the current window — scoring, statistics and the written analysis take about 30–60 seconds. Nothing is saved or emailed.</p>
              <Loading what="the live brief" />
            </div>
          }
        >
          <LivePreview profileId={active.id} />
        </Suspense>
      ) : content ? (
        <BriefView
          c={content}
          shareUrl={share}
          actions={
            <>
              <CopyLinkButton url={share} className={btnOnHero} />
              <PrintButton className={btnOnHero} />
            </>
          }
        />
      ) : (
        <div className="card p-8">
          <Empty>
            No brief has been generated for {active.displayName} yet. Use <strong>Regenerate brief</strong> to create one now, or <strong>Live preview</strong> to see one without saving.
          </Empty>
        </div>
      )}
    </>
  );
}

export default function BriefPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Page eyebrow="Your brief" title="Brief" subtitle="The week's funding intelligence for your mandate: what moved, what needs attention, and the deals worth your time.">
      <Suspense fallback={<Loading what="the brief" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}
