// What a vault holds that only a device writes: the bin, and the two registries
// a picture's name and an emoji's shortcode say nothing about.
// docs/ARCHITECTURE.md § "A graph on disk" carries the rest of the layout.

import { UlidSchema } from "@sloppy/types";
import {
  AMENDMENTS_DIR,
  GRAPH_FILE,
  MEDIA_DIR,
  NOTES_DIR,
  SLOPPY_DIR,
} from "@sloppy/vault";
import { carriedIdentityFile } from "./identity.js";

/** A deleted note's file, kept where a person can still put it back. */
export const BIN_DIR = `${SLOPPY_DIR}/bin`;
/** When each note in the bin went, and every address this graph has spent and
 *  will not assign again. */
export const BIN_FILE = `${SLOPPY_DIR}/bin.json`;
/** What a picture was called and what it is, which `media/<ulid>.<ext>` does
 *  not say. */
export const MEDIA_FILE = `${SLOPPY_DIR}/media.json`;
/** Whether each shortcode draws as an emoji or as a sticker. */
export const EMOJI_FILE = `${SLOPPY_DIR}/emoji.json`;

export function binPath(ulid: string): string {
  return `${BIN_DIR}/${ulid}.md`;
}

/** The note a path is the binned file of, or absent where it is not one. */
export function binAt(path: string): string | undefined {
  const prefix = `${BIN_DIR}/`;
  if (!path.startsWith(prefix) || !path.endsWith(".md")) return undefined;
  const ulid = path.slice(prefix.length, -".md".length);
  return UlidSchema.safeParse(ulid).success ? ulid : undefined;
}

/** Whether the vault wrote this file. A folder is somebody's own — a README, a
 *  history git keeps — so anything else in it is theirs and is neither carried
 *  out of the graph nor taken away with it. */
export function vaultOwned(path: string): boolean {
  if (carriedIdentityFile(path)) return false;
  return (
    path === GRAPH_FILE ||
    path.startsWith(`${NOTES_DIR}/`) ||
    path.startsWith(`${AMENDMENTS_DIR}/`) ||
    path.startsWith(`${MEDIA_DIR}/`) ||
    path.startsWith(`${SLOPPY_DIR}/`)
  );
}

/** What a copy of a graph carries out of it. The bin stays: a graph handed to
 *  somebody else is what was written, not what was thrown away. */
export function carriedOut(path: string): boolean {
  return vaultOwned(path) && path !== BIN_FILE && binAt(path) === undefined;
}

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** The opening bytes each picture kind this build writes is known by; WebP
 *  carries its own name eight bytes in, after a container's. */
const SIGNATURES: Record<string, readonly { at: number; bytes: number[] }[]> = {
  "image/png": [
    { at: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  ],
  "image/jpeg": [{ at: 0, bytes: [0xff, 0xd8, 0xff] }],
  "image/gif": [{ at: 0, bytes: [0x47, 0x49, 0x46, 0x38] }],
  "image/webp": [
    { at: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
    { at: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
  ],
};

/** The kind of picture `bytes` open as, among the kinds a vault writes, or
 *  absent where they open as none of them. */
export function pictureKindOf(bytes: Uint8Array): string | undefined {
  const opens = (kind: string): boolean => {
    const signature = SIGNATURES[kind] ?? [];
    return (
      signature.length > 0 &&
      signature.every(({ at, bytes: wanted }) =>
        wanted.every((byte, i) => bytes[at + i] === byte),
      )
    );
  };
  return Object.keys(EXTENSIONS).find(opens);
}

/** What a picture's file is called after the dot. */
export function extensionFor(mimeType: string): string {
  return EXTENSIONS[mimeType] ?? "bin";
}

/** The type a vault's file name says its bytes are, or absent where this build
 *  would not have written that file. */
export function mimeForExtension(extension: string): string | undefined {
  const lowered = extension.toLowerCase();
  const wanted = lowered === "jpeg" ? "jpg" : lowered;
  return Object.entries(EXTENSIONS).find(([, held]) => held === wanted)?.[0];
}

/** Without its leading dot, and empty where the name carries none. */
export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : "";
}
