// A history held in memory, for a test and for a surface that wants one that
// is nowhere. `history.ts` declares every act and what its answer means.

import { nowIso, type Timestamp } from "@sloppy/types";
import type { Vault } from "@sloppy/vault";
import type { Files } from "./files.js";
import {
  type Branch,
  type Commit,
  type CommitPage,
  type ConflictSide,
  type History,
  HistoryError,
  type HistoryStatus,
  type MergeResult,
} from "./history.js";

type Tree = Map<string, Uint8Array>;

interface Held {
  id: string;
  message: string;
  author: string;
  at: Timestamp;
  parents: string[];
  tree: Tree;
  /** Where it sits in the order the commits were made, which is the order a
   *  listing reads in. */
  made: number;
}

/** What a merge left in two versions, and what each side had. Absent bytes are
 *  a side that took the file away. */
interface Unsettled {
  /** The commit the other branch was at. */
  from: string;
  conflicts: Map<string, { mine?: Uint8Array; theirs?: Uint8Array }>;
}

const DEFAULT_BRANCH = "main";

/**
 * A commit graph over {@link Files}: linear commits, branches, a merge that
 * fast-forwards or carries two parents, and a conflict where both sides changed
 * one path. It keeps everything the folder holds — the ignore rule is the
 * `.gitignore` the shell writes, and lives there alone.
 *
 * There is nothing for it to track, so {@link HistoryStatus.ahead} is always
 * `0`.
 */
export class MemoryHistory implements History {
  private readonly commits = new Map<string, Held>();
  private readonly heads = new Map<string, string>();
  private readonly author: string;
  private on: string;
  private unsettled?: Unsettled;
  private made = 0;

  constructor(
    private readonly files: Files,
    options: { branch?: string; author?: string } = {},
  ) {
    this.on = options.branch ?? DEFAULT_BRANCH;
    this.author = options.author ?? "Sloppy";
  }

  async status(): Promise<HistoryStatus> {
    const tree = this.head()?.tree ?? new Map();
    const now = await this.folder();
    const changed: string[] = [];
    const untracked: string[] = [];
    for (const [path, bytes] of now) {
      const was = tree.get(path);
      if (was === undefined) untracked.push(path);
      else if (!sameBytes(was, bytes)) changed.push(path);
    }
    for (const path of tree.keys()) if (!now.has(path)) changed.push(path);
    return {
      changed: changed.sort(),
      untracked: untracked.sort(),
      branch: this.on,
      ahead: 0,
    };
  }

  async log(limit: number, cursor?: string): Promise<CommitPage> {
    const held = this.reachable(this.heads.get(this.on));
    let from = 0;
    if (cursor !== undefined) {
      from = held.findIndex((one) => one.id === cursor);
      if (from < 0) throw notHere();
    }
    const page = held.slice(from, from + Math.max(0, limit));
    const next = held[from + page.length];
    return {
      commits: page.map(view),
      ...(next ? { cursor: next.id } : {}),
    };
  }

  async commit(message: string): Promise<Commit | undefined> {
    if (this.unsettled && this.unsettled.conflicts.size > 0) {
      throw new HistoryError(
        "Some of these are still here in two versions. Choose one of each and try again.",
      );
    }
    const at = this.head();
    const now = await this.folder();
    if (!this.unsettled && at && sameTree(at.tree, now)) return undefined;
    const held = this.record(message, now, [
      ...(at ? [at.id] : []),
      ...(this.unsettled ? [this.unsettled.from] : []),
    ]);
    this.unsettled = undefined;
    return view(held);
  }

  async branches(): Promise<Branch[]> {
    return [...this.heads].map(([name, head]) => ({
      name,
      head,
      current: name === this.on,
    }));
  }

  async branch(name: string): Promise<Branch> {
    if (this.heads.has(name)) throw alreadyCalled(name);
    const at = this.head();
    if (!at) {
      throw new HistoryError(
        "There is nothing here to branch off yet. Commit what is in this folder first.",
      );
    }
    this.heads.set(name, at.id);
    return { name, head: at.id, current: false };
  }

  async switch(name: string): Promise<void> {
    const to = this.heads.get(name);
    if (to === undefined) throw noBranch(name);
    if (this.unsettled) throw midMerge();
    if (name === this.on) return;
    if ((await this.status()).changed.length > 0) throw uncommitted();
    await this.lay(this.commits.get(to)?.tree ?? new Map());
    this.on = name;
  }

  async merge(name: string): Promise<MergeResult> {
    const theirs = this.heads.get(name);
    if (theirs === undefined) throw noBranch(name);
    if (this.unsettled) throw midMerge();
    if (name === this.on) {
      throw new HistoryError("That is the one you are working on.");
    }
    const mine = this.head();
    if (!mine) {
      throw new HistoryError(
        "There is nothing here to merge into yet. Commit what is in this folder first.",
      );
    }
    if ((await this.status()).changed.length > 0) throw uncommitted();
    if (this.holds(mine.id, theirs)) return { merged: true };
    if (this.holds(theirs, mine.id)) {
      const to = this.commits.get(theirs);
      if (to) await this.lay(to.tree);
      this.heads.set(this.on, theirs);
      return { merged: true };
    }
    const base = this.commits.get(this.base(mine.id, theirs) ?? "")?.tree;
    const other = this.commits.get(theirs)?.tree ?? new Map();
    const settled: Tree = new Map();
    const conflicts = new Map<
      string,
      { mine?: Uint8Array; theirs?: Uint8Array }
    >();
    for (const path of [
      ...new Set([
        ...(base?.keys() ?? []),
        ...mine.tree.keys(),
        ...other.keys(),
      ]),
    ].sort()) {
      const was = base?.get(path);
      const ours = mine.tree.get(path);
      const yours = other.get(path);
      if (sameBytes(ours, yours)) {
        if (ours) settled.set(path, ours);
      } else if (sameBytes(was, ours)) {
        if (yours) settled.set(path, yours);
      } else if (sameBytes(was, yours)) {
        if (ours) settled.set(path, ours);
      } else {
        conflicts.set(path, {
          ...(ours ? { mine: ours } : {}),
          ...(yours ? { theirs: yours } : {}),
        });
        if (ours) settled.set(path, ours);
      }
    }
    await this.lay(settled);
    this.unsettled = { from: theirs, conflicts };
    if (conflicts.size === 0) {
      await this.commit(`Merge ${name}`);
      return { merged: true };
    }
    return { merged: false, conflicts: [...conflicts.keys()] };
  }

  async resolve(path: string, side: ConflictSide): Promise<void> {
    const held = this.unsettled?.conflicts.get(path);
    if (!held || !this.unsettled) {
      throw new HistoryError("That is not one of the ones in two versions.");
    }
    const bytes = side === "mine" ? held.mine : held.theirs;
    if (bytes === undefined) await this.files.remove(path);
    else await this.files.write(path, bytes);
    this.unsettled.conflicts.delete(path);
  }

  async readAt(commit: string): Promise<Vault> {
    const held = this.commits.get(commit);
    if (!held) throw notHere();
    return new Map(held.tree);
  }

  async currentCommit(): Promise<string | undefined> {
    return this.heads.get(this.on);
  }

  private head(): Held | undefined {
    const at = this.heads.get(this.on);
    return at === undefined ? undefined : this.commits.get(at);
  }

  private async folder(): Promise<Tree> {
    const tree: Tree = new Map();
    for (const path of await this.files.list("")) {
      const bytes = await this.files.read(path);
      if (bytes) tree.set(path, bytes);
    }
    return tree;
  }

  /** The folder becomes `tree`. What the history is not keeping is left where
   *  it is, the way a folder is somebody's own. */
  private async lay(tree: Tree): Promise<void> {
    const tracked = this.head()?.tree ?? new Map();
    for (const path of await this.files.list("")) {
      if (tracked.has(path) && !tree.has(path)) await this.files.remove(path);
    }
    for (const [path, bytes] of tree) await this.files.write(path, bytes);
  }

  private record(message: string, tree: Tree, parents: string[]): Held {
    const made = this.made++;
    const held: Held = {
      id: made.toString(16).padStart(40, "0"),
      message,
      author: this.author,
      at: nowIso(),
      parents,
      tree: new Map(tree),
      made,
    };
    this.commits.set(held.id, held);
    this.heads.set(this.on, held.id);
    return held;
  }

  /** Every commit `from` leads back through, newest first. */
  private reachable(from: string | undefined): Held[] {
    const held: Held[] = [];
    const seen = new Set<string>();
    const walk = from === undefined ? [] : [from];
    while (walk.length > 0) {
      const id = walk.pop();
      if (id === undefined || seen.has(id)) continue;
      seen.add(id);
      const one = this.commits.get(id);
      if (!one) continue;
      held.push(one);
      walk.push(...one.parents);
    }
    return held.sort((a, b) => b.made - a.made);
  }

  /** Whether `commit` is already in what `head` leads back through. */
  private holds(head: string, commit: string): boolean {
    return this.reachable(head).some((one) => one.id === commit);
  }

  /** The newest commit both lead back through. */
  private base(a: string, b: string): string | undefined {
    const mine = new Set(this.reachable(a).map((one) => one.id));
    return this.reachable(b).find((one) => mine.has(one.id))?.id;
  }
}

function view(held: Held): Commit {
  return {
    id: held.id,
    message: held.message,
    author: held.author,
    at: held.at,
    parents: [...held.parents],
  };
}

function sameBytes(a: Uint8Array | undefined, b: Uint8Array | undefined) {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && a.every((byte, at) => byte === b[at]);
}

function sameTree(a: Tree, b: Tree): boolean {
  if (a.size !== b.size) return false;
  for (const [path, bytes] of a) {
    if (!sameBytes(bytes, b.get(path))) return false;
  }
  return true;
}

function notHere(): HistoryError {
  return new HistoryError(
    "That is not one of the states this graph has been in.",
  );
}

function noBranch(name: string): HistoryError {
  return new HistoryError(`There is nothing here called ${name}.`);
}

function alreadyCalled(name: string): HistoryError {
  return new HistoryError(`There is already one called ${name}.`);
}

function midMerge(): HistoryError {
  return new HistoryError("Finish the merge you are in the middle of first.");
}

function uncommitted(): HistoryError {
  return new HistoryError(
    "Commit what you have written here first, or put it back the way it was.",
  );
}
