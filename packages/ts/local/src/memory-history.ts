// A history held in memory, for a test and for a surface that wants one that
// is nowhere. `history.ts` declares every act and what its answer means.

import { nowIso, type Timestamp } from "@sloppy/types";
import type { Vault } from "@sloppy/vault";
import type { Files } from "./files.js";
import {
  type Branch,
  type Commit,
  type CommitGraphPage,
  type CommitPage,
  type ConflictSide,
  type Credential,
  type GitUser,
  type GraphCommit,
  type History,
  HistoryError,
  type HistoryStatus,
  type MergeResult,
  type Remote,
  type SigningConfig,
} from "./history.js";

type Tree = Map<string, Uint8Array>;

interface Held {
  id: string;
  message: string;
  author: string;
  at: Timestamp;
  parents: string[];
  signature?: Commit["signature"];
  tree: Tree;
  made: number;
}

/**
 * What {@link Held.made} counts, across every history in this process: two of
 * them never name one commit two things, and a commit that arrives from
 * somewhere else keeps its place among the ones here.
 *
 * What a commit springs from is always made before it, which is what makes
 * newest-first by this a picture nothing is drawn above its parent in.
 */
let made = 0;

/** What a merge left in two versions, and what each side had. Absent bytes are
 *  a side that took the file away. */
interface Unsettled {
  /** The commit the other branch was at. */
  from: string;
  conflicts: Map<string, { mine?: Uint8Array; theirs?: Uint8Array }>;
}

const DEFAULT_BRANCH = "main";

/** What a remote is called where nobody said and nothing is followed yet. */
const DEFAULT_REMOTE = "origin";

/** What the key this app keeps is called in a signature where nobody named
 *  one; a shell answers with the key's own fingerprint. */
const KEPT_KEY = "SHA256:kept";

/**
 * The places a {@link MemoryHistory} can reach, by the address a folder names
 * them by. Each one is somewhere commits are kept rather than somewhere
 * somebody is writing: a push moves the branch there and leaves that folder's
 * own files alone.
 */
export class MemoryRemotes {
  private readonly kept = new Map<string, MemoryHistory>();

  keep(url: string, history: MemoryHistory): void {
    this.kept.set(url, history);
  }

  reach(url: string): MemoryHistory | undefined {
    return this.kept.get(url);
  }
}

/**
 * A commit graph over {@link Files}: linear commits, branches, a merge that
 * fast-forwards or carries two parents, and a conflict where both sides changed
 * one path. It keeps everything the folder holds — the ignore rule is the
 * `.gitignore` the shell writes, and lives there alone.
 *
 * A remote is another one of these, kept in a {@link MemoryRemotes} both were
 * given, so a fetch and a push are a copy between two of them and every
 * surface that reaches one reaches a folder on a disk the same way.
 */
export class MemoryHistory implements History {
  private readonly commits = new Map<string, Held>();
  private readonly heads = new Map<string, string>();
  private readonly named = new Map<string, string>();
  /** Where a remote's branches were when this folder last heard, keyed as
   *  `origin/main`. */
  private readonly followed = new Map<string, string>();
  /** Which of {@link followed} each branch here is one of. */
  private readonly follows = new Map<string, string>();
  private readonly author: string;
  private readonly key: string;
  private readonly elsewhere?: MemoryRemotes;
  private user?: GitUser;
  private signs: SigningConfig = { kind: "none" };
  private on: string;
  private unsettled?: Unsettled;

  constructor(
    private readonly files: Files,
    options: {
      branch?: string;
      author?: string;
      /** The places this folder's remotes are, which the addresses given to
       *  {@link MemoryHistory.addRemote} are looked up in. */
      remotes?: MemoryRemotes;
      /** What a signature made here says it is by, where the key is the one
       *  this app keeps. */
      key?: string;
    } = {},
  ) {
    this.on = options.branch ?? DEFAULT_BRANCH;
    this.author = options.author ?? "Sloppy";
    this.key = options.key ?? KEPT_KEY;
    this.elsewhere = options.remotes;
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
      ...this.against(this.on),
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
    const here = [...this.heads].map(([name, head]) => {
      const measured = this.against(name);
      return {
        name,
        head,
        current: name === this.on,
        ...(measured.upstream === undefined ? {} : measured),
      };
    });
    const elsewhere = [...this.followed].map(([name, head]) => ({
      name,
      head,
      current: false,
      remote: remoteOf(name),
    }));
    return [...here, ...elsewhere];
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
    if (to === undefined) throw nothingCalled(name);
    if (this.unsettled) throw midMerge();
    if (name === this.on) return;
    if ((await this.status()).changed.length > 0) throw uncommitted();
    await this.lay(this.commits.get(to)?.tree ?? new Map());
    this.on = name;
  }

  async merge(name: string): Promise<MergeResult> {
    const theirs = this.heads.get(name);
    if (theirs === undefined) throw nothingCalled(name);
    if (this.unsettled) throw midMerge();
    if (name === this.on) {
      throw new HistoryError("That is the one you are working on.");
    }
    return this.take(theirs, name);
  }

  /** `called` is what the commit a settled merge makes says it took in. */
  private async take(theirs: string, called: string): Promise<MergeResult> {
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
      await this.commit(`Merge ${called}`);
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

  async graph(limit: number, cursor?: string): Promise<CommitGraphPage> {
    const held = this.leadingBack([
      ...this.heads.values(),
      ...this.followed.values(),
    ]);
    let from = 0;
    if (cursor !== undefined) {
      from = held.findIndex((one) => one.id === cursor);
      if (from < 0) throw notHere();
    }
    const page = held.slice(from, from + Math.max(0, limit));
    const next = held[from + page.length];
    return {
      commits: page.map((one) => this.drawn(one)),
      ...(next ? { cursor: next.id } : {}),
    };
  }

  async remotes(): Promise<Remote[]> {
    return [...this.named].map(([name, url]) => ({ name, url }));
  }

  async addRemote(name: string, url: string): Promise<void> {
    if (this.named.has(name)) throw alreadyCalled(name);
    this.named.set(name, url);
  }

  async renameRemote(name: string, to: string): Promise<void> {
    const url = this.named.get(name);
    if (url === undefined) throw nothingCalled(name);
    if (this.named.has(to)) throw alreadyCalled(to);
    this.named.delete(name);
    this.named.set(to, url);
    for (const [ref, head] of [...this.followed]) {
      if (remoteOf(ref) !== name) continue;
      this.followed.delete(ref);
      this.followed.set(under(to, ref), head);
    }
    for (const [branch, ref] of [...this.follows]) {
      if (remoteOf(ref) === name) this.follows.set(branch, under(to, ref));
    }
  }

  async setRemoteUrl(name: string, url: string): Promise<void> {
    if (!this.named.has(name)) throw nothingCalled(name);
    this.named.set(name, url);
  }

  async removeRemote(name: string): Promise<void> {
    if (!this.named.has(name)) throw nothingCalled(name);
    this.named.delete(name);
    for (const ref of [...this.followed.keys()]) {
      if (remoteOf(ref) === name) this.followed.delete(ref);
    }
    for (const [branch, ref] of [...this.follows]) {
      if (remoteOf(ref) === name) this.follows.delete(branch);
    }
  }

  async fetch(remote: string, credential?: Credential): Promise<void> {
    const there = this.reach(remote);
    for (const [branch, head] of there.heads) {
      this.copy(there.leadingBack([head]));
      this.followed.set(`${remote}/${branch}`, head);
    }
  }

  async pull(remote?: string, credential?: Credential): Promise<MergeResult> {
    const name = this.whichRemote(remote);
    await this.fetch(name, credential);
    const theirs = this.followed.get(`${name}/${this.on}`);
    if (theirs === undefined) return { merged: true };
    if (!this.head()) {
      await this.lay(this.commits.get(theirs)?.tree ?? new Map());
      this.heads.set(this.on, theirs);
      this.follows.set(this.on, `${name}/${this.on}`);
      return { merged: true };
    }
    if (this.unsettled) throw midMerge();
    return this.take(theirs, `${name}/${this.on}`);
  }

  async push(remote?: string, credential?: Credential): Promise<void> {
    const name = this.whichRemote(remote);
    const there = this.reach(name);
    const mine = this.head();
    if (!mine) {
      throw new HistoryError(
        "There is nothing here to keep somewhere else yet. Commit what is in this folder first.",
      );
    }
    const theirs = there.heads.get(this.on);
    if (theirs !== undefined && !this.holds(mine.id, theirs)) {
      throw new HistoryError("Pull first, then push again.");
    }
    there.copy(this.leadingBack([mine.id]));
    there.heads.set(this.on, mine.id);
    this.followed.set(`${name}/${this.on}`, mine.id);
    this.follows.set(this.on, `${name}/${this.on}`);
  }

  async deleteBranch(name: string): Promise<void> {
    if (name === this.on) {
      throw new HistoryError("That is the one you are working on.");
    }
    if (!this.heads.has(name)) throw nothingCalled(name);
    this.heads.delete(name);
    this.follows.delete(name);
  }

  async branchAt(name: string, commit: string): Promise<Branch> {
    if (this.heads.has(name)) throw alreadyCalled(name);
    if (!this.commits.has(commit)) throw notHere();
    this.heads.set(name, commit);
    return { name, head: commit, current: false };
  }

  async gitUser(): Promise<GitUser | undefined> {
    return this.user === undefined ? undefined : { ...this.user };
  }

  async setGitUser(user: GitUser): Promise<void> {
    this.user = { ...user };
  }

  async signing(): Promise<SigningConfig> {
    return this.signs;
  }

  async setSigning(config: SigningConfig): Promise<void> {
    this.signs = config;
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
    const at = made++;
    const signature = this.signed();
    const held: Held = {
      id: at.toString(16).padStart(40, "0"),
      message,
      author: this.user?.name ?? this.author,
      at: nowIso(),
      parents,
      ...(signature === undefined ? {} : { signature }),
      tree: new Map(tree),
      made: at,
    };
    this.commits.set(held.id, held);
    this.heads.set(this.on, held.id);
    return held;
  }

  /** What a commit made now says it is signed by, and nothing where the folder
   *  signs none. A key held here is one this device can vouch for. */
  private signed(): Commit["signature"] | undefined {
    if (this.signs.kind === "none") return undefined;
    const by =
      this.signs.kind === "ssh"
        ? this.signs.key.kind === "kept"
          ? this.key
          : this.signs.key.path
        : (this.signs.keyId ?? this.user?.email ?? this.author);
    return { by, verified: true };
  }

  /** Every commit `from` leads back through, newest first. */
  private reachable(from: string | undefined): Held[] {
    return this.leadingBack(from === undefined ? [] : [from]);
  }

  /** Every commit any of `from` leads back through, newest first — which is
   *  also an order nothing precedes what it springs from. */
  private leadingBack(from: Iterable<string>): Held[] {
    const held: Held[] = [];
    const seen = new Set<string>();
    const walk = [...from];
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

  /** How far a branch is from the one it follows. A branch that follows none
   *  is level with nothing rather than behind it. */
  private against(
    branch: string,
  ): Pick<HistoryStatus, "ahead" | "behind" | "upstream"> {
    const upstream = this.follows.get(branch);
    const theirs =
      upstream === undefined ? undefined : this.followed.get(upstream);
    const mine = this.heads.get(branch);
    return {
      ahead: this.count(mine, theirs),
      behind: this.count(theirs, mine),
      ...(upstream === undefined ? {} : { upstream }),
    };
  }

  /** How many commits `head` leads back through that `other` does not. */
  private count(head?: string, other?: string): number {
    if (head === undefined) return 0;
    if (other === undefined) return 0;
    const theirs = new Set(this.reachable(other).map((one) => one.id));
    return this.reachable(head).filter((one) => !theirs.has(one.id)).length;
  }

  /** Commits from somewhere else, kept as they are — an id names one commit
   *  wherever it is. */
  private copy(commits: readonly Held[]): void {
    for (const one of commits) {
      if (this.commits.has(one.id)) continue;
      this.commits.set(one.id, { ...one, tree: new Map(one.tree) });
    }
  }

  private drawn(held: Held): GraphCommit {
    const refs: string[] = [];
    for (const [name, head] of [...this.heads, ...this.followed]) {
      if (head === held.id) refs.push(name);
    }
    return { ...view(held), refs: refs.sort() };
  }

  /** Which remote an act with none named is with: the one the branch follows,
   *  else the only one there is, else the one a first push makes. */
  private whichRemote(remote?: string): string {
    const followed = this.follows.get(this.on);
    const only = this.named.size === 1 ? [...this.named.keys()][0] : undefined;
    const name =
      remote ??
      (followed === undefined ? undefined : remoteOf(followed)) ??
      only ??
      DEFAULT_REMOTE;
    if (!this.named.has(name)) throw nothingCalled(name);
    return name;
  }

  private reach(remote: string): MemoryHistory {
    const url = this.named.get(remote);
    if (url === undefined) throw nothingCalled(remote);
    const there = this.elsewhere?.reach(url);
    if (!there) {
      throw new HistoryError(
        "There is nothing at that address. Check it and try again.",
      );
    }
    return there;
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
    ...(held.signature === undefined ? {} : { signature: held.signature }),
  };
}

/** Which remote a branch kept somewhere else is one of: `origin` of
 *  `origin/main`. */
function remoteOf(ref: string): string {
  return ref.slice(0, ref.indexOf("/"));
}

/** The same branch under another remote's name: `origin/main` under `github`
 *  is `github/main`. */
function under(remote: string, ref: string): string {
  return `${remote}/${ref.slice(ref.indexOf("/") + 1)}`;
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

function nothingCalled(name: string): HistoryError {
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
