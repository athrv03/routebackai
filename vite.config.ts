import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { crx } from "@crxjs/vite-plugin";
import { build } from "esbuild";
import manifest from "./manifest.config";
export default defineConfig(({ mode }) => {
  const outDir =
    mode === "demo"
      ? "dist-demo"
      : mode === "private"
        ? "dist-private"
        : "dist";
  return {
    plugins: [
      react(),
      tailwindcss(),
      crx({ manifest }),
      {
        name: "bundle-registered-content-scripts",
        async closeBundle() {
          await build({
            entryPoints: {
              bridge: "src/content/bridge.ts",
              observer: "src/content/observer.ts",
            },
            outdir: `${outDir}/assets`,
            bundle: true,
            format: "iife",
            target: "chrome139",
            minify: true,
          });
        },
      },
    ],
    build: { outDir, sourcemap: false },
  };
});
