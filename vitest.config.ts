import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  // Exercise Firebase's browser adapter; its Node entry deliberately omits Chrome integration.
  resolve: {
    alias: {
      "firebase/ai": fileURLToPath(
        new URL(
          "./node_modules/@firebase/ai/dist/esm/index.esm.js",
          import.meta.url,
        ),
      ),
    },
  },
  test: { include: ["tests/unit/**/*.test.ts"], environment: "node" },
});
