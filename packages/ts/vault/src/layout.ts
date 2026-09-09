// Where a graph's files sit and what each one is called —
// docs/ARCHITECTURE.md § "A graph on disk".

import { type DidSyr, DidSyrSchema, UlidSchema } from "@sloppy/types";

/** The layout a vault is written in. A reader refuses one it does not know. */
export const VAULT_FORMAT = 1;

export const GRAPH_FILE = "graph.json";
export const NOTES_DIR = "notes";
export const MEDIA_DIR = "media";
export const SLOPPY_DIR = ".sloppy";
export const INK_DIR = `${SLOPPY_DIR}/ink`;
export const PICTURES_FILE = `${SLOPPY_DIR}/pictures.json`;
export const EMOJI_DIR = `${SLOPPY_DIR}/emoji`;

/** What opens a section in a note's body, capturing the block's ULID. Nothing
 *  else in a note's markdown may read as this, or the note splits there. */
export const SECTION_OPENER = /^<!-- block ([0-9A-HJKMNP-TV-Z]{26}) -->$/;

/** What an archive is called and what it is made of. */
export const ARCHIVE_EXTENSION = ".sloppy";
export const ARCHIVE_MIME = "application/zip";

/**
 * A vault, in memory: every file it holds, keyed by its path from the vault
 * root and in the order it was written. A folder on disk and an archive are the
 * same value here, which is why one reader and one writer serve both.
 */
export type Vault = Map<string, Uint8Array>;

/** What `graph.json` says: which graph these notes are, and whose. */
export interface VaultGraph {
  format: number;
  /** The graph's own ULID — what says a second import is a replace and not a
   *  copy. */
  graph: string;
  name: string;
  owner: DidSyr;
}

/** A vault that cannot be read as one. `message` is fit to show somebody. */
export class VaultFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultFormatError";
  }
}

const utf8 = new TextEncoder();
const text = new TextDecoder("utf-8", { fatal: false });

export function encodeText(value: string): Uint8Array {
  return utf8.encode(value);
}

export function decodeText(bytes: Uint8Array): string {
  return text.decode(bytes);
}

/** Without its leading dot, and empty where the name carries none. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : "";
}

function stemOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function under(directory: string, path: string): string | undefined {
  const prefix = `${directory}/`;
  if (!path.startsWith(prefix)) return undefined;
  const rest = path.slice(prefix.length);
  return rest.includes("/") || rest.length === 0 ? undefined : rest;
}

/**
 * Whether a path names a file inside the vault. An archive is a file somebody
 * else made, so a path that climbs out of the folder or names one of its own is
 * refused before it is ever written down.
 */
export function insideVault(path: string): boolean {
  if (path === "" || path.startsWith("/") || path.includes("\\")) return false;
  if (/^[A-Za-z]:/.test(path)) return false;
  return path
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export function notePath(ulid: string): string {
  return `${NOTES_DIR}/${ulid}.md`;
}

/** The note a path is the file of, or absent where it is not one. */
export function noteAt(path: string): string | undefined {
  const name = under(NOTES_DIR, path);
  if (name === undefined || extensionOf(name) !== "md") return undefined;
  const ulid = stemOf(name);
  return UlidSchema.safeParse(ulid).success ? ulid : undefined;
}

/** `extension` is taken with or without its dot; absent leaves the file named
 *  by the upload alone, which is still what {@link uploadAt} reads back. */
export function mediaPath(uploadId: string, extension?: string): string {
  const suffix = extension ? `.${extension.replace(/^\./, "")}` : "";
  return `${MEDIA_DIR}/${uploadId}${suffix}`;
}

/** The upload a path holds the bytes of, or absent where it is not one. */
export function uploadAt(path: string): string | undefined {
  const name = under(MEDIA_DIR, path);
  return name === undefined ? undefined : stemOf(name);
}

/** What one drawing's two files are named after: the section it is in, and
 *  which drawing of that section it is. */
export function inkStem(block: string, nth: number): string {
  return `${block}-${nth}`;
}

export function inkPath(stem: string): string {
  return `${INK_DIR}/${stem}.ink.json`;
}

/** The drawing beside the strokes, for a reader that has never heard of us. */
export function inkImagePath(stem: string): string {
  return `${INK_DIR}/${stem}.svg`;
}

/** The drawing a path is the strokes or the picture of. */
export function inkAt(path: string): string | undefined {
  const name = under(INK_DIR, path);
  if (name === undefined) return undefined;
  if (name.endsWith(".ink.json")) return name.slice(0, -".ink.json".length);
  if (name.endsWith(".svg")) return name.slice(0, -".svg".length);
  return undefined;
}

export function emojiPath(shortcode: string, extension?: string): string {
  const suffix = extension ? `.${extension.replace(/^\./, "")}` : "";
  return `${EMOJI_DIR}/${shortcode}${suffix}`;
}

/** The shortcode a path is the picture of, or absent where it is not one. */
export function emojiAt(path: string): string | undefined {
  const name = under(EMOJI_DIR, path);
  return name === undefined ? undefined : stemOf(name);
}

export function graphFile(graph: VaultGraph): Uint8Array {
  return encodeText(`${JSON.stringify(graph, null, 2)}\n`);
}

/** What `graph.json` holds. Throws where the file is not one this build can
 *  read. */
export function readGraphFile(bytes: Uint8Array): VaultGraph {
  let held: unknown;
  try {
    held = JSON.parse(decodeText(bytes));
  } catch {
    throw new VaultFormatError("This file isn't a Sloppy graph.");
  }
  const said = held as Partial<VaultGraph> | null;
  if (!said || typeof said !== "object" || typeof said.name !== "string") {
    throw new VaultFormatError("This file isn't a Sloppy graph.");
  }
  if (typeof said.format === "number" && said.format > VAULT_FORMAT) {
    throw new VaultFormatError(
      "This graph was written by a newer Sloppy. Update and open it again.",
    );
  }
  const owner = DidSyrSchema.safeParse(said.owner);
  const graph = UlidSchema.safeParse(said.graph);
  if (said.format !== VAULT_FORMAT || !owner.success || !graph.success) {
    throw new VaultFormatError("This file isn't a Sloppy graph.");
  }
  return {
    format: said.format,
    graph: graph.data,
    name: said.name,
    owner: owner.data,
  };
}

/** A picture's pixel size, which an image link has no room for. */
export interface PictureSize {
  width?: number;
  height?: number;
}

export function picturesFile(
  sizes: ReadonlyMap<string, PictureSize>,
): Uint8Array {
  const held: Record<string, PictureSize> = {};
  for (const [upload, size] of sizes) held[upload] = size;
  return encodeText(`${JSON.stringify(held, null, 2)}\n`);
}

/** What `.sloppy/pictures.json` holds. An entry that is not a size is dropped:
 *  a hand-edited file costs the picture its dimensions, never the note. */
export function readPicturesFile(bytes: Uint8Array): Map<string, PictureSize> {
  const sizes = new Map<string, PictureSize>();
  let held: unknown;
  try {
    held = JSON.parse(decodeText(bytes));
  } catch {
    return sizes;
  }
  if (!held || typeof held !== "object") return sizes;
  for (const [upload, size] of Object.entries(held)) {
    if (!size || typeof size !== "object") continue;
    const { width, height } = size as PictureSize;
    const kept: PictureSize = {};
    if (typeof width === "number" && width > 0) kept.width = width;
    if (typeof height === "number" && height > 0) kept.height = height;
    sizes.set(upload, kept);
  }
  return sizes;
}

/** Every note the vault holds, in the order the vault lists them. */
export function noteUlids(vault: Vault): string[] {
  const notes: string[] = [];
  for (const path of vault.keys()) {
    const ulid = noteAt(path);
    if (ulid) notes.push(ulid);
  }
  return notes;
}
