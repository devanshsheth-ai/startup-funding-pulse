import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// drizzle-kit requires a default export; the named-exports rule applies to
// application code (see DECISIONS.md D-008).
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
