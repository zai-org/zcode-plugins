import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    // markdown 渲染走 DOMPurify，需要 jsdom 提供 window
    environment: "jsdom",
    include: ["ui/**/*.test.mjs"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
