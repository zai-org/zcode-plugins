import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "ui/**/*.test.ts", "scripts/*.test.mjs"],
    testTimeout: 30_000,
    // registry 的外部变更检测依赖 fs.watch 时序，串行执行避免并行负载抖动。
    fileParallelism: false,
  },
});
