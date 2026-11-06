#!/usr/bin/env node
// Carries a project's own design documents into its Sloppy container, one note per document,
// through `sloppy mcp --profile full` — SURVEY.md § "How their documents become notes" is the
// rule, README.md § "Carrying a project's documents" the manual.
//
// usage: node bench/carry-docs.mjs <project dir> <doc dir or file>... [--cli <sloppy.mjs>]
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CLI = path.resolve(HERE, "../packages/ts/cli/dist/sloppy.mjs");
const CARRIED = new Set([".md", ".markdown", ".mdx"]);
const KEPT_FRONT_MATTER = ["title", "status", "date"];
const OPENING = "Opening";
const SECTION_MAX = 16384;
const SECTIONS_PER_WRITE = 32;
const TITLE_MAX = 512;

function parseArguments(argv) {
  const rest = [];
  let cli = DEFAULT_CLI;
  for (let at = 0; at < argv.length; at++) {
    if (argv[at] === "--cli") cli = path.resolve(argv[++at]);
    else rest.push(argv[at]);
  }
  if (rest.length < 2) {
    console.error(
      "usage: node bench/carry-docs.mjs <project dir> <doc dir or file>... [--cli <sloppy.mjs>]",
    );
    process.exit(2);
  }
  return { project: path.resolve(rest[0]), inputs: rest.slice(1), cli };
}

const posix = (p) => p.split(path.sep).join("/");

/** Every file under the inputs, project-relative and sorted, with what was refused. */
function documentsIn(project, inputs) {
  const found = new Set();
  const skipped = [];
  const walk = (abs) => {
    for (const name of readdirSync(abs).sort()) {
      if (name === ".git" || name === ".sloppy" || name === "node_modules")
        continue;
      const child = path.join(abs, name);
      if (statSync(child).isDirectory()) walk(child);
      else found.add(child);
    }
  };
  for (const input of inputs) {
    const abs = path.resolve(project, input);
    const rel = posix(path.relative(project, abs));
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      skipped.push({ path: input, why: "outside the project" });
    } else if (!existsSync(abs)) {
      skipped.push({ path: rel, why: "not found" });
    } else if (statSync(abs).isDirectory()) walk(abs);
    else found.add(abs);
  }
  const docs = [];
  for (const abs of found) {
    const rel = posix(path.relative(project, abs));
    if (CARRIED.has(path.extname(rel).toLowerCase())) docs.push(rel);
    else skipped.push({ path: rel, why: "not markdown" });
  }
  docs.sort(byCodepoint);
  skipped.sort((a, b) => byCodepoint(a.path, b.path));
  return { docs, skipped };
}

function byCodepoint(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The repository's files, which are what a document can be linked to. */
function repoFiles(project) {
  try {
    const out = execFileSync(
      "git",
      ["-c", "core.hooksPath=/dev/null", "-C", project, "ls-files", "-z"],
      { encoding: "utf8", maxBuffer: 1 << 28 },
    );
    return new Set(out.split("\0").filter(Boolean));
  } catch {
    const files = new Set();
    const walk = (abs) => {
      for (const name of readdirSync(abs)) {
        if (name === ".git" || name === ".sloppy" || name === "node_modules")
          continue;
        const child = path.join(abs, name);
        if (statSync(child).isDirectory()) walk(child);
        else files.add(posix(path.relative(project, child)));
      }
    };
    walk(project);
    return files;
  }
}

function splitFrontMatter(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const fence = lines[0]?.trim();
  if (fence !== "---" && fence !== "+++") return { fields: [], body: lines };
  const closes = lines.findIndex(
    (line, at) =>
      at > 0 &&
      (line.trim() === fence || (fence === "---" && line.trim() === "...")),
  );
  if (closes === -1) return { fields: [], body: lines };
  const fields = [];
  for (const line of lines.slice(1, closes)) {
    const field = /^\s*([A-Za-z_][\w-]*)\s*[:=]\s*(.*)$/.exec(line);
    if (!field) continue;
    const key = field[1].toLowerCase();
    const value = field[2].trim().replace(/^(["'])(.*)\1$/, "$2");
    if (KEPT_FRONT_MATTER.includes(key) && value !== "")
      fields.push({ key, value });
  }
  fields.sort(
    (a, b) =>
      KEPT_FRONT_MATTER.indexOf(a.key) - KEPT_FRONT_MATTER.indexOf(b.key),
  );
  return { fields, body: lines.slice(closes + 1) };
}

const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})\s*([^`]*)$/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const MARKER = /^( {0,3})([-*+]|\d{1,9}[.)])(?:([ \t]+)(.*))?$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;

const indentOf = (line) => /^ */.exec(line.replace(/\t/g, "    "))[0].length;
const blank = (line) => line.trim() === "";
const detab = (line) =>
  line.replace(/^\t+/, (tabs) => "    ".repeat(tabs.length));

function dedent(line, by) {
  const plain = detab(line);
  const lead = Math.min(indentOf(plain), by);
  return plain.slice(lead);
}

/** Whether a line opens a block of its own rather than continuing a paragraph. */
function interrupts(line) {
  return (
    FENCE_OPEN.test(line) ||
    ATX.test(line) ||
    RULE.test(line) ||
    /^ {0,3}>/.test(line) ||
    /^ {0,3}([-*+]|1[.)])[ \t]+\S/.test(line) ||
    /^ {0,3}\|/.test(line) ||
    /^ {0,3}<[A-Za-z!/]/.test(line) ||
    /^ {0,3}\$\$\s*$/.test(line)
  );
}

function parseBlocks(lines, mdx = false) {
  const blocks = [];
  let at = 0;
  while (at < lines.length) {
    const line = detab(lines[at]);
    if (blank(line)) {
      at++;
      continue;
    }
    if (mdx && /^(import|export)\s/.test(line)) {
      at++;
      continue;
    }
    const fence = FENCE_OPEN.exec(line);
    if (fence && !(fence[2][0] === "`" && fence[3].includes("`"))) {
      const [, lead, bar] = fence;
      const body = [];
      at++;
      while (at < lines.length) {
        const inner = detab(lines[at]);
        const closing = new RegExp(
          `^ {0,3}${bar[0] === "`" ? "`" : "~"}{${bar.length},}\\s*$`,
        );
        if (closing.test(inner)) {
          at++;
          break;
        }
        body.push(dedent(inner, lead.length));
        at++;
      }
      blocks.push({
        kind: "fence",
        info: fence[3].trim().split(/\s+/)[0] ?? "",
        body,
      });
      continue;
    }
    if (/^ {0,3}\$\$\s*$/.test(line)) {
      const body = [];
      at++;
      while (at < lines.length && !/^ {0,3}\$\$\s*$/.test(lines[at]))
        body.push(lines[at++]);
      at++;
      blocks.push({ kind: "math", body });
      continue;
    }
    const atx = ATX.exec(line);
    if (atx) {
      blocks.push({
        kind: "heading",
        level: atx[1].length,
        text: (atx[2] ?? "").trim(),
      });
      at++;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ kind: "rule" });
      at++;
      continue;
    }
    if (/^ {0,3}>/.test(line)) {
      const inner = [];
      while (at < lines.length && !blank(lines[at])) {
        const quoted = /^ {0,3}> ?(.*)$/.exec(detab(lines[at]));
        if (quoted) inner.push(quoted[1]);
        else if (interrupts(lines[at])) break;
        else inner.push(lines[at]);
        at++;
      }
      blocks.push({ kind: "quote", blocks: parseBlocks(inner) });
      continue;
    }
    const marker = MARKER.exec(line);
    if (marker) {
      const read = parseList(lines, at);
      blocks.push(read.block);
      at = read.next;
      continue;
    }
    if (indentOf(line) >= 4) {
      const body = [];
      while (
        at < lines.length &&
        (blank(lines[at]) || indentOf(detab(lines[at])) >= 4)
      ) {
        body.push(dedent(lines[at], 4));
        at++;
      }
      while (body.length > 0 && blank(body[body.length - 1])) body.pop();
      blocks.push({ kind: "fence", info: "", body });
      continue;
    }
    if (/^ {0,3}\|/.test(line) || /^ {0,3}<[A-Za-z!/]/.test(line)) {
      const raw = [];
      while (at < lines.length && !blank(lines[at]))
        raw.push(lines[at++].trim());
      blocks.push({
        kind: line.trimStart().startsWith("|") ? "table" : "html",
        lines: raw,
      });
      continue;
    }
    const run = [line.trim()];
    const breaks = [/( {2,}|\\)$/.test(line)];
    at++;
    let setext = 0;
    while (at < lines.length && !blank(lines[at])) {
      const next = detab(lines[at]);
      const under = SETEXT.exec(next);
      if (under) {
        setext = under[1][0] === "=" ? 1 : 2;
        at++;
        break;
      }
      if (interrupts(next)) break;
      run.push(next.trim());
      breaks.push(/( {2,}|\\)$/.test(next));
      at++;
    }
    if (setext) {
      blocks.push({ kind: "heading", level: setext, text: run.join(" ") });
      continue;
    }
    blocks.push({ kind: "para", lines: run, breaks });
  }
  return blocks;
}

function parseList(lines, start) {
  const first = MARKER.exec(detab(lines[start]));
  const ordered = /\d/.test(first[2]);
  const listIndent = first[1].length;
  const items = [];
  let at = start;
  while (at < lines.length) {
    const line = detab(lines[at]);
    const marker = MARKER.exec(line);
    if (
      !marker ||
      /\d/.test(marker[2]) !== ordered ||
      marker[1].length > listIndent + 3
    )
      break;
    const spaces = marker[3] ?? " ";
    const content =
      marker[1].length +
      marker[2].length +
      (spaces.length > 4 ? 1 : spaces.length);
    const body = [marker[4] ?? ""];
    at++;
    let sawBlank = false;
    while (at < lines.length) {
      const next = detab(lines[at]);
      if (blank(next)) {
        body.push("");
        sawBlank = true;
        at++;
        continue;
      }
      if (indentOf(next) >= content) {
        body.push(next.slice(content));
        sawBlank = false;
        at++;
        continue;
      }
      if (!sawBlank && !interrupts(next) && !MARKER.test(next)) {
        body.push(next.trim());
        at++;
        continue;
      }
      break;
    }
    while (body.length > 1 && body[body.length - 1] === "") body.pop();
    const task = !ordered ? /^\[([ xX])\][ \t]+(.*)$/.exec(body[0]) : null;
    if (task) body[0] = task[2];
    items.push({
      ...(task ? { checked: task[1] !== " " } : {}),
      number: ordered ? Number(/\d+/.exec(marker[2])[0]) : undefined,
      blocks: parseBlocks(body),
    });
    if (at < lines.length && blank(lines[at])) {
      let ahead = at;
      while (ahead < lines.length && blank(lines[ahead])) ahead++;
      const again =
        ahead < lines.length ? MARKER.exec(detab(lines[ahead])) : null;
      if (
        !again ||
        /\d/.test(again[2]) !== ordered ||
        again[1].length > listIndent + 3
      )
        break;
      at = ahead;
    }
  }
  const isTask = items.some((item) => item.checked !== undefined);
  return {
    block: {
      kind: "list",
      ordered,
      task: isTask,
      start: items[0]?.number ?? 1,
      items,
    },
    next: at,
  };
}

const PATHLIKE = /^\/?(?:\.{1,2}\/)*[\w@+-][\w.@+-]*(?:\/[\w.@+-]+)*$/;

/** CommonMark reads an underscore inside a word as a letter; the container's markdown reads it
 *  as emphasis unless escaped. */
function intraword(text) {
  return text.replace(/(?<=[\p{L}\p{N}])_(?=[\p{L}\p{N}])/gu, "\\_");
}

function outsideCode(text, change) {
  return text
    .split(/(`+[^`]*`+)/)
    .map((piece, i) => (i % 2 === 1 ? piece : change(piece)))
    .join("");
}

class Linker {
  constructor(files, docPath) {
    this.files = files;
    this.doc = docPath;
    this.dir = path.posix.dirname(docPath);
    this.linked = new Set();
  }

  /** The repository file a relative name means here, or undefined. */
  resolve(target) {
    let name = target.trim();
    if (
      name === "" ||
      /^[a-z][a-z0-9+.-]*:/i.test(name) ||
      name.startsWith("#") ||
      name.startsWith("//")
    ) {
      return undefined;
    }
    let fragment = "";
    const hash = name.indexOf("#");
    if (hash !== -1) {
      fragment = name.slice(hash + 1);
      name = name.slice(0, hash);
    }
    name = name.split("?")[0];
    try {
      name = decodeURIComponent(name);
    } catch {}
    const tries = name.startsWith("/")
      ? [name.slice(1)]
      : [path.posix.join(this.dir, name), path.posix.normalize(name)];
    for (const candidate of tries) {
      const at = path.posix.normalize(candidate);
      if (at.startsWith("..") || at === this.doc) continue;
      if (this.files.has(at)) {
        this.linked.add(at);
        return /^L\d+(-L\d+)?$/.test(fragment) ? `${at}#${fragment}` : at;
      }
    }
    return undefined;
  }

  inline(text) {
    let out = "";
    let at = 0;
    let plain = "";
    const flush = () => {
      out += this.bare(plain);
      plain = "";
    };
    while (at < text.length) {
      const ch = text[at];
      if (ch === "\\" && at + 1 < text.length) {
        plain += text.slice(at, at + 2);
        at += 2;
        continue;
      }
      if (ch === "`") {
        const bar = /^`+/.exec(text.slice(at))[0];
        const closes = text.indexOf(bar, at + bar.length);
        if (closes === -1) {
          plain += bar;
          at += bar.length;
          continue;
        }
        flush();
        const span = text.slice(at, closes + bar.length);
        const inner = text.slice(at + bar.length, closes).trim();
        const target =
          PATHLIKE.test(inner) && /[./]/.test(inner)
            ? this.resolve(inner)
            : undefined;
        out += target ? `[${span}](code:${target})` : span;
        at = closes + bar.length;
        continue;
      }
      if (ch === "[" || (ch === "!" && text[at + 1] === "[")) {
        const link = this.link(text, at);
        if (link) {
          flush();
          out += link.markdown;
          at = link.next;
          continue;
        }
      }
      plain += ch;
      at++;
    }
    flush();
    return out;
  }

  /** A `[label](target)` or `![alt](target)` at `at`; an image becomes a link, since a picture
   *  is an upload the container holds and these are files the repository does. */
  link(text, at) {
    const image = text[at] === "!";
    const open = image ? at + 1 : at;
    let depth = 0;
    let closes = -1;
    for (let i = open; i < text.length; i++) {
      if (text[i] === "\\") {
        i++;
        continue;
      }
      if (text[i] === "[") depth++;
      else if (text[i] === "]" && --depth === 0) {
        closes = i;
        break;
      }
    }
    if (closes === -1 || text[closes + 1] !== "(") return undefined;
    let ends = -1;
    let parens = 0;
    for (let i = closes + 2; i < text.length; i++) {
      if (text[i] === "(") parens++;
      else if (text[i] === ")" && parens-- === 0) {
        ends = i;
        break;
      }
    }
    if (ends === -1) return undefined;
    const label = text.slice(open + 1, closes);
    const raw = text.slice(closes + 2, ends).trim();
    const target = raw.replace(/^<(.*)>$/, "$1").replace(/\s+(["'(]).*$/, "");
    const shown = outsideCode(label.trim() === "" ? target : label, intraword);
    const repo = this.resolve(target);
    let markdown;
    if (repo) markdown = `[${shown}](code:${repo})`;
    else if (/\s/.test(target) || target === "") markdown = shown;
    else markdown = `[${shown}](${target})`;
    return { markdown, next: ends + 1 };
  }

  /** Plain prose naming a file by a path with a slash in it. */
  bare(text) {
    const named =
      /(^|[\s(,;"'])((?:\.{1,2}\/)*[\w@+-][\w.@+-]*(?:\/[\w.@+-]+)+)/g;
    let out = "";
    let from = 0;
    for (const match of text.matchAll(named)) {
      const [, before, name] = match;
      const trimmed = name.replace(/[.,:;]+$/, "");
      const target = this.resolve(trimmed);
      if (!target) continue;
      const at = match.index + before.length;
      out += `${intraword(text.slice(from, at))}[${intraword(trimmed)}](code:${target})`;
      from = at + trimmed.length;
    }
    return out + intraword(text.slice(from));
  }
}

function longestRun(body, ch) {
  let most = 0;
  for (const line of body)
    for (const run of line.match(new RegExp(`\\${ch}+`, "g")) ?? [])
      most = Math.max(most, run.length);
  return most;
}

function emit(block, linker, demote = (level) => level) {
  switch (block.kind) {
    case "heading":
      return [
        `${"#".repeat(Math.min(6, demote(block.level)))} ${linker.inline(block.text)}`,
      ];
    case "para": {
      const out = [];
      let current = "";
      block.lines.forEach((line, i) => {
        const text = linker.inline(line.replace(/( {2,}|\\)$/, ""));
        current = current === "" ? text : `${current} ${text}`;
        if (block.breaks[i] && i < block.lines.length - 1) {
          out.push(`${current}\\`);
          current = "";
        }
      });
      out.push(current);
      return out.map((line, i) => (i === 0 ? guardStart(line) : line));
    }
    case "fence": {
      const bar = "`".repeat(Math.max(3, longestRun(block.body, "`") + 1));
      return [`${bar}${block.info}`, ...block.body, bar];
    }
    case "math":
      return ["$$", ...block.body, "$$"];
    case "rule":
      return ["***"];
    case "table":
      return block.lines.map((line) => linker.inline(line));
    case "html":
      return [...block.lines];
    case "quote":
      return joinBlocks(block.blocks, linker, demote).map((line) =>
        line === "" ? ">" : `> ${line}`,
      );
    case "list": {
      const out = [];
      block.items.forEach((item, i) => {
        const marker = block.ordered
          ? `${block.start + i}. `
          : block.task
            ? `- [${item.checked ? "x" : " "}] `
            : "- ";
        const pad = " ".repeat(marker.length);
        const lines = joinBlocks(item.blocks, linker, demote);
        if (lines.length === 0) lines.push("");
        lines.forEach((line, j) =>
          out.push(j === 0 ? marker + line : line === "" ? "" : pad + line),
        );
      });
      return out;
    }
    default:
      return [];
  }
}

/** A paragraph whose words happen to open like a block is escaped, so it stays a paragraph. */
function guardStart(line) {
  if (/^(#{1,6}( |$)|>|- |\d+\. |\*\*\*$|\$\$$|`{3,}|!\[)/.test(line))
    return `\\${line}`;
  return line;
}

function joinBlocks(blocks, linker, demote) {
  const out = [];
  for (const block of blocks) {
    if (out.length > 0) out.push("");
    out.push(...emit(block, linker, demote));
  }
  return out;
}

function plainHeading(text) {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function noteOf(rel, text, files) {
  const { fields, body } = splitFrontMatter(text);
  const blocks = parseBlocks(body, rel.toLowerCase().endsWith(".mdx"));
  const linker = new Linker(files, rel);

  const firstHeading = blocks.findIndex((block) => block.kind === "heading");
  const titleAt = blocks[firstHeading]?.level === 1 ? firstHeading : -1;
  const fmTitle = fields.find((field) => field.key === "title")?.value;
  const title = (
    titleAt !== -1 && plainHeading(blocks[titleAt].text) !== ""
      ? plainHeading(blocks[titleAt].text)
      : (fmTitle ?? path.posix.basename(rel).replace(/\.[^.]+$/, ""))
  ).slice(0, TITLE_MAX);
  if (titleAt !== -1) blocks.splice(titleAt, 1);

  const levels = blocks
    .filter((block) => block.kind === "heading")
    .map((block) => block.level);
  const split = levels.length === 0 ? 7 : Math.max(2, Math.min(...levels));
  const demote = (level) => 2 + Math.max(0, level - split);

  const sections = [];
  let current = { heading: OPENING, blocks: [] };
  if (fields.length > 0) {
    current.blocks.push({
      kind: "list",
      ordered: false,
      task: false,
      start: 1,
      items: fields.map((field) => ({
        blocks: [
          {
            kind: "para",
            lines: [`${field.key}: ${field.value}`],
            breaks: [false],
          },
        ],
      })),
    });
  }
  for (const block of blocks) {
    if (block.kind === "heading" && block.level <= split) {
      if (current.heading !== OPENING || current.blocks.length > 0)
        sections.push(current);
      current = { heading: block.text, blocks: [] };
    } else current.blocks.push(block);
  }
  if (current.heading !== OPENING || current.blocks.length > 0)
    sections.push(current);

  const taken = new Set();
  const unique = (heading) => {
    const shown = heading === "" ? "Untitled" : heading;
    let name = shown;
    for (let n = 2; taken.has(plainHeading(name).toLowerCase()); n++)
      name = `${shown} (${n})`;
    taken.add(plainHeading(name).toLowerCase());
    return name;
  };

  const markdown = [];
  for (const section of sections) {
    const heading = linker.inline(section.heading);
    for (const [i, part] of chunks(section.blocks, linker, demote).entries()) {
      const name = unique(i === 0 ? heading : `${heading} (continued)`);
      markdown.push(
        [`## ${name}`, ...(part.length > 0 ? ["", ...part] : [])].join("\n"),
      );
    }
  }
  const words =
    body.join("\n").split(/\s+/).filter(Boolean).length + fields.length * 2;
  return {
    title,
    sections: markdown,
    links: [...linker.linked].sort(byCodepoint),
    words,
  };
}

/** A section's lines in parts no longer than a section may be, broken between blocks. */
function chunks(blocks, linker, demote) {
  const room = SECTION_MAX - 600;
  const parts = [];
  let current = [];
  const size = (lines) => lines.reduce((sum, line) => sum + line.length + 1, 0);
  const push = (lines) => {
    if (current.length > 0 && size(current) + size(lines) + 1 > room) {
      parts.push(current);
      current = [];
    }
    if (current.length > 0) current.push("");
    current.push(...lines);
  };
  for (const block of blocks) {
    const lines = emit(block, linker, demote);
    if (size(lines) <= room) {
      push(lines);
      continue;
    }
    for (const piece of splitBlock(block, lines, room)) push(piece);
  }
  if (current.length > 0 || parts.length === 0) parts.push(current);
  return parts;
}

function splitBlock(block, lines, room) {
  const fenced = block.kind === "fence";
  const open = fenced ? lines[0] : null;
  const close = fenced ? lines[lines.length - 1] : null;
  const inner = fenced ? lines.slice(1, -1) : lines;
  const pieces = [];
  let piece = [];
  let used = 0;
  for (const line of inner) {
    const held = line.length > room ? line.slice(0, room) : line;
    if (used + held.length + 1 > room - 20 && piece.length > 0) {
      pieces.push(piece);
      piece = [];
      used = 0;
    }
    piece.push(held);
    used += held.length + 1;
  }
  if (piece.length > 0) pieces.push(piece);
  return fenced ? pieces.map((p) => [open, ...p, close]) : pieces;
}

function serve(cli, project) {
  const server = spawn("node", [cli, "mcp", "--profile", "full"], {
    cwd: project,
    stdio: ["pipe", "pipe", "inherit"],
  });
  let buffer = "";
  const pending = new Map();
  server.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    let at;
    while ((at = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, at).trim();
      buffer = buffer.slice(at + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      const waiting = pending.get(message.id);
      if (waiting) {
        pending.delete(message.id);
        waiting(message);
      }
    }
  });
  let nextId = 1;
  const send = (method, params) => {
    const id = nextId++;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      server.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
    });
  };
  return {
    async open() {
      await send("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "carry-docs", version: "0" },
      });
      server.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
      );
    },
    async call(name, args) {
      const answer = await send("tools/call", { name, arguments: args });
      const result = answer.result ?? answer.error;
      const text = result?.content?.[0]?.text ?? JSON.stringify(result);
      return { ok: !(result?.isError ?? answer.error !== undefined), text };
    },
    close() {
      server.stdin.end();
    },
  };
}

async function main() {
  const { project, inputs, cli } = parseArguments(process.argv.slice(2));
  if (!existsSync(path.join(project, ".sloppy"))) {
    execFileSync("node", [cli, "init", project], {
      stdio: ["ignore", "ignore", "inherit"],
    });
  }
  const { docs, skipped } = documentsIn(project, inputs);
  const files = repoFiles(project);

  const mcp = serve(cli, project);
  await mcp.open();

  const listed = await mcp.call("list_notes", { about: true });
  if (!listed.ok) throw new Error(`list_notes: ${listed.text}`);
  const notes = JSON.parse(listed.text).notes;
  const root = notes.find((note) => note.parent === undefined);
  if (!root)
    throw new Error("the project has no note to hang the documents under");

  let written = 0;
  let foldersWritten = 0;
  let words = 0;
  let links = 0;
  const failed = [];

  const folders = new Map([["", root.note]]);
  const dirs = [...new Set(docs.map((doc) => path.posix.dirname(doc)))]
    .filter((dir) => dir !== ".")
    .sort(byCodepoint);
  for (const dir of dirs) {
    const standing = notes.find((note) => (note.about ?? []).includes(dir));
    if (standing) {
      folders.set(dir, standing.note);
      continue;
    }
    const answer = await mcp.call("write_note", {
      about: dir,
      title: dir,
      sections: [`## Folder\n\nThe documents in \`${dir}\`.`],
      start: true,
      under: root.note,
    });
    if (!answer.ok) throw new Error(`write_note ${dir}: ${answer.text}`);
    folders.set(dir, JSON.parse(answer.text).note);
    foldersWritten++;
  }

  for (const doc of docs) {
    const text = readFileSync(path.join(project, doc), "utf8");
    const note = noteOf(doc, text, files);
    if (note.sections.length === 0) {
      skipped.push({ path: doc, why: "nothing in it to carry" });
      continue;
    }
    const dir = path.posix.dirname(doc);
    const under = folders.get(dir === "." ? "" : dir);
    let ok = true;
    for (let at = 0; at < note.sections.length; at += SECTIONS_PER_WRITE) {
      const answer = await mcp.call("write_note", {
        about: doc,
        ...(at === 0 ? { title: note.title, under } : {}),
        sections: note.sections.slice(at, at + SECTIONS_PER_WRITE),
        start: true,
      });
      if (!answer.ok) {
        failed.push({ path: doc, why: answer.text });
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    written++;
    words += note.words;
    links += note.links.length;
  }
  mcp.close();

  console.log(
    `notes written: ${written + foldersWritten} (${written} documents, ${foldersWritten} folders)`,
  );
  console.log(`words carried: ${words}`);
  console.log(`links made: ${links}`);
  const refused = [...skipped, ...failed].sort((a, b) =>
    byCodepoint(a.path, b.path),
  );
  console.log(`documents skipped: ${refused.length}`);
  for (const one of refused) console.log(`  ${one.path}: ${one.why}`);
  if (failed.length > 0) process.exitCode = 1;
}

await main();
