import { desc, eq } from "drizzle-orm";
import { connection } from "next/server";
import { Suspense } from "react";
import { Badge, Card, Empty, Loading, Page, ProfileSwitcher, Table, td } from "@/components/ui";
import { getDb } from "@/db/client";
import { digests } from "@/db/schema";
import { param, resolveProfile, type SearchParams } from "@/lib/view";

/** /digests — archive of every generated brief (S10), with web view, PDF and JSON. */

export const metadata = { title: "Digests · Startup Funding Pulse" };

async function Content({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const sp = await searchParams;
  const { all, active } = await resolveProfile(param(sp, "profile"));
  if (!active) return <p className="text-sm">Unknown profile.</p>;
  const rows = await getDb()
    .select({ id: digests.id, mode: digests.mode, headline: digests.headline, windowStart: digests.windowStart, windowEnd: digests.windowEnd, generatedAt: digests.generatedAt, emailStatus: digests.emailStatus, emailSentAt: digests.emailSentAt, shareToken: digests.shareToken })
    .from(digests)
    .where(eq(digests.profileId, active.id))
    .orderBy(desc(digests.generatedAt))
    .limit(100);
  return (
    <>
      <ProfileSwitcher path="/digests" sp={sp} profiles={all} active={active} />
      <div className="no-print flex flex-wrap gap-2 text-sm">
        <a className="btn btn-secondary btn-sm" href={`/api/digest/preview?profile=${active.id}&mode=weekly`} target="_blank" rel="noopener noreferrer">
          Preview weekly template (live, not saved) ↗
        </a>
        <a className="btn btn-secondary btn-sm" href={`/api/digest/preview?profile=${active.id}&mode=daily`} target="_blank" rel="noopener noreferrer">
          Preview daily template ↗
        </a>
      </div>
      <Card title={`Brief archive — ${active.displayName}`} n={rows.length} note="Each stored brief re-renders exactly as generated. “PDF” opens the print dialog: choose “Save as PDF”. Share links are public and read-only.">
        {rows.length === 0 ? (
          <Empty>No briefs generated yet. Use “Regenerate brief” on the dashboard.</Empty>
        ) : (
          <Table head={["Generated", "Mode", "Window", "Headline", "Email", "Open"]} minWidth={860}>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className={`${td} whitespace-nowrap text-xs`}>{r.generatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC</td>
                <td className={td}>
                  <Badge>{r.mode}</Badge>
                </td>
                <td className={`${td} whitespace-nowrap text-xs`}>
                  {r.windowStart.toISOString().slice(0, 10)} → {r.windowEnd.toISOString().slice(0, 10)}
                </td>
                <td className={td}>{r.headline}</td>
                <td className={td}>
                  {r.emailStatus === "sent" ? <Badge tone="good">sent {r.emailSentAt?.toISOString().slice(0, 10)}</Badge> : r.emailStatus === "failed" ? <Badge tone="bad">failed</Badge> : <Badge>not emailed</Badge>}
                </td>
                <td className={`${td} whitespace-nowrap text-xs`}>
                  {r.shareToken ? (
                    <>
                      <a className="link" href={`/share/${r.shareToken}`} target="_blank" rel="noopener noreferrer">
                        View
                      </a>{" "}
                      ·{" "}
                      <a className="link" href={`/share/${r.shareToken}?print=1`} target="_blank" rel="noopener noreferrer">
                        PDF
                      </a>{" "}
                      ·{" "}
                      <a className="link" href={`/share/${r.shareToken}/email`} target="_blank" rel="noopener noreferrer">
                        Email
                      </a>{" "}
                      ·{" "}
                    </>
                  ) : null}
                  <a className="link" href={`/api/digest/${r.id}`} target="_blank" rel="noopener noreferrer">
                    JSON
                  </a>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

export default function DigestsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Page eyebrow="Briefs" title="Brief archive" subtitle="Every brief generated for a profile, as sent.">
      <Suspense fallback={<Loading what="the archive" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}
