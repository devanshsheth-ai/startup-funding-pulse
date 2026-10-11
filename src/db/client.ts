import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

/**
 * Neon over HTTP. Each query is a stateless fetch, so serverless invocations
 * never hold or exhaust a TCP pool (CLAUDE.md §0.4).
 */

export type Database = NeonHttpDatabase<typeof schema>;

let sqlClient: NeonQueryFunction<false, false> | undefined;
let dbClient: Database | undefined;

export function getSql(): NeonQueryFunction<false, false> {
  sqlClient ??= neon(getEnv().DATABASE_URL);
  return sqlClient;
}

export function getDb(): Database {
  dbClient ??= drizzle({ client: getSql(), schema });
  return dbClient;
}
