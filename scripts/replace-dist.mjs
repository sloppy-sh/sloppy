// Swap a freshly built staging directory into dist/ with no missing-file
// window. The shells' dev servers serve these files live, and a "delete dist,
// then copy" replace leaves a gap where imports 404 and vite's module graph
// wedges until the server is restarted. Copy over, then prune what src no
// longer has, so every file stays resolvable throughout and dev cannot keep
// resolving a module a production build would drop.
//
// Usage, from a package directory:
//   node ../../../scripts/replace-dist.mjs [staging] [dist]

import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const staging = process.argv[2] ?? ".dist-staging";
const dist = process.argv[3] ?? "dist";

if (!existsSync(staging)) {
  console.error(`[replace-dist] staging dir "${staging}" not found`);
  process.exit(1);
}

cpSync(staging, dist, { recursive: true });

function prune(rel) {
  for (const entry of readdirSync(join(dist, rel), { withFileTypes: true })) {
    const path = join(rel, entry.name);
    if (!existsSync(join(staging, path))) {
      rmSync(join(dist, path), { recursive: true, force: true });
    } else if (entry.isDirectory()) {
      prune(path);
    }
  }
}
prune("");

rmSync(staging, { recursive: true, force: true });
