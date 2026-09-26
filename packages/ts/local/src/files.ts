// The device's own files, as a shell reaches them —
// docs/ARCHITECTURE.md § "The two files that carry the platform seam".

import { insideVault } from "@sloppy/vault";
import type { Credential } from "./history.js";

/** What a folder is being asked for: somewhere to keep a graph, or the project
 *  whose notes it holds — docs/ARCHITECTURE.md § "A project's container". */
export type FolderAsked = "graph" | "project";

/**
 * File access, rooted at one folder. Every path is relative to {@link root} and
 * uses `/`, whatever the platform spells a separator as; a path that climbs out
 * of the root, names a drive or starts at one is refused here rather than by
 * each caller remembering to check.
 *
 * The absence of a file is `undefined` and never an error, because a graph that
 * has not been written yet is the ordinary first run.
 */
export interface Files {
  /** The folder the paths below are relative to, as the platform spells it.
   *  Empty is the shell's own idea of where it starts. */
  readonly root: string;
  /** `undefined` where there is no such file. */
  read(path: string): Promise<Uint8Array | undefined>;
  /** Writes the folders above it as well. */
  write(path: string, bytes: Uint8Array): Promise<void>;
  /** Every FILE under `path`, as paths from {@link root}, all the way down. A
   *  folder is not listed, and neither is a path outside the root. */
  list(path: string): Promise<string[]>;
  /** Nothing there is success: removing twice is one outcome, not an error. */
  remove(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** Already there is success. */
  mkdir(path: string): Promise<void>;
  /** The same shell's files, rooted somewhere else. `root` is absolute or is
   *  read as relative to this one. */
  at(root: string): Files;
  /** An address an `<img>`, `<video>` or `fetch` on the page can load the file
   *  at `path` from. */
  url(path: string): string;
  /** Ask a person for a folder. `asking` is what it is wanted for, which is
   *  what the ask says; absent is a folder to keep a graph in. `undefined` is
   *  somebody who chose none. */
  pickFolder(asking?: FolderAsked): Promise<string | undefined>;
  /**
   * Put a copy of a folder kept somewhere else at `into`, which must be empty
   * or not there yet: one holding anything at all is refused here, so a caller
   * has nothing of its own to check. A folder has no history until it is here,
   * so this is the one act of the kind that is not `History`'s.
   *
   * Absent is a platform that cannot bring one over, and the offer of it is
   * not put in front of anybody there. `credential` is read per call
   * ({@link Credential}) and never held.
   */
  clone?(url: string, into: string, credential?: Credential): Promise<void>;
  /** Where this app may keep what is nobody else's business — the identity's
   *  key, and what graph was open last. Absolute. */
  dataPath(): Promise<string>;
}

/** A path that would leave the root it was given. */
export class OutsideRootError extends Error {
  constructor(path: string) {
    super(`Not a path inside the folder: ${JSON.stringify(path)}`);
    this.name = "OutsideRootError";
  }
}

/** The empty path is the root itself, which `list` and `mkdir` take and the
 *  rest do not. */
export function checkPath(path: string, allowRoot = false): string {
  if (allowRoot && path === "") return path;
  if (!insideVault(path)) throw new OutsideRootError(path);
  return path;
}

export function joinPath(root: string, path: string): string {
  if (path === "") return root;
  if (root === "") return path;
  return `${root.replace(/\/+$/, "")}/${path}`;
}

/**
 * The same files, answering {@link Files.dataPath} with `data` and carrying
 * that across {@link Files.at} — which a shell's own files do not: `at` re-roots
 * the folder and leaves the data where the app keeps it.
 *
 * A store built over this holds its identity where `data` names rather than
 * alongside the ones the app writes under, which is what a write that must be
 * OFFERED to a person rather than landed on their notes needs —
 * docs/ARCHITECTURE.md § "Asking a tool to write the notes".
 */
export function keepingDataAt(files: Files, data: string): Files {
  const clone = files.clone?.bind(files);
  return {
    root: files.root,
    read: (path) => files.read(path),
    write: (path, bytes) => files.write(path, bytes),
    list: (path) => files.list(path),
    remove: (path) => files.remove(path),
    exists: (path) => files.exists(path),
    mkdir: (path) => files.mkdir(path),
    at: (root) => keepingDataAt(files.at(root), data),
    url: (path) => files.url(path),
    pickFolder: (asking) => files.pickFolder(asking),
    ...(clone === undefined ? {} : { clone }),
    dataPath: async () => data,
  };
}

/**
 * Files held in memory, for a test and for a surface that wants somewhere to
 * write that is nowhere. `at` shares the store, so two roots over one
 * `MemoryFiles` see each other's writes exactly as two folders on a disk do.
 */
export class MemoryFiles implements Files {
  readonly root: string;
  private readonly store: Map<string, Uint8Array>;
  private readonly folder?: string;
  private readonly data: string;

  constructor(
    options: {
      root?: string;
      /** What {@link dataPath} answers. */
      data?: string;
      /** What {@link pickFolder} answers; absent is somebody who chose none. */
      folder?: string;
      store?: Map<string, Uint8Array>;
    } = {},
  ) {
    this.root = options.root ?? "";
    this.store = options.store ?? new Map();
    this.folder = options.folder;
    this.data = options.data ?? "/data";
  }

  private full(path: string, allowRoot = false): string {
    return joinPath(this.root, checkPath(path, allowRoot));
  }

  async read(path: string): Promise<Uint8Array | undefined> {
    return this.store.get(this.full(path));
  }

  async write(path: string, bytes: Uint8Array): Promise<void> {
    this.store.set(this.full(path), bytes);
  }

  async list(path: string): Promise<string[]> {
    const under = joinPath(this.root, checkPath(path, true));
    const prefix = under === "" ? "" : `${under}/`;
    const found: string[] = [];
    for (const held of this.store.keys()) {
      if (!held.startsWith(prefix)) continue;
      const from = this.root === "" ? held : held.slice(this.root.length + 1);
      found.push(from);
    }
    return found;
  }

  async remove(path: string): Promise<void> {
    this.store.delete(this.full(path));
  }

  async exists(path: string): Promise<boolean> {
    return this.store.has(this.full(path));
  }

  // A folder with nothing in it is not a thing a map can hold, and nothing
  // downstream can tell the difference.
  async mkdir(path: string): Promise<void> {
    checkPath(path, true);
  }

  at(root: string): Files {
    return new MemoryFiles({
      root: root.startsWith("/") ? root : joinPath(this.root, root),
      data: this.data,
      folder: this.folder,
      store: this.store,
    });
  }

  url(path: string): string {
    const bytes = this.store.get(this.full(path)) ?? new Uint8Array();
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `data:application/octet-stream;base64,${btoa(binary)}`;
  }

  async pickFolder(): Promise<string | undefined> {
    return this.folder;
  }

  async dataPath(): Promise<string> {
    return this.data;
  }
}
