// The workspace's one `.env`, loaded into `process.env` before anything reads
// it. `main.ts` imports this FIRST and the order is load-bearing: a module's
// decorator is evaluated when it is required, so `IdpModule.forRoot()` decides
// what to register before any Nest lifecycle has run.
//
// Real environment variables always win — dotenv does not overwrite them — so a
// container still configures the API the way it always did.

import { existsSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { config } from "dotenv";

/** The repo root, found by the file that marks it rather than by counting `..`
 *  segments, which differ between `src` and the compiled `dist`. */
function workspaceRoot(from: string): string | null {
  const { root } = parse(from);
  for (let dir = from; ; dir = dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    if (dir === root) return null;
  }
}

const root = workspaceRoot(__dirname) ?? workspaceRoot(process.cwd());
if (root) config({ path: join(root, ".env"), quiet: true });
