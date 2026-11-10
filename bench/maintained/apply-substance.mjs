// Put the workers' pages into the component notes: sections written onto each note, tags added, and
// init's empty sub-folder notes binned. usage: node apply-substance.mjs <project dir> [--dry-run]
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
const CLI = process.argv.includes("--cli")
  ? process.argv[process.argv.indexOf("--cli") + 1]
  : path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      "../../packages/ts/cli/dist/sloppy.mjs",
    );
const P = path.resolve(process.argv[2]);
const DRY = process.argv.includes("--dry-run");
const MAP = JSON.parse(readFileSync(path.resolve(process.argv[3]), "utf8"));
const SUB = path.resolve(process.argv[4]);
const titled = new Map([
  ...MAP.graph.sections.map((s) => [s.id, s.title]),
  ...MAP.components.map((c) => [c.path, c.title]),
]);
const named = new Set(MAP.graph.notes.map((n) => n.about));

// the workers' pages
const pages = [];
const fixes = [];
for (const f of readdirSync(SUB).filter((f) => f.endsWith(".json"))) {
  const got = JSON.parse(readFileSync(path.join(SUB, f), "utf8"));
  for (const p of Array.isArray(got) ? got : (got.entries ?? [])) {
    if (p.about) pages.push({ ...p, from: f });
    for (const x of p.line_fixes ?? []) fixes.push(x);
  }
  for (const x of Array.isArray(got) ? [] : (got.line_fixes ?? []))
    fixes.push(x);
}

// the notes there: by the place a note is about (its first code link), by title, and whether it is init's bare scaffold
const notes = new Map();
const byTitle = new Map();
let ROOT;
for (const f of readdirSync(path.join(P, ".sloppy/notes"))) {
  const t = readFileSync(path.join(P, ".sloppy/notes", f), "utf8");
  const ref = t.match(/^ref: (.+)$/m)?.[1];
  const title = t.match(/^title: (.+)$/m)?.[1]?.replace(/^"|"$/g, "");
  if (!ref) continue;
  if (!/^parent: /m.test(t)) ROOT = ref;
  const body = t.split(/^---$/m).slice(2).join("---");
  const links = [
    ...body.matchAll(/\(code:([^)#]+)\)|"href":"code:([^"#]+)"/g),
  ].map((m) => m[1] ?? m[2]);
  const about = links[0];
  const headings = [...body.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
  const scaffold =
    headings.length > 0 &&
    headings.every((h) =>
      ["The folder", "Start here", "What this gathers", "What it is"].includes(
        h,
      ),
    ) &&
    body
      .replace(/<!--[^>]*-->/g, "")
      .split("\n")
      .filter(
        (l) =>
          l.trim() &&
          !l.startsWith("#") &&
          !/^\s*-\s*\[/.test(l) &&
          !l.startsWith("north:") &&
          !/^\[[^\]]*\]\(code:/.test(l.trim()),
      ).length === 0;
  const entry = { ref, title, about, scaffold, headings, links };
  if (about && !notes.has(about)) notes.set(about, entry);
  if (title && !byTitle.has(title)) byTitle.set(title, entry);
}
// write_note finds a note by a place only one note links, so each note is written to by such a place
const linkers = new Map();
for (const n of byTitle.values())
  for (const l of new Set(n.links)) linkers.set(l, (linkers.get(l) ?? 0) + 1);
const placeFor = (n) => n.links.find((l) => linkers.get(l) === 1);
const folderOf = (key) =>
  key.match(
    /^((?:infrastructure|platforms|services|packages)\/[^/]+)\/.*README\.md$/,
  )?.[1];
const noteFor = (key) =>
  notes.get(key) ??
  byTitle.get(titled.get(key) ?? "") ??
  byTitle.get(key) ??
  (folderOf(key) ? notes.get(folderOf(key)) : undefined);

const s = spawn("node", [CLI, "mcp", "--profile", "full"], {
  cwd: P,
  stdio: ["pipe", "pipe", "inherit"],
});
let buf = "",
  pend = new Map(),
  id = 1;
s.stdout.on("data", (c) => {
  buf += c;
  let at;
  while ((at = buf.indexOf("\n")) !== -1) {
    const l = buf.slice(0, at).trim();
    buf = buf.slice(at + 1);
    if (!l) continue;
    const m = JSON.parse(l);
    const w = pend.get(m.id);
    if (w) {
      pend.delete(m.id);
      w(m);
    }
  }
});
const send = (method, params) =>
  new Promise((r) => {
    const i = id++;
    pend.set(i, r);
    s.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n",
    );
  });
const call = async (name, args) => {
  if (DRY) return { dry: true };
  const a = await send("tools/call", { name, arguments: args });
  const r = a.result ?? a.error;
  const t = r?.content?.[0]?.text ?? JSON.stringify(r);
  if (r?.isError ?? a.error !== undefined) throw new Error(`${name}: ${t}`);
  return JSON.parse(t);
};
await send("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "substance", version: "0" },
});
s.stdin.write(
  JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
    "\n",
);

let written = 0,
  tagged = 0,
  binned = 0;
const unmatched = [],
  offered = [];
for (const p of pages) {
  const n = noteFor(p.about);
  if (!n) {
    unmatched.push(`${p.about} (${p.from})`);
    continue;
  }
  // a link target with a space or a parenthesis is spelled the way the carry spells it
  const encoded = (x) =>
    x.replace(
      /\]\(code:([^)\n]*?(?:\([^)]*\))?[^)\n]*)\)/g,
      (m, t) =>
        `](code:${t.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29")})`,
    );
  const sections = (p.sections ?? [])
    .filter((x) => typeof x === "string" && x.trim().startsWith("## "))
    .map(encoded);
  if (sections.length) {
    // a place only its note links, else the place the note was started about
    const place = placeFor(n) ?? n.about;
    try {
      const r = await call("write_note", {
        about: place,
        sections,
        ...(p.tags?.length ? { tags: p.tags.slice(0, 12) } : {}),
      });
      if (r.done === "offered") offered.push(p.about);
      written++;
    } catch (e) {
      unmatched.push(
        `${p.about} via ${place}: ${String(e.message).slice(0, 160)}`,
      );
      continue;
    }
  }
  if (p.tags?.length) {
    await call("tag_note", { note: n.ref, tags: p.tags.slice(0, 12) });
    tagged++;
  }
}
// init's sub-folder notes the map does not name and nobody wrote into carry nothing a person would keep
const kept = new Set([
  ...pages.map((p) => noteFor(p.about)?.ref).filter(Boolean),
]);
for (const n of notes.values()) {
  if (
    !n.about ||
    n.ref === ROOT ||
    named.has(n.about) ||
    kept.has(n.ref) ||
    !n.scaffold
  )
    continue;
  if (/^docs\/docs\/|^skills\//.test(n.about)) continue;
  await call("delete_note", { note: n.ref });
  binned++;
}
// the lines the writers corrected while reading the code
let fixed = 0;
for (const f of fixes) {
  const [a, b] = f.off ?? f.on ?? [];
  const na = noteFor(a),
    nb = noteFor(b);
  if (!na || !nb) {
    unmatched.push(`line fix ${a} ↔ ${b}`);
    continue;
  }
  try {
    if (f.off) {
      await call("link_notes", { note: na.ref, off: [nb.ref] });
      await call("link_notes", { note: nb.ref, off: [na.ref] });
    } else {
      await call("link_notes", { note: na.ref, to: [nb.ref] });
      if (f.label)
        await call("style_edge", {
          note: na.ref,
          to: nb.ref,
          label: String(f.label).slice(0, 80),
          ...(f.direction && f.direction !== "none"
            ? { direction: f.direction }
            : {}),
        });
    }
    fixed++;
  } catch (e) {
    unmatched.push(`line fix ${a} ↔ ${b}: ${String(e.message).slice(0, 120)}`);
  }
}
s.stdin.end();
console.log(`line fixes ${fixed} of ${fixes.length}`);
console.log(
  `${DRY ? "DRY RUN " : ""}pages ${pages.length}: written ${written}, tagged ${tagged}, binned ${binned}, offered ${offered.length}, unmatched ${unmatched.length}`,
);
for (const u of unmatched) console.log("  unmatched", u);
