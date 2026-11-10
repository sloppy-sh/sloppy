// A page onto the one note whose only code link is the place, written into the vault file itself:
// for the places several notes reach, which write_note refuses. usage: node write-direct.mjs <project dir> <substance dir> <about>...
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const [P, SUB, ...ABOUTS] = process.argv
  .slice(2)
  .map((x, i) => (i < 2 ? path.resolve(x) : x));
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ulid = () => {
  let t = Date.now(),
    s = "";
  for (let i = 0; i < 10; i++) {
    s = B32[t % 32] + s;
    t = Math.floor(t / 32);
  }
  const r = randomBytes(16);
  for (let i = 0; i < 16; i++) s += B32[r[i] % 32];
  return s;
};
const encoded = (x) =>
  x.replace(
    /\]\(code:([^)\n]*?(?:\([^)]*\))?[^)\n]*)\)/g,
    (m, t) =>
      `](code:${t.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29")})`,
  );
const pages = new Map();
for (const f of readdirSync(SUB).filter((f) => f.endsWith(".json"))) {
  const got = JSON.parse(readFileSync(path.join(SUB, f), "utf8"));
  for (const p of Array.isArray(got) ? got : (got.entries ?? []))
    if (ABOUTS.includes(p.about)) pages.set(p.about, p);
}
const N = path.join(P, ".sloppy/notes");
for (const about of ABOUTS) {
  const p = pages.get(about);
  if (!p) {
    console.log(`no page for ${about}`);
    continue;
  }
  const hits = [];
  for (const f of readdirSync(N)) {
    const t = readFileSync(path.join(N, f), "utf8");
    const body = t.split(/^---$/m).slice(2).join("---");
    const links = [
      ...new Set(
        [...body.matchAll(/\(code:([^)#]+)\)|"href":"code:([^"#]+)"/g)].map(
          (m) => m[1] ?? m[2],
        ),
      ),
    ];
    const title = t.match(/^title: (.+)$/m)?.[1]?.replace(/^"|"$/g, "");
    if (
      links.length === 1 &&
      links[0] === about &&
      !/^## What it is/m.test(body)
    )
      hits.push({ f, t, title });
  }
  if (hits.length !== 1) {
    console.log(
      `${about}: ${hits.length} candidate notes (${hits.map((h) => h.title).join(", ")})`,
    );
    continue;
  }
  const { f, t } = hits[0];
  const sections = (p.sections ?? [])
    .filter((x) => typeof x === "string" && x.trim().startsWith("## "))
    .map(encoded);
  let out = t.replace(/\s*$/, "\n");
  for (const s of sections)
    out += `\n<!-- block ${ulid()} -->\n\n${s.trim()}\n`;
  const had = [...t.matchAll(/^  - (.+)$/gm)].map((m) => m[1]);
  const tagsBlock = t.match(/^tags:\n((?:  - .+\n)*)/m);
  if (tagsBlock && p.tags?.length) {
    const have = tagsBlock[1]
      .split("\n")
      .filter(Boolean)
      .map((l) => l.slice(4));
    const all = [...new Set([...have, ...p.tags])].slice(0, 12);
    out = out.replace(
      tagsBlock[0],
      `tags:\n${all.map((x) => `  - ${x}`).join("\n")}\n`,
    );
  }
  out = out.replace(/^updated: .+$/m, `updated: ${new Date().toISOString()}`);
  writeFileSync(path.join(N, f), out);
  console.log(
    `${about}: ${sections.length} sections onto ${f} (${hits[0].title})`,
  );
}
