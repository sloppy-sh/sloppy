// Run an app's dev command, and start it over once a rebuilt @sloppy/* package
// it depends on has landed in packages/ts/*/dist.
//
// The API needs this and the web shell does not: `nest start --watch` restarts
// on its own TypeScript program, which reaches a package only through
// dist/index.d.ts, so it restarts for a changed type and sits still for a
// changed function body. dist/*.js is what the API loads, so that is what this
// watches — and it waits for the writes to stop, because one edit rebuilds the
// package and then everything downstream of it.
//
// Usage, from the repo root:
//   node scripts/restart-on-package-build.mjs <app-dir> <command> [args...]

import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, watch } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SETTLE_MS = 2_000;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [appDir, command, ...args] = process.argv.slice(2);

if (!appDir || !command) {
  console.error(
    "[restart-on-package-build] usage: <app-dir> <command> [args...]",
  );
  process.exit(1);
}

function manifest(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

const workspace = new Map();
for (const entry of readdirSync(join(root, "packages", "ts"), {
  withFileTypes: true,
})) {
  if (!entry.isDirectory()) continue;
  const dir = join(root, "packages", "ts", entry.name);
  const name = manifest(dir)?.name;
  if (name) workspace.set(name, dir);
}

// Transitively, because a package the app names may pull in one it does not,
// and a rebuild of that one is just as much a change to what the app loads.
const depended = new Set();
const queue = [resolve(root, appDir)];
while (queue.length > 0) {
  for (const name of Object.keys(manifest(queue.shift())?.dependencies ?? {})) {
    if (!workspace.has(name) || depended.has(name)) continue;
    depended.add(name);
    queue.push(workspace.get(name));
  }
}

let current = null;
let settle = null;

function run() {
  // Its own process group, so a restart can signal the command AND whatever it
  // spawned: pnpm and nest are both middlemen, and the server is a grandchild.
  const proc = spawn(command, args, { stdio: "inherit", detached: true });
  current = proc;
  proc.on("exit", (code, signal) => {
    if (current !== proc) return;
    current = null;
    process.exit(signal ? 1 : (code ?? 0));
  });
}

function restart() {
  const proc = current;
  if (!proc) {
    run();
    return;
  }
  current = null;
  proc.once("exit", run);
  console.log("[restart-on-package-build] a package build landed — restarting");
  try {
    process.kill(-proc.pid, "SIGTERM");
  } catch {
    proc.kill("SIGTERM");
  }
}

for (const name of depended) {
  const dist = join(workspace.get(name), "dist");
  if (!existsSync(dist)) continue;
  watch(dist, { recursive: true }, () => {
    clearTimeout(settle);
    settle = setTimeout(restart, SETTLE_MS);
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (current) {
      try {
        process.kill(-current.pid, signal);
      } catch {}
    }
    process.exit(0);
  });
}

run();
