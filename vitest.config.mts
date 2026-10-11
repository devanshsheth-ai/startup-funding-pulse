import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Vitest requires a default export (DECISIONS.md D-008).
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
