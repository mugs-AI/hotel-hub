import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { resolve } from "node:path";
export default defineConfig({
  resolve: { alias: { "@": resolve("src") } },
  plugins: [tsconfigPaths()],
  test: { environment: "node", include: ["scripts/verification/hh-deposit-module-ui.test.ts"] },
});
