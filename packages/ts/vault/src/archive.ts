// The vault as one file, and what one says about itself before it is opened —
// docs/ARCHITECTURE.md § "A graph on disk".

import { type DidSyr } from "@sloppy/types";
import { Unzip, UnzipInflate, unzipSync, zipSync } from "fflate";
import {
  GRAPH_FILE,
  MEDIA_DIR,
  noteAt,
  readGraphFile,
  type Vault,
  VaultFormatError,
} from "./layout.js";

/**
 * A vault as an archive. The stamp on every entry is fixed rather than the
 * clock, so exporting one graph twice gives the same bytes both times and a
 * person can tell that nothing changed.
 */
const STAMPED = new Date("1980-01-01T00:00:00Z");

export function pack(vault: Vault): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, bytes] of vault) entries[path] = bytes;
  return zipSync(entries, { mtime: STAMPED });
}

export function unpack(bytes: Uint8Array): Vault {
  let held: Record<string, Uint8Array>;
  try {
    held = unzipSync(bytes);
  } catch {
    throw new VaultFormatError("This file isn't a Sloppy graph.");
  }
  return new Map(Object.entries(held));
}

/** What an archive holds, as an import preview says it before anything is
 *  written. */
export interface ArchiveManifest {
  format: number;
  /** The graph's own ULID — what says a second import is a replace. */
  graph: string;
  name: string;
  owner: DidSyr;
  notes: number;
  media: number;
}

/**
 * What an archive holds, read out of its listing: only `graph.json` is
 * inflated, so this stays cheap on a graph of any size. Throws where the file
 * is not an archive this build can read.
 */
export function manifest(bytes: Uint8Array): ArchiveManifest {
  const reader = new Unzip();
  reader.register(UnzipInflate);
  let notes = 0;
  let media = 0;
  const graph: Uint8Array[] = [];
  let trouble: Error | null = null;
  reader.onfile = (file) => {
    if (noteAt(file.name)) notes++;
    else if (isMedia(file.name)) media++;
    if (file.name !== GRAPH_FILE) return;
    file.ondata = (failed, chunk) => {
      if (failed) trouble ??= failed;
      else if (chunk.length > 0) graph.push(chunk);
    };
    file.start();
  };
  try {
    reader.push(bytes, true);
  } catch {
    throw new VaultFormatError("This file isn't a Sloppy graph.");
  }
  if (trouble || graph.length === 0) {
    throw new VaultFormatError("This file isn't a Sloppy graph.");
  }
  const said = readGraphFile(join(graph));
  return { ...said, notes, media };
}

function isMedia(path: string): boolean {
  const prefix = `${MEDIA_DIR}/`;
  if (!path.startsWith(prefix)) return false;
  const rest = path.slice(prefix.length);
  return rest.length > 0 && !rest.includes("/");
}

function join(chunks: readonly Uint8Array[]): Uint8Array {
  const whole = new Uint8Array(
    chunks.reduce((total, chunk) => total + chunk.length, 0),
  );
  let at = 0;
  for (const chunk of chunks) {
    whole.set(chunk, at);
    at += chunk.length;
  }
  return whole;
}
