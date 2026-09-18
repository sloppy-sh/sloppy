import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/sloppy.ts"],
  format: ["esm"],
  dts: true,
  // Never delete dist under a running dev server: vite serves these files live
  // and wedges on the missing-file window. Each build overwrites in place.
  clean: false,
  sourcemap: true,
  outExtensions: () => ({ js: ".mjs", dts: ".d.mts" }),
});
