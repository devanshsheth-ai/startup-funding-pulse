import { connection } from "next/server";
import { Suspense } from "react";
import { AdminBar } from "@/components/settings/admin-bar";
import { MandateEditor } from "@/components/settings/mandate-editor";
import { ManualDealForm } from "@/components/settings/manual-deal";
import { PortfolioManager } from "@/components/settings/portfolio-manager";
import { WatchlistManager } from "@/components/settings/watchlist-manager";
import { Card, Disclosure, Loading, Page, ProfileSwitcher } from "@/components/ui";
import { getTracked, getWatchlist, getWatchSuggestions } from "@/db/queries/portfolio";
import { getEnv } from "@/lib/env";
import { ALL_STAGES, SECTORS } from "@/lib/taxonomy";
import { param, resolveProfile, type SearchParams } from "@/lib/view";

/**
 * /settings (PRD §18.8): mandate editor with Tune weights, watchlist and
 * portfolio management. Reading is public; every save goes through an
 * endpoint that requires ADMIN_SECRET.
 */

export const metadata = { title: "Settings · Startup Funding Pulse" };

async function Content({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const sp = await searchParams;
  const { all, active } = await resolveProfile(param(sp, "profile"));
  if (!active) return <p className="text-sm">Unknown profile.</p>;
  const [watch, tracked, suggestions] = await Promise.all([getWatchlist(active.id), getTracked(active.id), getWatchSuggestions(active.id)]);
  return (
    <>
      <ProfileSwitcher path="/settings" sp={sp} profiles={all} active={active} />
      <AdminBar />
      <section id="mandate" className="space-y-2">
        <h2 className="text-lg font-semibold">Mandate — {active.displayName}</h2>
        <p className="text-sm text-muted">{active.config.assumption_note}</p>
        {/* key: switching profile remounts the editor with that profile's config */}
        <MandateEditor
          key={active.id}
          profileId={active.id}
          initial={active.config}
          sectors={[...SECTORS]}
          stages={[...ALL_STAGES]}
          triggerKeys={Object.keys(active.config.alerts.triggers_enabled)}
          digestToOverride={!!getEnv().DIGEST_TO}
        />
      </section>
      <section id="watchlist" className="space-y-2">
        <h2 className="text-lg font-semibold">Watchlist</h2>
        <WatchlistManager key={active.id} profileId={active.id} rows={watch} suggestions={suggestions} />
      </section>
      <section id="portfolio" className="space-y-2">
        <h2 className="text-lg font-semibold">Tracked companies (simulated portfolio)</h2>
        <Disclosure />
        <PortfolioManager key={active.id} profileId={active.id} tracked={tracked} sectors={[...SECTORS]} stages={[...ALL_STAGES]} />
      </section>
      <Card title="Add a deal the feeds missed" note="Paste the URL of a real article. It is fetched (robots.txt respected) and runs through the same classify → extract → dedupe pipeline, marked ingestion_mode = manual. Deal fields are never typed in by hand.">
        <ManualDealForm />
      </Card>
    </>
  );
}

export default function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Page title="Settings" subtitle="Change the mandate, then Regenerate on the dashboard to see the brief reorder.">
      <Suspense fallback={<Loading what="settings" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}
