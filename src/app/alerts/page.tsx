import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Badge, Card, Empty, Loading, Page, Pills, ProfileSwitcher, Table, td } from "@/components/ui";
import { getAlertCounts, getAlertInbox } from "@/db/queries/alerts";
import { hrefWith, param, resolveProfile, type SearchParams } from "@/lib/view";
import { TRIGGERS, type TriggerKey } from "@/pipeline/alerts/policy";

/**
 * /alerts — the in-app alert inbox (PRD §15.2 rule 6): every alert the engine
 * produced, sent or not, with the hygiene rule that decided its fate.
 */

export const metadata = { title: "Alerts · Startup Funding Pulse" };

const STATUSES = ["sent", "pending", "queued", "batched", "digested", "suppressed"] as const;
const STATUS_TONE: Record<string, "good" | "warn" | "neutral" | "accent" | "bad"> = { sent: "good", digested: "good", pending: "accent", queued: "warn", batched: "neutral", suppressed: "neutral" };
const STATUS_HELP: Record<string, string> = {
  sent: "emailed immediately",
  pending: "admitted, waiting to be emailed",
  queued: "inside quiet hours; released when they end",
  batched: "held for the next digest (below the immediate threshold, daily cap, cooldown or delivery rule)",
  digested: "included in a digest",
  suppressed: "not sent: alerts or this trigger switched off in settings",
};

async function Content({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const sp = await searchParams;
  const { all, active } = await resolveProfile(param(sp, "profile"));
  if (!active) return <p className="text-sm">Unknown profile.</p>;
  const status = STATUSES.find((s) => s === param(sp, "status")) ?? null;
  const [rows, counts] = await Promise.all([getAlertInbox(active.id, status), getAlertCounts(active.id)]);
  const a = active.config.alerts;
  return (
    <>
      <ProfileSwitcher path="/alerts" sp={sp} profiles={all} active={active} />
      <Pills
        label="Status"
        items={[
          { href: hrefWith("/alerts", sp, { status: null }), label: `All (${Object.values(counts).reduce((x, y) => x + y, 0)})`, active: status === null },
          ...STATUSES.map((s) => ({ href: hrefWith("/alerts", sp, { status: s }), label: `${s} (${counts[s] ?? 0})`, active: status === s })),
        ]}
      />
      <p className="text-xs text-muted">
        Rules for {active.displayName}: alerts {a.enabled ? "on" : "off"}; immediate when severity ≥ {a.severity_threshold}, otherwise held for the next digest; quiet hours {a.quiet_hours[0]}–{a.quiet_hours[1]} ({active.config.delivery.timezone}); at most{" "}
        {a.max_immediate_per_day} immediate alerts a day; one non-critical alert per tracked company per 24 h; cluster = {a.cluster_threshold}+ adjacent raises in {a.cluster_window_days} days. Each
        event alerts once (unique dedupe key). <Link className="link" href={`/settings?profile=${active.id}#mandate`}>Change in settings</Link>.
      </p>
      <Card title="Alert log" n={rows.length}>
        {rows.length === 0 ? (
          <Empty>No alerts {status ? `with status “${status}”` : "yet"}. The engine runs after every pipeline cycle and again after quiet hours.</Empty>
        ) : (
          <Table head={["When", "Severity", "Trigger", "Alert", "Status", "Why"]} minWidth={900}>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className={`${td} whitespace-nowrap text-xs`}>{r.createdAt.slice(0, 16)}</td>
                <td className={td}>
                  <Badge tone={r.severity === "critical" ? "bad" : r.severity === "high" ? "warn" : "neutral"}>{r.severity}</Badge>
                </td>
                <td className={`${td} text-xs text-muted`}>{TRIGGERS[r.triggerKey as TriggerKey]?.label ?? r.triggerKey}</td>
                <td className={td}>
                  <span className="font-medium">{r.title}</span>
                  <div className="text-xs text-muted">{r.body}</div>
                  {r.sourceUrl ? (
                    <a className="link text-xs" href={r.sourceUrl} target="_blank" rel="noopener noreferrer">
                      source ↗
                    </a>
                  ) : null}
                </td>
                <td className={td} title={STATUS_HELP[r.status]}>
                  <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</Badge>
                  {r.sentAt ? <div className="text-[11px] text-muted">{r.sentAt.slice(0, 16)}</div> : null}
                </td>
                <td className={`${td} text-xs text-muted`}>{r.reason ?? STATUS_HELP[r.status] ?? ""}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

export default function AlertsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Page title="Alerts" subtitle="Every alert the engine raised, and what happened to it.">
      <Suspense fallback={<Loading what="alerts" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}
