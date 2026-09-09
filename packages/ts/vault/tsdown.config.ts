import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  // Never delete dist under a running dev server: vite serves these files live
  // and wedges on the missing-file window. Each build overwrites in place.
  clean: false,
  sourcemap: true,
  outExtensions: ({ format }) => ({
    js: format === "cjs" ? ".js" : ".mjs",
    dts: format === "cjs" ? ".d.ts" : ".d.mts",
  }),
});
