// The disk as `Files` — docs/ARCHITECTURE.md § "Tooling and the review". The
// same interface the shells implement, so every reader and writer in
// @sloppy/local and @sloppy/vault runs here unchanged.

import type { Dirent } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { CONTAINER_DIR, checkPath, type Files } from "@sloppy/local";

export interface NodeFilesOptions {
  root: string;
  /** What {@link NodeFiles.dataPath} answers. Absent is `.sloppy` inside the
   *  root, which is a container's own private data one level down. */
  data?: string;
}

function code(thrown: unknown): string | undefined {
  return thrown instanceof Error && "code" in thrown
    ? String((thrown as { code?: unknown }).code)
    : undefined;
}

/**
 * Files under one folder on this disk. Every path is from {@link root} and
 * spelled with `/`, whatever the platform's separator is; a path that would
 * leave the root is refused before it reaches the filesystem.
 */
export class NodeFiles implements Files {
  readonly root: string;
  private readonly data?: string;

  constructor(options: NodeFilesOptions) {
    this.root = resolve(options.root);
    if (options.data !== undefined) this.data = resolve(options.data);
  }

  private full(path: string, allowRoot = false): string {
    return join(this.root, ...checkPath(path, allowRoot).split("/"));
  }

  async read(path: string): Promise<Uint8Array | undefined> {
    try {
      return new Uint8Array(await readFile(this.full(path)));
    } catch (thrown) {
      const said = code(thrown);
      if (said === "ENOENT" || said === "EISDIR" || said === "ENOTDIR") {
        return undefined;
      }
      throw thrown;
    }
  }

  async write(path: string, bytes: Uint8Array): Promise<void> {
    const at = this.full(path);
    await mkdir(dirname(at), { recursive: true });
    await writeFile(at, bytes);
  }

  async list(path: string): Promise<string[]> {
    const under = this.full(path, true);
    let held: Dirent<string>[];
    try {
      held = await readdir(under, { withFileTypes: true, recursive: true });
    } catch (thrown) {
      const said = code(thrown);
      if (said === "ENOENT" || said === "ENOTDIR") return [];
      throw thrown;
    }
    const found: string[] = [];
    for (const entry of held) {
      if (!entry.isFile()) continue;
      const at = join(entry.parentPath, entry.name);
      found.push(relative(this.root, at).split(sep).join("/"));
    }
    return found;
  }

  /**
   * The folders directly inside `path`, without walking what is under them —
   * which is what reading a project's shape needs and what {@link list} must
   * not be asked for: a repository's `node_modules` is not a thing to walk.
   */
  async folders(path: string): Promise<string[]> {
    let held: Dirent<string>[];
    try {
      held = await readdir(this.full(path, true), { withFileTypes: true });
    } catch (thrown) {
      const said = code(thrown);
      if (said === "ENOENT" || said === "ENOTDIR") return [];
      throw thrown;
    }
    return held
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  }

  async remove(path: string): Promise<void> {
    await rm(this.full(path), { recursive: true, force: true });
  }

  async exists(path: string): Promise<boolean> {
    try {
      await stat(this.full(path));
      return true;
    } catch {
      return false;
    }
  }

  async mkdir(path: string): Promise<void> {
    await mkdir(this.full(path, true), { recursive: true });
  }

  at(root: string): Files {
    return new NodeFiles({
      root: isAbsolute(root) ? root : join(this.root, ...root.split("/")),
      // A data path nobody named follows the new root, so the container inside
      // a project keeps its own rather than the project's.
      ...(this.data === undefined ? {} : { data: this.data }),
    });
  }

  url(path: string): string {
    return pathToFileURL(this.full(path)).href;
  }

  /** Nobody is there to ask: a command is given the folder it works in. */
  async pickFolder(): Promise<string | undefined> {
    return undefined;
  }

  async dataPath(): Promise<string> {
    return this.data ?? join(this.root, CONTAINER_DIR);
  }
}
