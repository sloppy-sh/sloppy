// Sizes and logos from the map: layers and sections drawn large, a component's logo on its mark.
// usage: node dress.mjs <project dir> <map.json>
import { spawn, execSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";
const CLI = process.argv.includes("--cli")
  ? process.argv[process.argv.indexOf("--cli") + 1]
  : path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      "../../packages/ts/cli/dist/sloppy.mjs",
    );
const P = path.resolve(process.argv[2]);
const MAP = JSON.parse(readFileSync(path.resolve(process.argv[3]), "utf8"));
const titled = new Map([
  ...MAP.graph.sections.map((s) => [s.id, s.title]),
  ...MAP.components.map((c) => [c.path, c.title]),
]);
const notes = new Map();
const byTitle = new Map();
for (const f of readdirSync(path.join(P, ".sloppy/notes"))) {
  const t = readFileSync(path.join(P, ".sloppy/notes", f), "utf8");
  const ref = t.match(/^ref: (.+)$/m)?.[1];
  const title = t.match(/^title: (.+)$/m)?.[1]?.replace(/^"|"$/g, "");
  const body = t.split(/^---$/m).slice(2).join("---");
  const about = [
    ...body.matchAll(/\(code:([^)#]+)\)|"href":"code:([^"#]+)"/g),
  ].map((m) => m[1] ?? m[2])[0];
  if (ref && about && !notes.has(about)) notes.set(about, ref);
  if (ref && title && !byTitle.has(title)) byTitle.set(title, ref);
}
const refOf = (k) =>
  notes.get(k) ?? byTitle.get(titled.get(k) ?? "") ?? byTitle.get(k);
const SCRATCH = path.join(P, ".sloppy-logos");
mkdirSync(SCRATCH, { recursive: true });
const raster = (file) => {
  // the store takes PNG, JPEG, GIF and WebP; an SVG or ICO is rasterised first
  const abs = path.join(P, file);
  if (!existsSync(abs)) return undefined;
  if (/\.(png|jpe?g|gif|webp)$/i.test(file)) return file;
  const out = path.join(
    SCRATCH,
    path.basename(file).replace(/\.[^.]+$/, "") + ".png",
  );
  try {
    if (/\.svg$/i.test(file)) {
      execSync(`qlmanage -t -s 512 -o "${SCRATCH}" "${abs}"`, {
        stdio: "ignore",
      });
      const made = path.join(SCRATCH, path.basename(file) + ".png");
      if (existsSync(made)) {
        copyFileSync(made, out);
        return path.relative(P, out);
      }
    } else {
      execSync(`sips -s format png "${abs}" --out "${out}"`, {
        stdio: "ignore",
      });
      if (existsSync(out)) return path.relative(P, out);
    }
  } catch {}
  return undefined;
};
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
  const a = await send("tools/call", { name, arguments: args });
  const r = a.result ?? a.error;
  const t = r?.content?.[0]?.text ?? JSON.stringify(r);
  if (r?.isError ?? a.error !== undefined) throw new Error(`${name}: ${t}`);
  return JSON.parse(t);
};
await send("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "dress", version: "1" },
});
s.stdin.write(
  JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
    "\n",
);
let sized = 0,
  pictured = 0;
const failed = [];
for (const sec of MAP.graph.sections) {
  const ref = refOf(sec.id);
  if (ref) {
    try {
      await call("style_note", { note: ref, mark_radius: "large" });
      sized++;
    } catch (e) {
      failed.push(`${sec.id}: ${e.message.slice(0, 80)}`);
    }
  }
}
for (const c of MAP.components) {
  const ref = refOf(c.path);
  if (!ref) continue;
  const logo = (c.logos ?? []).map(raster).find(Boolean);
  if (!logo) continue;
  try {
    await call("style_note", { note: ref, picture: logo });
    pictured++;
  } catch (e) {
    failed.push(`${c.path}: ${e.message.slice(0, 100)}`);
  }
}
s.stdin.end();
rmSync(SCRATCH, { recursive: true, force: true });
console.log(
  `sized large ${sized}, logos on marks ${pictured}, failed ${failed.length}`,
);
for (const f of failed) console.log("  ", f);
