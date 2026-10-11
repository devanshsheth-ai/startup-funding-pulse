import { connection, type NextRequest } from "next/server";
import { z } from "zod";
import { isAdminAuthorized, unauthorized } from "@/lib/auth";
import { GeminiOutputError, GeminiUnavailableError, geminiConfigured, generateStructured } from "@/lib/gemini";
import { WATCH_TYPES } from "@/lib/settings-schemas";

/**
 * POST /api/watchlist/aliases — Gemini suggests aliases for a new watchlist
 * entry; nothing is saved here, the user confirms each one (PRD §18.8).
 */
const body = z.object({ watch_type: z.enum(WATCH_TYPES), value: z.string().trim().min(1).max(120), known: z.array(z.string().max(120)).max(20).default([]) });
const response = z.object({ aliases: z.array(z.object({ name: z.string().min(1).max(120), reason: z.string().max(120) })).max(6) });

export async function POST(req: NextRequest): Promise<Response> {
  await connection();
  if (!isAdminAuthorized(req)) return unauthorized();
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: "invalid request" }, { status: 400 });
  if (parsed.data.watch_type === "sector" || parsed.data.watch_type === "keyword") return Response.json({ ok: true, aliases: [] });
  if (!geminiConfigured()) return Response.json({ ok: false, error: "Gemini is not configured" }, { status: 503 });
  try {
    const { data } = await generateStructured({
      task: "classify",
      prompt: { name: "watchlist-aliases", version: 1 },
      vars: { watch_type: parsed.data.watch_type, value: parsed.data.value, known: parsed.data.known.join(", ") || "none" },
      schema: response,
      temperature: 0.1,
    });
    const known = new Set([parsed.data.value, ...parsed.data.known].map((k) => k.toLowerCase()));
    return Response.json({ ok: true, aliases: data.aliases.filter((a) => !known.has(a.name.toLowerCase())) });
  } catch (err) {
    if (err instanceof GeminiUnavailableError || err instanceof GeminiOutputError) return Response.json({ ok: false, error: "No suggestions right now" }, { status: 503 });
    throw err;
  }
}
