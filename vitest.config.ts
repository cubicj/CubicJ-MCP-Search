import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    restoreMocks: true,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
