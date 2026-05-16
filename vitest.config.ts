import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/lib/scheduler/**/*.ts"],
      exclude: ["src/lib/scheduler/demo.ts", "src/lib/scheduler/index.ts"],
      // Branch coverage is reported strictly, but the test suite enforces
      // statement/line coverage as the primary signal (heuristic logic
      // intentionally short-circuits on edge cases that are exhaustively
      // documented in tests but not always re-exercised at the branch level).
      thresholds: {
        branches: 70,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
});
