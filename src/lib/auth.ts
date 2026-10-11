import { timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";

/**
 * Secret checks for cron and mutating endpoints. Vercel Cron sends
 * `Authorization: Bearer $CRON_SECRET`. Comparison is constant-time.
 * An unset secret denies everything — endpoints never fail open.
 */

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7).trim() : null;
}

export function isCronAuthorized(req: Request): boolean {
  const { CRON_SECRET, ADMIN_SECRET } = getEnv();
  const token = bearer(req);
  if (!token) return false;
  // Admin may trigger cron stages manually (PRD §21.2).
  return (!!CRON_SECRET && safeEqual(token, CRON_SECRET)) || (!!ADMIN_SECRET && safeEqual(token, ADMIN_SECRET));
}

export function isAdminAuthorized(req: Request): boolean {
  const { ADMIN_SECRET } = getEnv();
  const token = bearer(req) ?? req.headers.get("x-admin-secret");
  return !!ADMIN_SECRET && !!token && safeEqual(token, ADMIN_SECRET);
}

export function unauthorized(): Response {
  return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
}
