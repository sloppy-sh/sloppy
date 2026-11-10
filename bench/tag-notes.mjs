#!/usr/bin/env node
// Tags each carried document's note with the area its path places it in and the components its
// `Covers:` line names, through `sloppy mcp --profile full` — README.md § "Tagging carried
// notes" is the manual.
//
// usage: node bench/tag-notes.mjs <project dir> --rules <rules.json> [--dry-run] [--cli <sloppy.mjs>]
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  asFolder,
  COVERS,
  filled,
  loadRules,
  underRoots,
} from "./anchor-docs.mjs";
import { documentsIn } from "./carry-docs.mjs";
import { McpClient } from "./lib/mcp-client.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CLI = path.resolve(HERE, "../packages/ts/cli/dist/sloppy.mjs");

function parseArguments(argv) {
  const rest = [];
  let rules;
  let cli = DEFAULT_CLI;
  let dryRun = false;
  for (let at = 0; at < argv.length; at++) {
    if (argv[at] === "--rules") rules = path.resolve(argv[++at]);
    else if (argv[at] === "--cli") cli = path.resolve(argv[++at]);
    else if (argv[at] === "--dry-run") dryRun = true;
    else rest.push(argv[at]);
  }
  if (rest.length !== 1 || !rules) {
    console.error(
      "usage: node bench/tag-notes.mjs <project dir> --rules <rules.json> [--dry-run] [--cli <sloppy.mjs>]",
    );
    process.exit(2);
  }
  return { project: path.resolve(rest[0]), rules, cli, dryRun };
}

export const asTag = (word) => word.toLowerCase().replace(/_/g, "-");

/** The folders a document's `Covers:` line names. */
export function coveredBy(text) {
  const line = text.split(/\r?\n/).find((one) => one.startsWith(COVERS));
  if (!line) return [];
  return line
    .slice(COVERS.length)
    .split(",")
    .map((one) => asFolder(one.trim()))
    .filter(Boolean);
}

/** A document's tags: every matching path rule's, then the last segment of each folder it
 *  covers under the code roots; deduplicated, in that order. */
export function tagsFor(doc, text, rules) {
  const tags = [];
  for (const rule of rules.tagRules) {
    const match = rule.match.exec(doc);
    if (!match) continue;
    for (const tag of rule.tags) tags.push(asTag(filled(tag, match)));
  }
  for (const folder of coveredBy(text))
    if (underRoots(folder, rules.codeRoots))
      tags.push(asTag(folder.split("/").at(-1)));
  return [...new Set(tags.filter(Boolean))];
}

const FIRST_LINK = /^\[[^\n]*\]\(code:([^)#\s]+)\)\s*$/m;

/** Each carried document's note, by the document its first block links. */
export function notesByDocument(project) {
  const notes = path.join(project, ".sloppy", "notes");
  const found = new Map();
  for (const name of readdirSync(notes).filter((one) => one.endsWith(".md"))) {
    const text = readFileSync(path.join(notes, name), "utf8");
    const ref = /^ref: (\S+)$/m.exec(text)?.[1];
    const body = text.slice(text.indexOf("\n---", 3) + 4);
    const firstBlock = body.split(/<!-- block \w+ -->/)[1] ?? "";
    const doc = FIRST_LINK.exec(firstBlock.trim())?.[1];
    if (ref && doc) found.set(doc, ref);
  }
  return found;
}

async function main() {
  const {
    project,
    rules: rulesFile,
    cli,
    dryRun,
  } = parseArguments(process.argv.slice(2));
  const rules = loadRules(rulesFile);
  const mcp = await McpClient.start({
    command: "node",
    args: [cli, "mcp", "--profile", "full"],
    cwd: project,
  });
  try {
    const distribution = new Map();
    let tagged = 0;
    const missing = [];
    const notes = notesByDocument(project);
    for (const doc of documentsIn(project, rules.docRoots).docs) {
      const tags = tagsFor(
        doc,
        readFileSync(path.join(project, doc), "utf8"),
        rules,
      );
      if (tags.length === 0) continue;
      const note = notes.get(doc);
      if (!note) {
        missing.push(doc);
        continue;
      }
      if (!dryRun) {
        const answer = await mcp.callTool("tag_note", { note, tags });
        if (answer.isError) throw new Error(`tag_note ${doc}: ${answer.text}`);
      }
      tagged++;
      for (const tag of tags)
        distribution.set(tag, (distribution.get(tag) ?? 0) + 1);
    }
    if (missing.length > 0) {
      console.log(`documents with no note: ${missing.length}`);
      for (const doc of missing) console.log(`  ${doc}`);
      process.exitCode = 1;
    }
    console.log(`notes tagged: ${tagged}`);
    for (const [tag, count] of [...distribution].sort(
      (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
    ))
      console.log(`  ${tag}: ${count}`);
  } finally {
    await mcp.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
