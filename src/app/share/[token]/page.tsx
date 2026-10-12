import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AutoPrint } from "@/components/auto-print";
import { BriefView } from "@/components/brief";
import { Loading } from "@/components/ui";
import { getDb } from "@/db/client";
import { digests, profiles } from "@/db/schema";
import { appUrl, type DigestContent } from "@/pipeline/digest";

/**
 * /share/[token] — public, read-only web brief (PRD §18.10), forwardable to
 * LPs. Rendered from the stored digest content, so it shows exactly what was
 * generated. `?print=1` opens the print dialog (PDF, PRD §23).
 */

export const metadata: Metadata = { title: "Brief · Startup Funding Pulse", robots: { index: false, follow: false } };

async function Content({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const { token } = await params;
  const sp = await searchParams;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) notFound();
  const [row] = await getDb().select({ content: digests.content }).from(digests).innerJoin(profiles, eq(profiles.id, digests.profileId)).where(and(eq(digests.shareToken, token), eq(profiles.isActive, true))).limit(1);
  if (!row?.content) notFound();
  const base = appUrl();
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      {sp.print === "1" ? <AutoPrint /> : null}
      <BriefView c={row.content as DigestContent} shareUrl={`${base}/share/${token}`} />
    </main>
  );
}

export default function SharePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-7xl px-4 py-8">
          <Loading what="the brief" />
        </main>
      }
    >
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}
