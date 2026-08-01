import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pins environment configuration before src/config/env.ts is imported.
    setupFiles: ["./tests/setup-env.ts"],
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
