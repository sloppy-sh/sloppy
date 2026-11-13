/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";

/** Everything the page needs, inside its one file: no request leaves it. */
const POLICY =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:";

/** The built page as one `index.html`, its script, styles and faces inlined,
 *  so the headset can hand it to a view from any base. */
function onePage(): Plugin {
  return {
    name: "sloppy-one-page",
    apply: "build",
    enforce: "post",
    generateBundle(_, bundle) {
      const page = bundle["index.html"];
      if (page?.type !== "asset") return;
      let html = String(page.source);
      for (const [name, file] of Object.entries(bundle)) {
        if (file.type === "chunk") {
          // With nothing split off there is nothing to preload, and Vite
          // leaves its placeholder for the list unfilled.
          const code = file.code
            .replaceAll("__VITE_PRELOAD__", "void 0")
            .replaceAll("</script", "<\\/script");
          html = html.replace(
            new RegExp(
              `<script type="module" crossorigin src="[^"]*${escaped(name)}"></script>`,
            ),
            () => `<script type="module">${code}</script>`,
          );
          delete bundle[name];
        } else if (name.endsWith(".css")) {
          const css = String(file.source).replaceAll("</style", "<\\/style");
          html = html.replace(
            new RegExp(
              `<link rel="stylesheet" crossorigin href="[^"]*${escaped(name)}">`,
            ),
            () => `<style>${css}</style>`,
          );
          delete bundle[name];
        }
      }
      html = html.replace(
        "<head>",
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${POLICY}" />`,
      );
      page.source = html;
    },
  };
}

function escaped(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** KaTeX names three files for each of its faces; the page reads woff2. */
function katexWoff2Only(): Plugin {
  return {
    name: "sloppy-katex-woff2",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("katex") || !id.split("?")[0].endsWith(".css")) return;
      return code.replace(
        /,\s*url\([^)]*\.woff\)\s*format\("woff"\)\s*,\s*url\([^)]*\.ttf\)\s*format\("truetype"\)/g,
        "",
      );
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [katexWoff2Only(), onePage()],
  build: {
    outDir: "dist",
    assetsInlineLimit: () => true,
    cssCodeSplit: false,
    modulePreload: false,
    chunkSizeWarningLimit: 20_000,
    rolldownOptions: { output: { codeSplitting: false } },
  },
  server: { fs: { allow: [".."] } },
  test: {
    environment: "jsdom",
  },
});
