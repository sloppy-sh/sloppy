// A section's document as markdown, and back. docs/ARCHITECTURE.md § "A graph
// on disk" states the contract this keeps: the conversion is lossless, and an
// element whose markdown would read back as something else is written as its
// JSON instead of guessed at.

import {
  type BlockDocument,
  type Compass,
  COMPASS_DIRECTIONS,
  COMPASS_TYPE,
  type CompassDirection,
  compassNode,
  type DocumentMark,
  type DocumentNode,
  EMOJI_SHORTCODE_PATTERN,
  opensDiagram,
  type OwnedRef,
  OwnedRefSchema,
  REFERENCE_NOTE_ATTR,
} from "@sloppy/types";
import {
  INK_DIR,
  inkImagePath,
  inkStem,
  MEDIA_DIR,
  mediaPath,
  type PictureSize,
  SECTION_OPENER,
} from "./layout.js";

/** How an emoji is drawn, which its shortcode does not say: a standard one's
 *  character, a custom one's picture. */
export interface EmojiDrawing {
  char?: string;
  src?: string;
}

/**
 * Everything a section holds that markdown has no syntax for, alongside the
 * text. {@link toMarkdown} writes into it and {@link fromMarkdown} reads out of
 * it, so the two are inverse over the pair rather than over the text alone.
 *
 * `media` and `emoji` are filled in by whoever knows the files and the catalog
 * — a vault stores the pictures themselves rather than these entries.
 */
export interface Sidecars {
  /** The section these belong to. A drawing's files are named from it, so two
   *  sections of one note never name the same file. */
  block: string;
  /** Where an upload's bytes are in the vault, keyed by upload id. An upload
   *  missing from it is linked by its id alone. */
  media: Map<string, string>;
  /** A picture's pixel size, keyed by upload id — `.sloppy/pictures.json`. */
  pictures: Map<string, PictureSize>;
  /** A drawing's own attributes, keyed by its file stem — `.sloppy/ink/`. */
  ink: Map<string, Record<string, unknown>>;
  /** How each shortcode draws, keyed by shortcode. */
  emoji: Map<string, EmojiDrawing>;
}

export function emptySidecars(block: string): Sidecars {
  return {
    block,
    media: new Map(),
    pictures: new Map(),
    ink: new Map(),
    emoji: new Map(),
  };
}

/** What a drawing is the size of where its strokes did not survive the trip. */
const INK_WITHOUT_STROKES = { strokes: [], width: 600, height: 200 };

/**
 * Marks, outermost first. A run of text is written with its marks nested in
 * this order and reads back in it, so two documents carrying the same marks in
 * a different order write the same file — which is the one place the vault
 * settles an order the editor leaves open.
 */
const MARK_ORDER = ["link", "bold", "italic", "strike", "code"];

/** What the link extension decided rather than the person who wrote the link;
 *  a vault carries the address alone — docs/ARCHITECTURE.md § "A graph on disk". */
const RENDERED_LINK = ["target", "rel", "class", "title"];

const BLOCK_FALLBACK = "sloppy:node";
const INLINE_FALLBACK = "sloppy:span";
const EMPTY_PARAGRAPH = "<!-- -->";
const BLOCK_RULE = "***";
const REFERENCE_SCHEME = "sloppy:";

/** What a compass line is recognised by: the direction's own token, and the
 *  refs after it. The words a surface draws are never in the file. */
const COMPASS_LINE = new RegExp(`^(${COMPASS_DIRECTIONS.join("|")}): (.+)$`);
const COMPASS_CITE = /^\[\[(.+)\]\]$/;

const SAFE_PATH = /^[A-Za-z0-9._\-/]+$/;
const SAFE_HREF = /^[^\s()<>]+$/;
const SAFE_LANGUAGE = /^[^\s`]+$/;

/**
 * What an attribute has to be worth writing down. `null`, an empty string and
 * `false` are the three ways an editor attribute says nothing, and a vault
 * writes none of them — so a document carrying one reads back without it.
 */
function attrsOf(carrier: { attrs?: Record<string, unknown> }): {
  [key: string]: unknown;
} {
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(carrier.attrs ?? {})) {
    if (value === null || value === undefined) continue;
    if (value === "" || value === false) continue;
    kept[key] = value;
  }
  return kept;
}

function only(attrs: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(attrs).every((key) => keys.includes(key));
}

function node(
  type: string,
  attrs: Record<string, unknown>,
  content?: DocumentNode[],
): DocumentNode {
  const made: DocumentNode = { type };
  if (Object.keys(attrs).length > 0) made.attrs = attrs;
  if (content && content.length > 0) made.content = content;
  return made;
}

/** An HTML comment cannot hold `-->`; JSON only ever holds one inside a string,
 *  where `>` is the same character. */
function comment(tag: string, held: DocumentNode): string {
  const json = JSON.stringify(held).replace(/-->/g, "--\\u003e");
  return `<!-- ${tag} ${json} -->`;
}

function escapeText(value: string): string {
  let out = "";
  for (let at = 0; at < value.length; at++) {
    const character = value[at];
    if ("\\`*_~[]$".includes(character)) out += `\\${character}`;
    else if (character === "<" && value.startsWith("<!--", at)) out += "\\<";
    // A colon that could open a shortcode, and the one at the end of a run —
    // where whatever follows is the next element and might be an emoji's.
    else if (
      character === ":" &&
      (at === value.length - 1 || /[A-Za-z0-9_]/.test(value[at + 1]))
    )
      out += "\\:";
    else out += character;
  }
  return out;
}

function unescapeText(value: string): string {
  return value.replace(/\\(.)/g, "$1");
}

/** What a line must not open with to stay the paragraph it is — the space
 *  included, which the list before it would otherwise take for its own. */
function escapeLineStart(line: string): string {
  return /^([#>\-+=!\s]|\d+\.)/.test(line) ? `\\${line}` : line;
}

/**
 * A section's document as markdown, with everything markdown cannot carry
 * written into `sidecars`. The block the sidecars name is what a drawing's
 * files are named after, so one set of sidecars serves one section.
 */
export function toMarkdown(
  document: BlockDocument,
  sidecars: Sidecars,
): string {
  return writeBlocks(document.content ?? [], sidecars);
}

function writeBlocks(
  nodes: readonly DocumentNode[],
  sidecars: Sidecars,
): string {
  const written: string[] = [];
  let previousList: string | null = null;
  for (const held of nodes) {
    // Two lists of one kind with nothing between them read back as one list,
    // so the second is written as itself instead.
    const list = LIST_KINDS[held.type];
    const text: string | null =
      list && list === previousList ? null : writeBlock(held, sidecars);
    written.push(text ?? comment(BLOCK_FALLBACK, held));
    previousList = text === null ? null : (list ?? null);
  }
  return written.join("\n\n");
}

const LIST_KINDS: Record<string, string | undefined> = {
  bulletList: "bulletList",
  orderedList: "orderedList",
  taskList: "taskList",
};

/** Null where this element has no markdown that reads back as itself. */
function writeBlock(held: DocumentNode, sidecars: Sidecars): string | null {
  const text = writeElement(held, sidecars);
  if (text === null) return null;
  // A fence carries its source through untouched, so the one line a note's
  // body may not hold is the one that opens the next section.
  return text.split("\n").some((line) => SECTION_OPENER.test(line))
    ? null
    : text;
}

function writeElement(held: DocumentNode, sidecars: Sidecars): string | null {
  const attrs = attrsOf(held);
  const children = held.content ?? [];
  switch (held.type) {
    case "paragraph": {
      if (Object.keys(attrs).length > 0) return null;
      if (children.length === 0) return EMPTY_PARAGRAPH;
      const lines = writeInline(children, sidecars)
        .split("\n")
        .map(escapeLineStart);
      // A run of backticks a code span opened with cannot be escaped away, and
      // at the start of a line it would open a fence instead.
      if (lines.some((line) => /^`{3,}/.test(line))) return null;
      return lines.join("\n");
    }
    case "heading": {
      if (!only(attrs, ["level"])) return null;
      const level = attrs.level;
      if (typeof level !== "number" || !Number.isInteger(level)) return null;
      if (level < 1 || level > 6) return null;
      const inline = writeInline(children, sidecars);
      // A heading is one line; a line break inside one has nowhere to go.
      if (inline.includes("\n")) return null;
      return inline === ""
        ? "#".repeat(level)
        : `${"#".repeat(level)} ${inline}`;
    }
    case "horizontalRule":
      return Object.keys(attrs).length > 0 ? null : BLOCK_RULE;
    case "blockquote": {
      if (Object.keys(attrs).length > 0 || children.length === 0) return null;
      return writeBlocks(children, sidecars)
        .split("\n")
        .map((line) => (line === "" ? ">" : `> ${line}`))
        .join("\n");
    }
    case "codeBlock":
      return writeCode(held, attrs, children);
    case "diagram":
      return writeDiagram(attrs);
    case "mathBlock": {
      if (!only(attrs, ["tex"])) return null;
      const tex = attrs.tex === undefined ? "" : attrs.tex;
      if (typeof tex !== "string") return null;
      if (tex.split("\n").includes("$$")) return null;
      return `$$\n${tex}\n$$`;
    }
    case "bulletList":
    case "orderedList":
    case "taskList":
      return writeList(held, attrs, children, sidecars);
    case COMPASS_TYPE:
      return writeCompass(attrs);
    case "picture":
      return writePicture(attrs, sidecars);
    case "ink":
      return writeInk(held, sidecars);
    default:
      return null;
  }
}

function fence(source: string): string {
  const longest = Math.max(
    0,
    ...[...source.matchAll(/`+/g)].map((run) => run[0].length),
  );
  return "`".repeat(Math.max(3, longest + 1));
}

function writeCode(
  held: DocumentNode,
  attrs: Record<string, unknown>,
  children: readonly DocumentNode[],
): string | null {
  if (!only(attrs, ["language"])) return null;
  const language = attrs.language;
  if (language !== undefined) {
    if (typeof language !== "string" || !SAFE_LANGUAGE.test(language)) {
      return null;
    }
    // A fence in a diagram's language opens a diagram when it is read back.
    if (opensDiagram(language)) return null;
  }
  if (children.length > 1) return null;
  const first = children[0];
  if (first && (first.type !== "text" || first.marks?.length)) return null;
  const source = first?.text ?? "";
  if (source.includes("\r")) return null;
  const bar = fence(source);
  return `${bar}${language ?? ""}\n${source}\n${bar}`;
}

function writeDiagram(attrs: Record<string, unknown>): string | null {
  if (!only(attrs, ["language", "source"])) return null;
  const language = attrs.language;
  if (typeof language !== "string" || !opensDiagram(language)) return null;
  const source = attrs.source === undefined ? "" : attrs.source;
  if (typeof source !== "string" || source.includes("\r")) return null;
  const bar = fence(source);
  return `${bar}${language}\n${source}\n${bar}`;
}

function writeList(
  held: DocumentNode,
  attrs: Record<string, unknown>,
  children: readonly DocumentNode[],
  sidecars: Sidecars,
): string | null {
  if (children.length === 0) return null;
  const ordered = held.type === "orderedList";
  const tasks = held.type === "taskList";
  if (ordered ? !only(attrs, ["start"]) : Object.keys(attrs).length > 0) {
    return null;
  }
  const start = ordered ? (attrs.start ?? 1) : 1;
  if (typeof start !== "number" || !Number.isInteger(start) || start < 0) {
    return null;
  }
  const item = tasks ? "taskItem" : "listItem";
  // Every item is read before any of it is written: a list that turns out not
  // to be one leaves nothing of itself in the sidecars.
  const items = children.map((child) => ({ child, attrs: attrsOf(child) }));
  for (const { child, attrs: childAttrs } of items) {
    if (child.type !== item) return null;
    if (tasks ? !only(childAttrs, ["checked"]) : Object.keys(childAttrs).length)
      return null;
    if (
      tasks &&
      childAttrs.checked !== undefined &&
      childAttrs.checked !== true
    )
      return null;
    if ((child.content ?? []).length === 0) return null;
  }
  const written: string[] = [];
  for (const [index, { child, attrs: childAttrs }] of items.entries()) {
    const marker = tasks
      ? `- [${childAttrs.checked ? "x" : " "}] `
      : ordered
        ? `${start + index}. `
        : "- ";
    const body = writeBlocks(child.content ?? [], sidecars).split("\n");
    const indent = " ".repeat(marker.length);
    written.push(
      [
        marker + body[0],
        ...body.slice(1).map((line) => (line === "" ? "" : indent + line)),
      ].join("\n"),
    );
  }
  return written.join("\n");
}

/**
 * A compass as its own lines, one per filled direction in the order the
 * directions are written in. Only the shape the editor writes — the four slots
 * and nothing besides, each a list of refs — is written this way; anything else
 * goes as its JSON, so a document carrying a slot nobody gave it, or a slot
 * holding something that names no note, reads back carrying exactly that.
 *
 * A compass in a method other than the idea compass is one of those. A line
 * saying which method would end the run for a reader that does not know it, and
 * cut one compass into two — docs/ARCHITECTURE.md § "The compass".
 */
function writeCompass(attrs: Record<string, unknown>): string | null {
  if (!only(attrs, [...COMPASS_DIRECTIONS])) return null;
  const lines: string[] = [];
  for (const direction of COMPASS_DIRECTIONS) {
    const held = attrs[direction];
    if (!Array.isArray(held)) return null;
    const refs = held.map(citedRef);
    if (refs.some((ref) => ref === null)) return null;
    if (refs.length === 0) continue;
    lines.push(`${direction}: ${refs.map((ref) => `[[${ref}]]`).join(" ")}`);
  }
  // A compass with every slot empty has no lines, and a blank block reads back
  // as nothing at all.
  return lines.length === 0 ? null : lines.join("\n");
}

/** The note one place in a slot cites, or null where the place holds anything
 *  besides that — which the caller answers by writing the node's JSON. */
function citedRef(place: unknown): OwnedRef | null {
  if (place === null || typeof place !== "object") return null;
  const held = place as Record<string, unknown>;
  if (!only(held, [REFERENCE_NOTE_ATTR])) return null;
  const ref = OwnedRefSchema.safeParse(held[REFERENCE_NOTE_ATTR]);
  return ref.success ? ref.data : null;
}

function writePicture(
  attrs: Record<string, unknown>,
  sidecars: Sidecars,
): string | null {
  if (!only(attrs, ["upload_id", "alt", "width", "height"])) return null;
  const upload = attrs.upload_id;
  if (typeof upload !== "string" || upload === "") return null;
  const alt = attrs.alt ?? "";
  if (typeof alt !== "string" || alt.includes("\n")) return null;
  const size: PictureSize = {};
  for (const side of ["width", "height"] as const) {
    const measure = attrs[side];
    if (measure === undefined) continue;
    if (typeof measure !== "number" || measure <= 0) return null;
    size[side] = measure;
  }
  const already = sidecars.pictures.get(upload);
  if (already && !sameSize(already, size)) return null;
  const path = sidecars.media.get(upload) ?? mediaPath(upload);
  if (!path.startsWith(`${MEDIA_DIR}/`) || !SAFE_PATH.test(path)) return null;
  if (uploadOf(path) !== upload) return null;
  sidecars.pictures.set(upload, size);
  return `![${escapeText(alt)}](${path})`;
}

function sameSize(a: PictureSize, b: PictureSize): boolean {
  return a.width === b.width && a.height === b.height;
}

/** The upload a picture's link names: the file's own name, without whatever
 *  extension the bytes deserved. */
function uploadOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function writeInk(held: DocumentNode, sidecars: Sidecars): string | null {
  if (held.attrs === undefined) return null;
  let nth = 0;
  while (sidecars.ink.has(inkStem(sidecars.block, nth))) nth++;
  const stem = inkStem(sidecars.block, nth);
  sidecars.ink.set(stem, held.attrs);
  const description = held.attrs.description;
  const alt =
    typeof description === "string" && !description.includes("\n")
      ? description
      : "";
  return `![${escapeText(alt)}](${inkImagePath(stem)})`;
}

function writeInline(
  nodes: readonly DocumentNode[],
  sidecars: Sidecars,
): string {
  return nodes.map((held) => writeSpan(held, sidecars)).join("");
}

function writeSpan(held: DocumentNode, sidecars: Sidecars): string {
  const written =
    held.type === "text"
      ? writeRun(held)
      : held.marks?.length
        ? null
        : writeAtom(held, sidecars);
  return written ?? comment(INLINE_FALLBACK, held);
}

function writeAtom(held: DocumentNode, sidecars: Sidecars): string | null {
  const attrs = attrsOf(held);
  switch (held.type) {
    case "hardBreak":
      return Object.keys(attrs).length > 0 ? null : "\\\n";
    case "emoji":
      return writeEmoji(attrs, sidecars);
    case "reference": {
      if (!only(attrs, ["note", "label"])) return null;
      const cited = OwnedRefSchema.safeParse(attrs.note);
      if (!cited.success) return null;
      const label = attrs.label ?? "";
      if (typeof label !== "string" || label.includes("\n")) return null;
      return `[${escapeText(label)}](${REFERENCE_SCHEME}${cited.data})`;
    }
    case "math": {
      if (!only(attrs, ["tex"])) return null;
      const tex = attrs.tex;
      if (typeof tex !== "string" || tex === "") return null;
      if (tex.includes("$") || tex.includes("\n")) return null;
      return `$${tex}$`;
    }
    default:
      return null;
  }
}

function writeEmoji(
  attrs: Record<string, unknown>,
  sidecars: Sidecars,
): string | null {
  if (!only(attrs, ["name", "char", "src", "sticker"])) return null;
  const name = attrs.name;
  if (typeof name !== "string" || !EMOJI_SHORTCODE_PATTERN.test(name)) {
    return null;
  }
  if (attrs.sticker !== undefined && attrs.sticker !== true) return null;
  const drawing: EmojiDrawing = {};
  for (const key of ["char", "src"] as const) {
    const held = attrs[key];
    if (held === undefined) continue;
    if (typeof held !== "string") return null;
    drawing[key] = held;
  }
  const already = sidecars.emoji.get(name);
  if (already && (already.char !== drawing.char || already.src !== drawing.src))
    return null;
  sidecars.emoji.set(name, drawing);
  const wrap = attrs.sticker ? "::" : ":";
  return `${wrap}${name}${wrap}`;
}

/**
 * Where a link goes, or null where the run has to be written as its JSON: an
 * address markdown cannot hold, and one that would read back as a citation of a
 * note rather than as a link to it.
 */
function linkHref(mark: DocumentMark): string | null {
  const attrs = attrsOf(mark);
  if (!only(attrs, [...RENDERED_LINK, "href"])) return null;
  const href = attrs.href;
  if (typeof href !== "string" || !SAFE_HREF.test(href)) return null;
  if (
    href.startsWith(REFERENCE_SCHEME) &&
    OwnedRefSchema.safeParse(href.slice(REFERENCE_SCHEME.length)).success
  ) {
    return null;
  }
  return href;
}

function writeRun(held: DocumentNode): string | null {
  const value = held.text ?? "";
  if (value === "" || value.includes("\n")) return null;
  const marks = held.marks ?? [];
  let href: string | null = null;
  for (const mark of marks) {
    if (!MARK_ORDER.includes(mark.type)) return null;
    if (mark.type === "link") {
      href = linkHref(mark);
      if (href === null) return null;
      continue;
    }
    if (Object.keys(attrsOf(mark)).length > 0) return null;
  }
  const carries = (type: string): boolean =>
    marks.some((mark) => mark.type === type);
  let out: string;
  if (carries("code")) {
    const span = writeCodeSpan(value);
    if (span === null) return null;
    out = span;
  } else {
    out = escapeText(value);
  }
  if (carries("strike")) out = `~~${out}~~`;
  if (carries("italic")) out = `_${out}_`;
  if (carries("bold")) out = `**${out}**`;
  if (href !== null) out = `[${out}](${href})`;
  return out;
}

function writeCodeSpan(value: string): string | null {
  if (value.trim() === "") return null;
  const longest = Math.max(
    0,
    ...[...value.matchAll(/`+/g)].map((run) => run[0].length),
  );
  const bar = "`".repeat(longest + 1);
  const pad =
    value.startsWith("`") ||
    value.endsWith("`") ||
    value.startsWith(" ") ||
    value.endsWith(" ")
      ? " "
      : "";
  return `${bar}${pad}${value}${pad}${bar}`;
}

/**
 * A section's markdown as the document it was written from. `sidecars` carries
 * what the text does not: a drawing's strokes, a picture's size, an emoji's
 * drawing. What is missing from it is what a reader re-derives, so a section
 * still opens around a sidecar somebody deleted.
 */
export function fromMarkdown(text: string, sidecars: Sidecars): BlockDocument {
  const content = readBlocks(text.split("\n"), sidecars);
  return content.length > 0
    ? { type: "doc", content }
    : { type: "doc", content: [] };
}

function readBlocks(
  lines: readonly string[],
  sidecars: Sidecars,
): DocumentNode[] {
  const out: DocumentNode[] = [];
  let at = 0;
  while (at < lines.length) {
    const line = lines[at];
    if (line === "") {
      at++;
      continue;
    }
    const read = readBlock(lines, at, sidecars);
    out.push(read.node);
    at = read.next;
  }
  return out;
}

interface Read {
  node: DocumentNode;
  next: number;
}

function readBlock(
  lines: readonly string[],
  at: number,
  sidecars: Sidecars,
): Read {
  const line = lines[at];

  const held = heldJson(line, BLOCK_FALLBACK);
  if (held) return { node: held, next: at + 1 };
  if (line === EMPTY_PARAGRAPH) {
    return { node: { type: "paragraph" }, next: at + 1 };
  }
  if (line === BLOCK_RULE) {
    return { node: { type: "horizontalRule" }, next: at + 1 };
  }

  const opened = /^(`{3,})(.*)$/.exec(line);
  if (opened) return readFence(lines, at, opened[1], opened[2]);

  if (line === "$$") return readMathBlock(lines, at);

  const heading = /^(#{1,6})(?: (.*))?$/.exec(line);
  if (heading) {
    return {
      node: node(
        "heading",
        { level: heading[1].length },
        readInline(heading[2] ?? "", sidecars),
      ),
      next: at + 1,
    };
  }

  if (line.startsWith(">")) return readQuote(lines, at, sidecars);

  const marker = markerAt(line);
  if (marker) return readList(lines, at, marker.kind, sidecars);

  const image = imageLine(line);
  if (image) return { node: readImage(image, sidecars), next: at + 1 };

  if (compassLine(line)) return readCompass(lines, at);

  return readParagraph(lines, at, sidecars);
}

/** The slot a line fills, or null where it is not one — which is every line a
 *  person's prose can write, because the writer escapes a bracket in a
 *  sentence and a citation of a note is written as a link. */
function compassLine(
  line: string,
): { direction: CompassDirection; refs: OwnedRef[] } | null {
  const held = COMPASS_LINE.exec(line);
  if (!held) return null;
  const refs: OwnedRef[] = [];
  for (const cited of held[2].split(" ")) {
    const ref = OwnedRefSchema.safeParse(COMPASS_CITE.exec(cited)?.[1]);
    if (!ref.success) return null;
    refs.push(ref.data);
  }
  return { direction: held[1] as CompassDirection, refs };
}

/** The run of slot lines starting here as one compass. A direction written
 *  twice ends the run: the second line opens a compass of its own rather than
 *  taking the first one's slot away. */
function readCompass(lines: readonly string[], at: number): Read {
  const slots = {} as Compass;
  for (const direction of COMPASS_DIRECTIONS) slots[direction] = [];
  const filled = new Set<CompassDirection>();
  let cursor = at;
  while (cursor < lines.length) {
    const held = compassLine(lines[cursor]);
    if (!held || filled.has(held.direction)) break;
    filled.add(held.direction);
    slots[held.direction] = held.refs;
    cursor++;
  }
  return { node: compassNode(slots), next: cursor };
}

function heldJson(line: string, tag: string): DocumentNode | null {
  const held = new RegExp(`^<!-- ${tag} (.*) -->$`).exec(line);
  if (!held) return null;
  try {
    const parsed = JSON.parse(held[1]) as DocumentNode;
    return parsed && typeof parsed.type === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function readFence(
  lines: readonly string[],
  at: number,
  bar: string,
  info: string,
): Read {
  const body: string[] = [];
  let cursor = at + 1;
  while (cursor < lines.length && lines[cursor] !== bar) {
    body.push(lines[cursor]);
    cursor++;
  }
  const next = cursor < lines.length ? cursor + 1 : cursor;
  const source = body.join("\n");
  if (info !== "" && opensDiagram(info)) {
    const attrs =
      source === "" ? { language: info } : { language: info, source };
    return { node: node("diagram", attrs), next };
  }
  const attrs = info === "" ? {} : { language: info };
  const content = source === "" ? [] : [{ type: "text", text: source }];
  return { node: node("codeBlock", attrs, content), next };
}

function readMathBlock(lines: readonly string[], at: number): Read {
  const body: string[] = [];
  let cursor = at + 1;
  while (cursor < lines.length && lines[cursor] !== "$$") {
    body.push(lines[cursor]);
    cursor++;
  }
  const tex = body.join("\n");
  return {
    node: node("mathBlock", tex === "" ? {} : { tex }),
    next: cursor < lines.length ? cursor + 1 : cursor,
  };
}

function readQuote(
  lines: readonly string[],
  at: number,
  sidecars: Sidecars,
): Read {
  const body: string[] = [];
  let cursor = at;
  while (cursor < lines.length && lines[cursor].startsWith(">")) {
    const line = lines[cursor];
    body.push(line.startsWith("> ") ? line.slice(2) : line.slice(1));
    cursor++;
  }
  return {
    node: node("blockquote", {}, readBlocks(body, sidecars)),
    next: cursor,
  };
}

interface Marker {
  kind: "bulletList" | "orderedList" | "taskList";
  width: number;
  checked?: boolean;
  start?: number;
}

function markerAt(line: string): Marker | null {
  const task = /^- \[([ x])\] /.exec(line);
  if (task) {
    return {
      kind: "taskList",
      width: task[0].length,
      checked: task[1] === "x",
    };
  }
  if (line.startsWith("- ")) return { kind: "bulletList", width: 2 };
  const ordered = /^(\d+)\. /.exec(line);
  if (ordered) {
    return {
      kind: "orderedList",
      width: ordered[0].length,
      start: Number(ordered[1]),
    };
  }
  return null;
}

function readList(
  lines: readonly string[],
  at: number,
  kind: Marker["kind"],
  sidecars: Sidecars,
): Read {
  const items: DocumentNode[] = [];
  let cursor = at;
  let start = 1;
  while (cursor < lines.length) {
    const marker = markerAt(lines[cursor]);
    if (!marker || marker.kind !== kind) break;
    if (items.length === 0 && marker.start !== undefined) start = marker.start;
    const body = [lines[cursor].slice(marker.width)];
    cursor++;
    const blanks: string[] = [];
    const indent = " ".repeat(marker.width);
    while (cursor < lines.length) {
      const line = lines[cursor];
      if (line === "") {
        blanks.push("");
        cursor++;
        continue;
      }
      if (!line.startsWith(indent)) break;
      body.push(...blanks, line.slice(marker.width));
      blanks.length = 0;
      cursor++;
    }
    items.push(
      node(
        kind === "taskList" ? "taskItem" : "listItem",
        marker.checked ? { checked: true } : {},
        readBlocks(body, sidecars),
      ),
    );
  }
  return {
    node: node(kind, kind === "orderedList" ? { start } : {}, items),
    next: cursor,
  };
}

function readImage(
  image: { alt: string; path: string },
  sidecars: Sidecars,
): DocumentNode {
  if (image.path.startsWith(`${INK_DIR}/`) && image.path.endsWith(".svg")) {
    const stem = image.path.slice(
      INK_DIR.length + 1,
      image.path.length - ".svg".length,
    );
    const attrs = sidecars.ink.get(stem);
    if (attrs) return { type: "ink", attrs };
    return {
      type: "ink",
      attrs:
        image.alt === ""
          ? { ...INK_WITHOUT_STROKES }
          : { ...INK_WITHOUT_STROKES, description: image.alt },
    };
  }
  const upload = uploadOf(image.path);
  const size = sidecars.pictures.get(upload) ?? {};
  return node("picture", {
    upload_id: upload,
    ...(image.alt === "" ? {} : { alt: image.alt }),
    ...(size.width === undefined ? {} : { width: size.width }),
    ...(size.height === undefined ? {} : { height: size.height }),
  });
}

function readParagraph(
  lines: readonly string[],
  at: number,
  sidecars: Sidecars,
): Read {
  const run: string[] = [];
  let cursor = at;
  for (;;) {
    const line = lines[cursor] ?? "";
    const broken = /\\*$/.exec(line)?.[0].length ?? 0;
    if (broken % 2 === 1) {
      run.push(line.slice(0, -1));
      cursor++;
      // A section that ends on a line break still ends on one.
      if (cursor >= lines.length) {
        run.push("");
        break;
      }
      continue;
    }
    run.push(line);
    cursor++;
    break;
  }
  const content: DocumentNode[] = [];
  for (const [index, line] of run.entries()) {
    if (index > 0) content.push({ type: "hardBreak" });
    content.push(...readInline(line, sidecars));
  }
  return { node: node("paragraph", {}, content), next: cursor };
}

/** Where a delimiter closes, stepping over escapes and code spans. */
function closingAt(
  value: string,
  from: number,
  delimiter: string,
): number | null {
  let at = from;
  while (at < value.length) {
    if (value[at] === "\\") {
      at += 2;
      continue;
    }
    if (value[at] === "`") {
      const bar = /^`+/.exec(value.slice(at))?.[0] ?? "";
      const closes = value.indexOf(bar, at + bar.length);
      at = closes === -1 ? at + bar.length : closes + bar.length;
      continue;
    }
    if (value.startsWith(delimiter, at)) return at;
    at++;
  }
  return null;
}

function imageLine(line: string): { alt: string; path: string } | null {
  if (!line.startsWith("![")) return null;
  const closes = closingAt(line, 2, "]");
  if (closes === null || line[closes + 1] !== "(") return null;
  if (!line.endsWith(")")) return null;
  const path = line.slice(closes + 2, line.length - 1);
  if (path.includes(")") || path.includes("(")) return null;
  return { alt: unescapeText(line.slice(2, closes)), path };
}

function readInline(
  value: string,
  sidecars: Sidecars,
  marks: DocumentMark[] = [],
): DocumentNode[] {
  const out: DocumentNode[] = [];
  let buffer = "";
  const flush = (): void => {
    if (buffer === "") return;
    const run: DocumentNode = { type: "text", text: buffer };
    if (marks.length > 0) run.marks = marks.map((mark) => ({ ...mark }));
    out.push(run);
    buffer = "";
  };
  const wrap = (inner: string, mark: DocumentMark): void => {
    flush();
    out.push(...readInline(inner, sidecars, [...marks, mark]));
  };

  let at = 0;
  while (at < value.length) {
    const rest = value.slice(at);

    if (value[at] === "\\") {
      buffer += value[at + 1] ?? "";
      at += 2;
      continue;
    }

    if (rest.startsWith(`<!-- ${INLINE_FALLBACK} `)) {
      const closes = rest.indexOf(" -->");
      const held =
        closes === -1
          ? null
          : heldJson(rest.slice(0, closes + 4), INLINE_FALLBACK);
      if (held) {
        flush();
        out.push(held);
        at += closes + 4;
        continue;
      }
    }

    if (value[at] === "`") {
      const bar = /^`+/.exec(rest)?.[0] as string;
      const closes = value.indexOf(bar, at + bar.length);
      if (closes !== -1) {
        let code = value.slice(at + bar.length, closes);
        if (code.startsWith(" ") && code.endsWith(" ") && code.trim() !== "") {
          code = code.slice(1, -1);
        }
        flush();
        out.push({
          type: "text",
          text: code,
          marks: [...marks, { type: "code" }].map((mark) => ({ ...mark })),
        });
        at = closes + bar.length;
        continue;
      }
    }

    const emphasis = rest.startsWith("**")
      ? (["**", "bold"] as const)
      : rest.startsWith("~~")
        ? (["~~", "strike"] as const)
        : rest.startsWith("_")
          ? (["_", "italic"] as const)
          : null;
    if (emphasis) {
      const closes = closingAt(value, at + emphasis[0].length, emphasis[0]);
      if (closes !== null) {
        wrap(value.slice(at + emphasis[0].length, closes), {
          type: emphasis[1],
        });
        at = closes + emphasis[0].length;
        continue;
      }
    }

    if (value[at] === "[") {
      const read = readLink(value, at, sidecars, marks);
      if (read) {
        flush();
        out.push(...read.nodes);
        at = read.next;
        continue;
      }
    }

    if (value[at] === ":") {
      const emoji = /^(::|:)([A-Za-z0-9_]{2,32})\1/.exec(rest);
      if (emoji) {
        flush();
        out.push(readEmoji(emoji[2], emoji[1] === "::", sidecars));
        at += emoji[0].length;
        continue;
      }
    }

    if (value[at] === "$") {
      const math = /^\$([^$\n]+)\$/.exec(rest);
      if (math) {
        flush();
        out.push({ type: "math", attrs: { tex: math[1] } });
        at += math[0].length;
        continue;
      }
    }

    buffer += value[at];
    at++;
  }
  flush();
  return out;
}

function readEmoji(
  name: string,
  sticker: boolean,
  sidecars: Sidecars,
): DocumentNode {
  const drawing = sidecars.emoji.get(name) ?? {};
  return node("emoji", {
    name,
    ...(sticker ? { sticker: true } : {}),
    ...(drawing.char === undefined ? {} : { char: drawing.char }),
    ...(drawing.src === undefined ? {} : { src: drawing.src }),
  });
}

function readLink(
  value: string,
  at: number,
  sidecars: Sidecars,
  marks: DocumentMark[],
): { nodes: DocumentNode[]; next: number } | null {
  const closes = closingAt(value, at + 1, "]");
  if (closes === null || value[closes + 1] !== "(") return null;
  const ends = value.indexOf(")", closes + 2);
  if (ends === -1) return null;
  const target = value.slice(closes + 2, ends);
  const label = value.slice(at + 1, closes);
  if (target.startsWith(REFERENCE_SCHEME)) {
    const cited = OwnedRefSchema.safeParse(
      target.slice(REFERENCE_SCHEME.length),
    );
    if (cited.success) {
      const plain = unescapeText(label);
      return {
        nodes: [
          node("reference", {
            note: cited.data,
            ...(plain === "" ? {} : { label: plain }),
          }),
        ],
        next: ends + 1,
      };
    }
  }
  if (!SAFE_HREF.test(target)) return null;
  return {
    nodes: readInline(label, sidecars, [
      ...marks,
      { type: "link", attrs: { href: target } },
    ]),
    next: ends + 1,
  };
}

/**
 * A section's markdown, with every note it names moved to another identity. A
 * reference's link, a compass slot, and the JSON that holds what markdown
 * cannot — an element this build has no writer for, a link somebody wrote to a
 * note — are the three places a ref appears in a section.
 */
export function rekeyMarkdown(text: string, from: string, to: string): string {
  return text
    .replaceAll(`](${REFERENCE_SCHEME}${from}/`, `](${REFERENCE_SCHEME}${to}/`)
    .replaceAll(`[[${from}/`, `[[${to}/`)
    .replace(/<!-- sloppy:(?:node|span) .*? -->/g, (held) =>
      held
        .replaceAll(`"${from}/`, `"${to}/`)
        .replaceAll(
          `"${REFERENCE_SCHEME}${from}/`,
          `"${REFERENCE_SCHEME}${to}/`,
        ),
    );
}
