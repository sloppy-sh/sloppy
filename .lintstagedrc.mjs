// Pre-commit routing. The pure TS/JS packages are formatted + linted by Biome;
// everything else (the Svelte apps/packages and their .ts files, plus root
// config, docs, styles) stays on Prettier. The two sets are mutually exclusive
// so a file is never processed by both, which would fight over style.
//
// The dirs Biome owns are READ FROM biome.json rather than repeated here. A
// hand-kept second copy drifts, and the failure is quiet and expensive: a file
// in a package biome.json has gained gets formatted by Prettier at commit and
// then rejected by that package's own `format:check` (`biome ci`), which
// disagrees with Prettier about — among other things — how `await import(...)`
// wraps. Deriving the list makes the drift unrepresentable rather than merely
// discouraged.
import fs from "node:fs";
import path from "node:path";

const ROOT = import.meta.dirname;

/**
 * Files that are generated, so no formatter owns them.
 *
 * `pnpm-lock.yaml` matches the Prettier extension list below and is in no Biome
 * dir. Left owned, it is rewritten on every commit that touches it: pnpm writes
 * YAML single-quoted, Prettier rewrites it double-quoted, and the next install
 * rewrites it back — so adding one dependency lands as a whole-file diff.
 */
const GENERATED = new Set(["pnpm-lock.yaml"]);

/**
 * A notes container, which the store writes and rewrites.
 *
 * Owned by a formatter it fights the store: Prettier rewrites a note at commit,
 * the app writes it back in the shape it reads, and the next commit is a
 * whole-file diff again. A container can sit anywhere in a repository, so this
 * matches the directory rather than one path.
 */
const CONTAINER_DIR = ".sloppy";

/** Nearest ancestor of `dir` (inclusive) containing a package.json, or null. */
function nearestPackage(dir) {
  const { root } = path.parse(dir);
  for (;;) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    if (dir === root) return null;
    dir = path.dirname(dir);
  }
}

/**
 * The packages biome.json covers, as `/dir/` fragments to match paths against.
 *
 * Each include is reduced to the package that owns it, so `apps/sloppy/api/src/**`
 * and `apps/sloppy/api/test/**` both route the whole of `apps/sloppy/api`. That
 * is deliberately WIDER than biome.json's own globs: a file Biome is handed but
 * does not match is skipped (`--no-errors-on-unmatched`), whereas one handed to
 * Prettier instead is rewritten in the style Biome will reject.
 */
function biomeDirs() {
  const cfg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "biome.json"), "utf8"),
  );
  const dirs = new Set();
  for (const glob of cfg.files?.includes ?? []) {
    // Exclusions (`!**/dist`) narrow what Biome formats, not which packages it
    // owns; Biome applies them itself to whatever this hands it.
    if (glob.startsWith("!")) continue;
    const star = glob.indexOf("*");
    const literal = star === -1 ? glob : glob.slice(0, star);
    const target = path.resolve(ROOT, literal);
    // biome.json declares the split for every package that will exist, so the
    // later milestones that create them do not each have to edit this shared
    // line. A path with nothing on disk yet routes nothing, because no staged
    // file can be inside it.
    if (!fs.existsSync(target)) continue;
    const owner = nearestPackage(target);
    // A glob owned by no package, or by the repo itself, would route far more
    // than it names — loudly wrong beats silently wrong at pre-commit.
    if (!owner || owner === ROOT) {
      throw new Error(
        `biome.json include "${glob}" does not resolve to a package under the repo root`,
      );
    }
    dirs.add(`${path.sep}${path.relative(ROOT, owner)}${path.sep}`);
  }
  return [...dirs];
}

const BIOME_DIRS = biomeDirs();

const inBiome = (f) => BIOME_DIRS.some((d) => f.includes(d));
const isGenerated = (f) => GENERATED.has(path.relative(ROOT, f));
const inContainer = (f) =>
  path.relative(ROOT, f).split(path.sep).includes(CONTAINER_DIR);

/**
 * A symlink is an alias for a file a formatter is already handed under its real
 * name. `CLAUDE.md` and its siblings all point at `AI.md`, so routing them would
 * write one file ten times — and a formatter that writes by replace rather than
 * in place turns the alias into a copy, which is the one thing the fan-out
 * exists to prevent.
 */
const isSymlink = (f) =>
  fs.lstatSync(f, { throwIfNoEntry: false })?.isSymbolicLink() === true;

const dquote = (files) => files.map((f) => `"${f}"`).join(" ");

// Prettier must run *inside* the owning package: from the repo root it loads
// root-level plugin versions that are incompatible with the Svelte files
// (`getVisitorKeys` errors) and can't resolve package-relative config like
// `tailwindStylesheet`. The filesystem root is a fallback for a file with no
// package.json above it, which cannot happen inside this repo.
function pkgRoot(file) {
  const dir = path.dirname(file);
  return nearestPackage(dir) ?? path.parse(dir).root;
}

export default (allFiles) => {
  const owned = allFiles.filter(
    (f) => !isGenerated(f) && !inContainer(f) && !isSymlink(f),
  );
  const biome = owned.filter(
    (f) => inBiome(f) && /\.(ts|js|mjs|cjs|json)$/.test(f),
  );
  const prettier = owned.filter(
    (f) =>
      !inBiome(f) &&
      /\.(js|mjs|cjs|ts|jsx|tsx|svelte|json|css|scss|md|html|yml|yaml)$/.test(
        f,
      ),
  );

  const cmds = [];
  // Biome uses one root config + one binary, so it's safe to run from the repo
  // root; it skips paths outside its scope (`--no-errors-on-unmatched`).
  if (biome.length)
    cmds.push(`biome check --write --no-errors-on-unmatched ${dquote(biome)}`);

  // Prettier: group by owning package and run from inside it.
  const byPkg = new Map();
  for (const f of prettier) {
    const root = pkgRoot(f);
    if (!byPkg.has(root)) byPkg.set(root, []);
    byPkg.get(root).push(path.relative(root, f));
  }
  for (const [root, files] of byPkg) {
    const rel = files.map((f) => `'${f}'`).join(" ");
    cmds.push(`sh -c "cd '${root}' && prettier --write ${rel}"`);
  }
  return cmds;
};
