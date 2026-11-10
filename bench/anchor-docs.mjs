#!/usr/bin/env node
// Points each of a project's documents at the code it governs with one `Covers:` line, from a
// per-project rules file — README.md § "Anchoring a project's documents" is the manual.
//
// usage: node bench/anchor-docs.mjs <project dir> --rules <rules.json> [--dry-run]
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { documentsIn, foldersOf, noteOf, repoFiles } from "./carry-docs.mjs";

export const COVERS = "Covers: ";
const DEFAULT_MIN_HITS = 3;
const DEFAULT_MAX_ANCHORS = 3;

function parseArguments(argv) {
  const rest = [];
  let rules;
  let dryRun = false;
  for (let at = 0; at < argv.length; at++) {
    if (argv[at] === "--rules") rules = path.resolve(argv[++at]);
    else if (argv[at] === "--dry-run") dryRun = true;
    else rest.push(argv[at]);
  }
  if (rest.length !== 1 || !rules) {
    console.error(
      "usage: node bench/anchor-docs.mjs <project dir> --rules <rules.json> [--dry-run]",
    );
    process.exit(2);
  }
  return { project: path.resolve(rest[0]), rules, dryRun };
}

/** The rules file, its regular expressions compiled and its defaults filled in. */
export function loadRules(file) {
  const raw = JSON.parse(readFileSync(file, "utf8"));
  return {
    docRoots: raw.doc_roots ?? [],
    codeRoots: (raw.code_roots ?? []).map(asFolder),
    minHits: raw.min_hits ?? DEFAULT_MIN_HITS,
    maxAnchors: raw.max_anchors ?? DEFAULT_MAX_ANCHORS,
    vocabulary: (raw.vocabulary ?? []).map((entry) => ({
      dir: asFolder(entry.dir),
      words: new RegExp(entry.words, "gi"),
    })),
    pathRules: (raw.path_rules ?? []).map((entry) => ({
      match: new RegExp(entry.match),
      dir: entry.dir,
    })),
    tagRules: (raw.tag_rules ?? []).map((entry) => ({
      match: new RegExp(entry.match),
      tags: entry.tags,
    })),
  };
}

export const asFolder = (dir) => dir.replace(/\/+$/, "");

/** `$1`… in `template` filled from a regular expression's match. */
export const filled = (template, match) =>
  template.replace(/\$(\d)/g, (_, n) => match[Number(n)] ?? "");

export const underRoots = (folder, roots) =>
  roots.some((root) => folder === root || folder.startsWith(`${root}/`));

const TOC_OPEN = /^\s*<!--\s*toc\s*-->/i;
const TOC_CLOSE = /<!--\s*tocstop\s*-->/i;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** The front matter's closing line, or -1 where the document has none. */
function frontMatterEnd(lines) {
  const fence = lines[0]?.trim();
  if (fence !== "---" && fence !== "+++") return -1;
  return lines.findIndex((line, at) => at > 0 && line.trim() === fence);
}

/** A document's words: no front matter, fenced code, HTML comments, generated table of
 *  contents or link targets. */
export function proseOf(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const kept = [];
  let fence = null;
  let comment = false;
  let toc = false;
  for (let at = frontMatterEnd(lines) + 1; at < lines.length; at++) {
    const line = lines[at];
    if (fence) {
      if (
        line.trim().startsWith(fence) &&
        line.trim().replace(/[`~]/g, "") === ""
      )
        fence = null;
      continue;
    }
    const opens = FENCE.exec(line);
    if (opens && !comment) {
      fence = opens[1];
      continue;
    }
    if (TOC_OPEN.test(line)) toc = true;
    if (toc) {
      if (TOC_CLOSE.test(line)) toc = false;
      continue;
    }
    let plain = line;
    if (comment) {
      const ends = plain.indexOf("-->");
      if (ends === -1) continue;
      plain = plain.slice(ends + 3);
      comment = false;
    }
    plain = plain.replace(/<!--.*?-->/g, " ");
    const opensComment = plain.indexOf("<!--");
    if (opensComment !== -1) {
      plain = plain.slice(0, opensComment);
      comment = true;
    }
    kept.push(plain.replace(/\]\([^)]*\)/g, "]"));
  }
  return kept.join("\n");
}

/** How often each vocabulary entry's words occur in `prose`, most first. */
export function hitsIn(prose, vocabulary) {
  return vocabulary
    .map(({ dir, words }) => ({ dir, hits: (prose.match(words) ?? []).length }))
    .sort((a, b) => b.hits - a.hits);
}

/**
 * The folders a document governs and does not already name: the folder its own path names,
 * then those whose words it uses at least `minHits` times, most-used first, at most
 * `maxAnchors` in all. `named` holds the repository paths it already names, `folders` the
 * repository's folders.
 */
export function anchorsOf(doc, text, rules, { named, folders }) {
  const chosen = [];
  const take = (dir) => {
    const folder = asFolder(dir);
    if (chosen.length >= rules.maxAnchors || chosen.includes(folder)) return;
    if (folders.has(folder) && !named.has(folder)) chosen.push(folder);
  };
  for (const rule of rules.pathRules) {
    const match = rule.match.exec(doc);
    if (match) take(filled(rule.dir, match));
  }
  for (const { dir, hits } of hitsIn(proseOf(text), rules.vocabulary))
    if (hits >= rules.minHits) take(dir);
  return chosen;
}

export const coversLine = (folders) =>
  `${COVERS}${folders.map((folder) => `${folder}/`).join(", ")}`;

const LINK_LINE = /^\s*\[[^\]]+\]\([^)]+\)\s*$/;
const H1 = /^ {0,3}#(?:[ \t]|$)/;
const SETEXT_ONE = /^ {0,3}=+\s*$/;

/** Where the first section's own words begin: past front matter, the title, leading HTML
 *  comments other than a table of contents, and a line that is only a link. */
function openingEnd(lines) {
  let at = frontMatterEnd(lines) + 1;
  let titled = false;
  for (;;) {
    while (at < lines.length && lines[at].trim() === "") at++;
    if (at >= lines.length) return at;
    const line = lines[at];
    if (!titled && H1.test(line)) {
      titled = true;
      at++;
    } else if (!titled && SETEXT_ONE.test(lines[at + 1] ?? "")) {
      titled = true;
      at += 2;
    } else if (/^\s*<!--/.test(line) && !TOC_OPEN.test(line)) {
      while (at < lines.length && !lines[at].includes("-->")) at++;
      at++;
    } else if (LINK_LINE.test(line)) at++;
    else return at;
  }
}

/**
 * The document with `line` placed as a paragraph of its own at the end of its opening block,
 * and the positions of every line added — the line itself and any blank that keeps it apart.
 */
export function withLine(text, line) {
  const eol = text.includes("\r\n") ? "\r" : "";
  const lines = text.split("\n");
  const last = lines.at(-1) === "" ? lines.length - 1 : lines.length;
  const at = Math.min(
    openingEnd(lines.map((one) => one.replace(/\r$/, ""))),
    last,
  );
  const inserted = [
    ...(at > 0 && lines[at - 1].trim() !== "" ? [eol] : []),
    `${line}${eol}`,
    ...(at < last ? [eol] : []),
  ];
  lines.splice(at, 0, ...inserted);
  return { text: lines.join("\n"), added: inserted.map((_, i) => at + i) };
}

/** Why an anchored document breaks the rules, or undefined where it keeps them: every original
 *  line kept in order and unchanged, one line of words added, and every anchor a folder. */
export function refusal(before, after, added, anchors, folders) {
  const lines = after.split("\n");
  const kept = lines.filter((_, at) => !added.includes(at));
  if (kept.join("\n") !== before) return "an original line changed";
  const said = added.filter((at) => lines[at].trim() !== "");
  if (said.length !== 1) return `${said.length} lines of words added`;
  const lost = anchors.find((folder) => !folders.has(folder));
  if (lost) return `${lost}/ is not a folder of the project`;
  return undefined;
}

export function anchorProject(project, rules) {
  const files = repoFiles(project);
  const folders = foldersOf(files);
  const { docs } = documentsIn(project, rules.docRoots);
  const results = [];
  for (const doc of docs) {
    const text = readFileSync(path.join(project, doc), "utf8");
    const named = new Set(noteOf(doc, text, files).links);
    const anchors = anchorsOf(doc, text, rules, { named, folders });
    if (anchors.length === 0) {
      results.push({ doc, anchors });
      continue;
    }
    const { text: after, added } = withLine(text, coversLine(anchors));
    const why = refusal(text, after, added, anchors, folders);
    if (why) throw new Error(`${doc}: ${why}`);
    results.push({ doc, anchors, before: text, after });
  }
  return results;
}

function report(results) {
  const byFolder = new Map();
  for (const { doc, anchors } of results) {
    if (anchors.length === 0) continue;
    console.log(`${doc} → ${anchors.map((folder) => `${folder}/`).join(", ")}`);
    for (const folder of anchors)
      byFolder.set(folder, (byFolder.get(folder) ?? 0) + 1);
  }
  const anchored = results.filter(({ anchors }) => anchors.length > 0).length;
  console.log(`documents: ${results.length}`);
  console.log(`documents anchored: ${anchored}`);
  console.log("anchors by folder:");
  for (const [folder, count] of [...byFolder].sort((a, b) => b[1] - a[1]))
    console.log(`  ${folder}/: ${count}`);
}

function main() {
  const { project, rules, dryRun } = parseArguments(process.argv.slice(2));
  const results = anchorProject(project, loadRules(rules));
  report(results);
  if (dryRun) return;
  for (const { doc, after } of results)
    if (after !== undefined) writeFileSync(path.join(project, doc), after);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
