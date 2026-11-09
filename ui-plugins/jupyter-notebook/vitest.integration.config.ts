import { defineConfig } from "vitest/config";
// 真实 Jupyter Server 集成测试：由 scripts/jupyter-env.mjs 用 uv 准备隔离环境。
export default defineConfig({
  test: {
    include: ["test/**/*.integration.test.ts"],
    testTimeout: 120000,
    hookTimeout: 240000,
    fileParallelism: false,
  },
});
