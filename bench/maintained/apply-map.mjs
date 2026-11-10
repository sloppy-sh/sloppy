// Rebuild a project graph from its ownership map: a note per layer, section and component, every
// note under what it springs from, tagged, and the relations drawn as labelled lines.
// usage: node apply-map.mjs <project dir> <map.json> [--dry-run]
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

// where a note that is not about one folder is started: the free place the map names for it, as a
// list of candidates or one path; a write onto a place with a started note would land on that note
const PLACE = {};
for (const sec of MAP.graph.sections)
  if (sec.place) PLACE[sec.id] = [].concat(sec.place);
for (const c of MAP.components) if (c.place) PLACE[c.path] = [].concat(c.place);
const placeOf = (key) => {
  for (const c of PLACE[key] ?? []) if (existsSync(path.join(P, c))) return c;
  return undefined;
};
const titled = new Map([
  ...MAP.graph.sections.map((s) => [s.id, s.title]),
  ...MAP.components.map((c) => [c.path, c.title]),
]);
const oneLine = new Map(MAP.components.map((c) => [c.path, c]));

// the notes already there, by what they are about: the first code link of a note's first block, else its title
let ROOT;
function held() {
  const by = new Map();
  for (const f of readdirSync(path.join(P, ".sloppy/notes"))) {
    const t = readFileSync(path.join(P, ".sloppy/notes", f), "utf8");
    const ref = t.match(/^ref: (.+)$/m)?.[1];
    const title = t.match(/^title: (.+)$/m)?.[1]?.replace(/^"|"$/g, "");
    if (!ref) continue;
    if (!/^parent: /m.test(t)) {
      ROOT = ref;
      continue;
    }
    const body = t.split(/^---$/m).slice(2).join("---");
    // a note's first code link is the place it is about: a folder note's folder, a carried document's own path
    // a path with spaces is kept as a span's href rather than a markdown link
    const first = [
      ...body.matchAll(/\(code:([^)#]+)\)|"href":"code:([^"#]+)"/g),
    ].map((m) => m[1] ?? m[2])[0];
    if (first && !by.has(first)) by.set(first, ref);
    if (title && !by.has(title)) by.set(title, ref);
  }
  return by;
}

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
  clientInfo: { name: "apply-map", version: "1" },
});
s.stdin.write(
  JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
    "\n",
);

const named = new Set(MAP.graph.notes.map((n) => n.about));
const refs = held();
const byTitle = new Map();
for (const f of readdirSync(path.join(P, ".sloppy/notes"))) {
  const t = readFileSync(path.join(P, ".sloppy/notes", f), "utf8");
  const ref = t.match(/^ref: (.+)$/m)?.[1];
  const title = t.match(/^title: (.+)$/m)?.[1]?.replace(/^"|"$/g, "");
  if (ref && title)
    byTitle.set(title, [
      ...(byTitle.get(title) ?? []),
      { ref, created: t.match(/^created: (.+)$/m)?.[1] ?? "" },
    ]);
}
for (const [key, title] of titled) {
  if (refs.has(key) && !key.includes(":")) continue;
  const same = (byTitle.get(title) ?? []).sort((a, b) =>
    a.created.localeCompare(b.created),
  );
  if (!same.length) continue;
  refs.set(key, same[0].ref);
  for (const extra of same.slice(1)) {
    await call("delete_note", { note: extra.ref });
    console.log("binned a duplicate of", title.slice(0, 50));
  }
}
const toStart = [];
const counts = {
  started: 0,
  moved: 0,
  tagged: 0,
  linked: 0,
  styled: 0,
  missing: [],
};
// a README under a system folder was carried onto that folder's own note
const folderOf = (key) =>
  key.match(
    /^((?:infrastructure|platforms|services|packages)\/[^/]+)\/.*README\.md$/,
  )?.[1];
const refOf = async (key) => {
  if (refs.has(key)) return refs.get(key);
  const folder = folderOf(key);
  if (folder && refs.has(folder)) {
    refs.set(key, refs.get(folder));
    return refs.get(folder);
  }
  if (DRY) toStart.push(key);
  const place = PLACE[key] ? placeOf(key) : key;
  if (!place) throw new Error(`no free place in the project to start ${key}`);
  const c = oneLine.get(key);
  const title = titled.get(key) ?? key;
  const section = c
    ? `## What it is\n\n${c.one_line}${c.owner ? `\n\nOwner: ${c.owner}.` : ""}${(c.evidence ?? []).length ? `\n\nEvidence: ${c.evidence.slice(0, 4).join("; ")}` : ""}`
    : `## What this gathers\n\n${MAP.graph.sections.find((x) => x.id === key)?.title ?? title}`;
  const r = await call("write_note", {
    about: place,
    title,
    sections: [section],
    tags: ["w3ds"],
    start: true,
  });
  counts.started++;
  const ref = DRY
    ? `dry:${key}`
    : typeof r.note === "string"
      ? r.note
      : (r.note?.ref ?? r.ref);
  if (!ref && !DRY)
    throw new Error(
      `no ref back for ${key}: ${JSON.stringify(r).slice(0, 200)}`,
    );
  refs.set(key, ref);
  return ref;
};

// 1. layers and sections exist, each under its parent (layers under the project's root note)
const root = ROOT;
if (!root) throw new Error("no root note");
for (const sec of MAP.graph.sections) {
  const ref = await refOf(sec.id);
  const parent = sec.parent ? await refOf(sec.parent) : root;
  if (parent && parent !== ref) {
    await call("move_note", { note: ref, to: parent, relation: "under" });
    counts.moved++;
  }
}
// 2. every component and document note exists and springs from what the map says
for (const n of MAP.graph.notes) {
  const ref = await refOf(n.about);
  const parent = await refOf(n.parent_about);
  if (parent !== ref) {
    await call("move_note", { note: ref, to: parent, relation: "under" });
    counts.moved++;
  }
  if (n.tags?.length) {
    await call("tag_note", { note: ref, tags: n.tags.slice(0, 12) });
    counts.tagged++;
  }
}
// 3. the relations, as labelled lines
for (const n of MAP.graph.notes) {
  const from = refs.get(n.about);
  const links = (n.links ?? []).filter(
    (l) => refs.has(l.to_about) || PLACE[l.to_about] || named.has(l.to_about),
  );
  if (!links.length) continue;
  // a document carried onto its folder's note shares that note, so a link between the two is a line to itself
  const drawn = [];
  const seen = new Set([from]);
  for (const l of links) {
    const to = await refOf(l.to_about);
    if (seen.has(to)) continue;
    seen.add(to);
    drawn.push({ ...l, to });
  }
  const targets = drawn.map((l) => l.to);
  for (let i = 0; i < targets.length; i += 60) {
    await call("link_notes", { note: from, to: targets.slice(i, i + 60) });
    counts.linked += Math.min(60, targets.length - i);
  }
  for (const l of drawn) {
    const direction = l.direction === "none" ? undefined : l.direction;
    await call("style_edge", {
      note: from,
      to: l.to,
      label: l.label.slice(0, 80),
      ...(direction ? { direction } : {}),
    });
    counts.styled++;
  }
  for (const l of (n.links ?? []).filter(
    (l) =>
      !refs.has(l.to_about) && !PLACE[l.to_about] && !named.has(l.to_about),
  ))
    counts.missing.push(`${n.about} → ${l.to_about}`);
}
// 4. the folder notes init started that the map does not name hang under the nearest named place
const HOME = {};
{
  const under = {};
  for (const n of MAP.graph.notes) {
    const parts = n.about.split("/");
    for (let i = 1; i < parts.length; i++) {
      const f = parts.slice(0, i).join("/");
      (under[f] = under[f] || {})[n.parent_about] =
        (under[f][n.parent_about] || 0) + 1;
    }
  }
  for (const [f, by] of Object.entries(under))
    HOME[f] = Object.entries(by).sort((x, y) => y[1] - x[1])[0][0];
}
const placed = new Set([
  ...MAP.graph.sections.map((x) => refs.get(x.id)),
  ...MAP.graph.notes.map((n) => refs.get(n.about)),
]);
let swept = 0;
for (const f of readdirSync(path.join(P, ".sloppy/notes"))) {
  const t = readFileSync(path.join(P, ".sloppy/notes", f), "utf8");
  const ref = t.match(/^ref: (.+)$/m)?.[1];
  if (!ref || ref === ROOT || placed.has(ref)) continue;
  const body = t.split(/^---$/m).slice(2).join("---");
  const about = [
    ...body.matchAll(/\(code:([^)#]+)\)|"href":"code:([^"#]+)"/g),
  ].map((m) => m[1] ?? m[2])[0];
  if (!about) continue;
  let home = HOME[about];
  if (!home) {
    const parts = about.split("/");
    for (let i = parts.length - 1; i > 0 && !home; i--) {
      const up = parts.slice(0, i).join("/");
      if (named.has(up)) home = up;
      else if (HOME[up]) home = HOME[up];
    }
  }
  if (!home) home = MAP.graph.sections.find((x) => !x.parent)?.id;
  const parent = await refOf(home);
  if (parent && parent !== ref) {
    await call("move_note", { note: ref, to: parent, relation: "under" });
    swept++;
  }
}
s.stdin.end();
console.log(`swept ${swept} folder notes under their nearest named place`);
console.log(
  `${DRY ? "DRY RUN " : ""}notes held ${refs.size}: started ${counts.started}, moved ${counts.moved}, tagged ${counts.tagged}, lines ${counts.linked}, labelled ${counts.styled}, targets missing ${counts.missing.length}`,
);
for (const m of counts.missing.slice(0, 12)) console.log("  missing", m);
if (DRY) console.log("would start:", toStart.join(" | "));
