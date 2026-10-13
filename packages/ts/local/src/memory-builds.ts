// A build's lines and checkouts held in memory, for a test and for a surface
// that wants ones that are nowhere. `BuildAccess` in `@sloppy/app-core`
// declares every act and what its answer means; this matches that shape
// structurally, because `@sloppy/local` sits under app-core.

import {
  type BuildStanding,
  buildLine,
  nowIso,
  type Ulid,
} from "@sloppy/types";
import { type Files, MemoryFiles } from "./files.js";
import { type Commit, HistoryError } from "./history.js";

/** What a build holds here: the line as a name, the checkouts as paths. */
interface Held {
  root: string;
  line: string;
  /** Whether the line's checkout has been given up; the line stays. */
  finished?: boolean;
  path: string;
  from: string;
  tasks: Map<string, string>;
}

const NOT_HERE = "That build is not here any more. Start it again.";

/** What a commit made here records as its author, since nothing in memory has
 *  a git config to read one out of. */
const AUTHOR = "Memory <memory@example.com>";

let made = 0;

/**
 * Builds held in memory. A merge reports no conflict unless
 * {@link MemoryBuilds.conflictOn} was told of one, and a commit answers with a
 * version unless {@link MemoryBuilds.nothingToKeep} was told the checkout holds
 * nothing.
 */
export class MemoryBuilds {
  private readonly held = new Map<Ulid, Held>();
  private readonly told = new Map<string, string[]>();
  private readonly empty = new Set<string>();

  /** `over` is what the checkouts are rooted in, so a test can hand the same
   *  files it reads the written notes back out of. */
  constructor(private readonly over: Files = new MemoryFiles()) {}

  async start(
    root: string,
    id: Ulid,
    name: string,
    from: string,
  ): Promise<{ line: string; path: string }> {
    const standing = this.held.get(id);
    if (standing) {
      standing.finished = false;
      return { line: standing.line, path: standing.path };
    }
    const build: Held = {
      root,
      line: buildLine(name),
      path: `${root}/builds/${id}/line`,
      from,
      tasks: new Map(),
    };
    this.held.set(id, build);
    return { line: build.line, path: build.path };
  }

  async taskCheckout(id: Ulid, task: string): Promise<string> {
    const build = this.build(id);
    const standing = build.tasks.get(task);
    if (standing !== undefined) return standing;
    const path = `${build.root}/builds/${id}/${task}`;
    build.tasks.set(task, path);
    return path;
  }

  files(path: string): Files {
    return this.over.at(path);
  }

  async commit(path: string, message: string): Promise<Commit | undefined> {
    if (!this.knows(path)) throw new HistoryError(NOT_HERE);
    if (this.empty.delete(path)) return undefined;
    made += 1;
    return {
      id: `${made}`.padStart(40, "0"),
      message,
      author: AUTHOR,
      at: nowIso(),
      parents: [],
    };
  }

  async mergeTask(
    id: Ulid,
    task: string,
  ): Promise<{ merged: boolean; conflicts: string[] }> {
    const build = this.build(id);
    if (!build.tasks.has(task)) throw new HistoryError(NOT_HERE);
    const conflicts = this.told.get(`${id}/${task}`) ?? [];
    return conflicts.length === 0
      ? { merged: true, conflicts: [] }
      : { merged: false, conflicts: [...conflicts] };
  }

  async finishTask(id: Ulid, task: string): Promise<void> {
    this.build(id).tasks.delete(task);
    this.told.delete(`${id}/${task}`);
  }

  async finish(id: Ulid): Promise<void> {
    const build = this.held.get(id);
    if (build === undefined) return;
    build.finished = true;
  }

  async discard(id: Ulid): Promise<void> {
    const build = this.held.get(id);
    if (build === undefined) return;
    for (const task of build.tasks.keys()) this.told.delete(`${id}/${task}`);
    this.held.delete(id);
  }

  async standing(root: string): Promise<BuildStanding[]> {
    return [...this.held.entries()]
      .filter(([, build]) => build.root === root)
      .map(([id, build]) => ({
        id,
        line: build.line,
        path: build.path,
        from: build.from,
        tasks: [...build.tasks.entries()].map(([task, path]) => ({
          task,
          path,
        })),
      }));
  }

  /** What the next merge of that task leaves in two versions. An EMPTY list is
   *  a merge that settles. */
  conflictOn(id: Ulid, task: string, paths: readonly string[]): void {
    this.told.set(`${id}/${task}`, [...paths]);
  }

  /** The next commit at that checkout answers with no version, as one holding
   *  nothing unkept does. */
  nothingToKeep(path: string): void {
    this.empty.add(path);
  }

  /** Whether the line's copy has been let go of, which `start` takes back. */
  gaveUpTheLine(id: Ulid): boolean {
    return this.held.get(id)?.finished === true;
  }

  private build(id: Ulid): Held {
    const build = this.held.get(id);
    if (build === undefined) throw new HistoryError(NOT_HERE);
    return build;
  }

  private knows(path: string): boolean {
    for (const build of this.held.values()) {
      if (build.path === path) return true;
      for (const task of build.tasks.values()) if (task === path) return true;
    }
    return false;
  }
}
