import { eq } from "drizzle-orm";
import { z } from "zod";
import type { MandateConfig } from "@/config/profile";
import { getDb } from "@/db/client";
import { digests, profiles } from "@/db/schema";
import { renderDigest } from "@/emails/render";
import { getEnv, requireEnv } from "@/lib/env";
import { runLogger } from "@/lib/logger";
import { startStage } from "@/lib/run-log";
import { buildDigest, loadProfileWithName, persistDigest, type DigestMode } from "@/pipeline/digest";
import type { StageResult } from "@/pipeline/ingest/collect";
import { loadProfiles } from "@/pipeline/score";

/**
 * Stage J (delivery) — email via Resend. last_digest_sent_at advances ONLY
 * after a successful send (CLAUDE.md §7.2); a failed send leaves the window
 * open so no deal is lost, and the digest stays viewable on the web.
 */

const resendOk = z.object({ id: z.string() });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface SendResult {
  ok: boolean;
  providerId: string | null;
  attempts: number;
  error: string | null;
}

export async function sendEmail(msg: { to: string[]; subject: string; html: string; text: string; idempotencyKey: string }): Promise<SendResult> {
  const key = requireEnv("RESEND_API_KEY");
  const from = requireEnv("EMAIL_FROM");
  let last: string | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": msg.idempotencyKey },
        body: JSON.stringify({ from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text }),
        signal: AbortSignal.timeout(20_000),
      });
      const body: unknown = await res.json().catch(() => ({}));
      if (res.ok) {
        const parsed = resendOk.safeParse(body);
        return { ok: true, providerId: parsed.success ? parsed.data.id : null, attempts: attempt, error: null };
      }
      last = `HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`;
      if (res.status < 500 && res.status !== 429) break; // not retryable
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    if (attempt < 3) await sleep(1_000 * 2 ** (attempt - 1));
  }
  return { ok: false, providerId: null, attempts: 3, error: last };
}

/** Recipients: DIGEST_TO overrides the profile list (unverified sender domain, D-057). */
export function recipientsFor(cfg: MandateConfig): string[] {
  const override = getEnv().DIGEST_TO;
  return override ? override.split(",").map((s) => s.trim()).filter(Boolean) : cfg.delivery.recipients;
}

// ─── Scheduling (pure) ─────────────────────────────────────────────────────

type Weekday = MandateConfig["delivery"]["days"][number];

function localParts(now: Date, timeZone: string): { weekday: string; hhmm: string; date: string } {
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long", hour: "2-digit", minute: "2-digit", hour12: false, year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return { weekday: String(parts.weekday).toLowerCase(), hhmm: `${parts.hour}:${parts.minute}`, date: `${parts.year}-${parts.month}-${parts.day}` };
}

/**
 * Is a digest due for this profile now? True when today (in the profile's
 * timezone) is a delivery day, the send hour has passed, and nothing was
 * sent yet today. Daily mode ignores `days`.
 */
export function isDue(cfg: MandateConfig, lastSent: Date | null, now: Date): { due: boolean; mode: DigestMode; reason: string } {
  const d = cfg.delivery;
  const mode: DigestMode = d.mode === "daily" ? "daily" : "weekly";
  const local = localParts(now, d.timezone);
  if (mode !== "daily" && !d.days.includes(local.weekday as Weekday)) return { due: false, mode, reason: `not a delivery day (${local.weekday})` };
  if (local.hhmm < d.send_hour) return { due: false, mode, reason: `before send hour ${d.send_hour} (${local.hhmm} ${d.timezone})` };
  if (lastSent && localParts(lastSent, d.timezone).date === local.date) return { due: false, mode, reason: "already sent today" };
  return { due: true, mode, reason: "due" };
}

// ─── Generate (and optionally send) ────────────────────────────────────────

export interface DeliveryOutcome {
  profileId: string;
  mode: DigestMode;
  digestId: number | null;
  status: "sent" | "failed" | "skipped" | "generated";
  reason: string;
  shareUrl: string | null;
}

export async function generateAndMaybeSend(profileId: string, mode: DigestMode, opts: { send: boolean; runId: string; now?: Date }): Promise<DeliveryOutcome> {
  const log = runLogger(opts.runId, "deliver");
  const now = opts.now ?? new Date();
  const profile = await loadProfileWithName(profileId);
  if (!profile) return { profileId, mode, digestId: null, status: "skipped", reason: "unknown profile", shareUrl: null };
  const content = await buildDigest(profile, mode, now);

  // Never send an empty email (PRD §16.2). Generating without sending (Regenerate) is always allowed.
  if (opts.send && content.counts.aggregatesN < profile.config.delivery.min_deals_to_send) {
    log.info("digest skipped: below min_deals_to_send", { profile: profileId, mode, deals: content.counts.aggregatesN });
    return { profileId, mode, digestId: null, status: "skipped", reason: `${content.counts.aggregatesN} deals < min ${profile.config.delivery.min_deals_to_send}`, shareUrl: null };
  }

  const { id, shareToken } = await persistDigest(content);
  const shareUrl = content.links.share;
  if (!opts.send) return { profileId, mode, digestId: id, status: "generated", reason: "generated without sending", shareUrl };

  const { html, text, subject } = await renderDigest(content);
  const result = await sendEmail({ to: recipientsFor(profile.config), subject, html, text, idempotencyKey: `digest-${id}-${shareToken.slice(0, 8)}` });
  const db = getDb();
  if (result.ok) {
    await db.update(digests).set({ emailSentAt: new Date(), emailStatus: "sent", updatedAt: new Date() }).where(eq(digests.id, id));
    // Window advances only now, after a confirmed send.
    await db.update(profiles).set({ lastDigestSentAt: new Date(content.generatedAt), updatedAt: new Date() }).where(eq(profiles.id, profileId));
    log.info("digest sent", { profile: profileId, mode, digest_id: id, provider_id: result.providerId, attempts: result.attempts });
    return { profileId, mode, digestId: id, status: "sent", reason: `sent after ${result.attempts} attempt(s)`, shareUrl };
  }
  await db.update(digests).set({ emailStatus: "failed", updatedAt: new Date() }).where(eq(digests.id, id));
  log.error("digest send failed; window not advanced", { profile: profileId, mode, digest_id: id, error: result.error });
  return { profileId, mode, digestId: id, status: "failed", reason: result.error ?? "send failed", shareUrl };
}

/** Dispatcher stage: send every profile whose schedule is due. */
export async function runDeliver(opts: { runId: string; cursor: string | null; deadline: number }): Promise<StageResult> {
  const stage = await startStage(opts.runId, "deliver");
  const now = new Date();
  const outcomes: (DeliveryOutcome | { profileId: string; status: "not_due"; reason: string })[] = [];
  const env = getEnv();
  for (const p of await loadProfiles()) {
    const due = isDue(p.config, p.lastDigestSentAt, now);
    if (!due.due) {
      outcomes.push({ profileId: p.id, status: "not_due", reason: due.reason });
      continue;
    }
    if (Date.now() > opts.deadline) break;
    outcomes.push(await generateAndMaybeSend(p.id, due.mode, { send: !!env.RESEND_API_KEY && !!env.EMAIL_FROM, runId: opts.runId, now }));
  }
  const failed = outcomes.filter((o) => o.status === "failed").length;
  stage.counters.itemsOut = outcomes.filter((o) => o.status === "sent").length;
  await stage.finish(failed ? "partial" : "ok", { outcomes });
  return { processed: outcomes.length, next_cursor: null };
}
