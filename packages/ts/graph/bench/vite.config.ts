import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  server: { port: 5183, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true },
});
