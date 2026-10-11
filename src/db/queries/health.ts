import { z } from "zod";
import { getSql } from "@/db/client";

/**
 * Infrastructure probes for M0: database reachability and a pgvector round
 * trip. Read-only — nothing is written.
 */

const PROBE_VECTOR = [0.125, -0.5, 0.75] as const;
const PROBE_OTHER = [0.125, -0.5, 0.5] as const;

/** pgvector serialises as "[0.125,-0.5,0.75]". */
export function parsePgVector(text: string): number[] {
  const trimmed = text.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    throw new Error("Not a pgvector literal");
  }
  const body = trimmed.slice(1, -1).trim();
  if (body === "") return [];
  return body.split(",").map((part) => {
    const n = Number(part);
    if (!Number.isFinite(n)) throw new Error("Non-numeric vector component");
    return n;
  });
}

export function toPgVector(values: readonly number[]): string {
  return `[${values.join(",")}]`;
}

export function cosineDistance(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) throw new Error("Dimension mismatch");
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const selectOneRow = z.object({ ok: z.coerce.number() });
const vectorRow = z.object({
  echoed: z.string(),
  distance: z.coerce.number(),
  dims: z.coerce.number(),
  extversion: z.string().nullable(),
});

export interface DbProbeResult {
  selectOne: { ok: boolean; latencyMs: number };
  vector: {
    ok: boolean;
    extensionVersion: string | null;
    sent: number[];
    echoed: number[];
    dims: number;
    dbCosineDistance: number;
    expectedCosineDistance: number;
  };
}

export async function probeDatabase(): Promise<DbProbeResult> {
  const sql = getSql();

  const t0 = Date.now();
  const one = selectOneRow.parse((await sql`SELECT 1 AS ok`)[0]);
  const latencyMs = Date.now() - t0;

  const sent = toPgVector(PROBE_VECTOR);
  const other = toPgVector(PROBE_OTHER);
  const row = vectorRow.parse(
    (
      await sql`
        SELECT
          ${sent}::vector::text                     AS echoed,
          ${sent}::vector <=> ${other}::vector       AS distance,
          vector_dims(${sent}::vector)               AS dims,
          (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS extversion
      `
    )[0],
  );

  const echoed = parsePgVector(row.echoed);
  const expected = cosineDistance(PROBE_VECTOR, PROBE_OTHER);
  const roundTripOk =
    echoed.length === PROBE_VECTOR.length &&
    echoed.every((v, i) => Math.abs(v - (PROBE_VECTOR[i] ?? NaN)) < 1e-6) &&
    Math.abs(row.distance - expected) < 1e-5 &&
    row.extversion !== null;

  return {
    selectOne: { ok: one.ok === 1, latencyMs },
    vector: {
      ok: roundTripOk,
      extensionVersion: row.extversion,
      sent: [...PROBE_VECTOR],
      echoed,
      dims: row.dims,
      dbCosineDistance: row.distance,
      expectedCosineDistance: expected,
    },
  };
}
