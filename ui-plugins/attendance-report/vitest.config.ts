import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["src/**/*.test.ts", "test/**/*.test.ts"], testTimeout: 120000, hookTimeout: 120000 } });
