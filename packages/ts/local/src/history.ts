// The history of the folder a graph is in, as a shell reaches it —
// docs/ARCHITECTURE.md § "The vault's history".

import type { Timestamp } from "@sloppy/types";
import type { Vault } from "@sloppy/vault";

/** One commit, as a listing shows it. */
export interface Commit {
  /** What the history calls this commit, in full. */
  id: string;
  message: string;
  /** Whoever the commit records as its author, spelled as it records them. */
  author: string;
  at: Timestamp;
  /** Empty on the first commit of a history, and two on a merge. */
  parents: string[];
  /** Absent is a commit nobody signed, and every listing fills it in the same
   *  way, so absent never means "this one did not look". `by` names the key,
   *  and `verified` is whether this device can tell it is the key it claims —
   *  a key this app keeps, or one the folder vouches for. */
  signature?: { by: string; verified: boolean };
}

export interface CommitPage {
  /** Newest first. */
  commits: Commit[];
  /** Hand back to {@link History.log} for the rest. Absent is the end of the
   *  history rather than an empty page after it. */
  cursor?: string;
}

/** A commit as the picture of the whole history draws it. */
export interface GraphCommit extends Commit {
  /** Every branch at this commit: one kept here by its own name, one kept
   *  somewhere else as `<remote>/<name>` — `main`, `origin/main`. Empty is a
   *  commit no branch is at. */
  refs: string[];
}

export interface CommitGraphPage {
  /** Newest first, and never ahead of what it springs from. */
  commits: GraphCommit[];
  /** Hand back to {@link History.graph} for the rest. Absent is the end. */
  cursor?: string;
}

/** Somewhere else this folder is kept. */
export interface Remote {
  name: string;
  url: string;
}

/** Who the commits made here are by. */
export interface GitUser {
  name: string;
  email: string;
}

/** Which ssh key: the one this app made and keeps in its own private data, in
 *  `signing.key` beside `git.json`, or one already on the device that a person
 *  named. */
export type SshKey = { kind: "kept" } | { kind: "file"; path: string };

/**
 * What a host wants before it hands a folder over or takes one in. A shell is
 * never given one to keep: it is read from this device's own private data
 * ({@link readCredentials}) and passed per call, so nothing but the act that
 * needs it ever holds it.
 */
export type Credential =
  | { kind: "token"; username?: string; token: string }
  | { kind: "ssh"; key: SshKey };

/** How the commits made here are signed. `program` and `keyId` absent are a
 *  person leaving both to whatever their own git config says. */
export type SigningConfig =
  | { kind: "none" }
  | {
      kind: "ssh";
      key: SshKey;
      /** The public half of that key, as the one line a host takes it in —
       *  what {@link History.signing} answers about a key this app keeps, so
       *  somebody can paste it where their host wants it. Absent is a device
       *  with no key to show yet, and nothing reads it on
       *  {@link History.setSigning}. */
      publicKey?: string;
    }
  | { kind: "openpgp"; program?: string; keyId?: string };

export interface Branch {
  /** A branch here by its own name, one kept somewhere else as
   *  `<remote>/<name>` — `main`, `origin/main`. */
  name: string;
  /** The commit it is at. */
  head: string;
  /** Whether the folder is on it. */
  current: boolean;
  /** Where a branch this folder only knows about is kept. Absent is a branch
   *  that is here, which is the only kind anything may switch to, merge or
   *  delete. */
  remote?: string;
  /** The branch this one follows, spelled `origin/main`. Absent is a branch
   *  that follows none, and every branch kept somewhere else. */
  upstream?: string;
  /** How many commits this branch has that the one it follows does not, and
   *  how many that one has that it does not. Both absent where it follows
   *  none — which is not the same as being level with something. */
  ahead?: number;
  behind?: number;
}

export interface HistoryStatus {
  /** What is not as the commit the folder is on has it, as paths from the
   *  vault root. A file taken away is one of these. */
  changed: string[];
  /** What the history is not keeping. */
  untracked: string[];
  /** The branch the folder is on. Absent is a folder left on a commit of its
   *  own, which nothing here does and somebody's own git may have. */
  branch?: string;
  /** How many commits this branch has that the one it tracks does not. `0`
   *  where nobody set one up, which is every folder this app made itself. */
  ahead: number;
  /** How many the one it tracks has that this branch does not. `0` where
   *  nobody set one up, and what a pull takes in where it is not. */
  behind: number;
  /** The branch this one follows, spelled `origin/main`. Absent is a branch
   *  that follows none, which is every folder nothing has been pushed from. */
  upstream?: string;
}

/** Which version of a file a conflict is settled with. */
export type ConflictSide = "mine" | "theirs";

export type MergeResult =
  | { merged: true }
  | { merged: false; conflicts: string[] };

/** An act the history would not take. `message` is fit to show somebody. */
export class HistoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HistoryError";
  }
}

/**
 * What a person can do with the states their graph has been in. The shell
 * implements it over the folder the graph is in; {@link MemoryHistory} is the
 * same surface over files held in memory.
 *
 * Every act that cannot be taken throws {@link HistoryError}, whose message is
 * what a person is told. Every path is from the vault root and uses `/`,
 * exactly as `Files` spells one.
 */
export interface History {
  status(): Promise<HistoryStatus>;
  /** From the commit the folder is on, newest first. `cursor` continues a
   *  listing where the last page ended. */
  log(limit: number, cursor?: string): Promise<CommitPage>;
  /**
   * What is in the folder now, as one commit. `undefined` is a folder holding
   * nothing that is not already committed, which is not a failure.
   *
   * A commit made while a merge is still unsettled carries both parents, so
   * this is what finishes one — and it is refused while any file is still in
   * two versions.
   */
  commit(message: string): Promise<Commit | undefined>;
  /** Every branch this folder knows: the ones kept here, and the ones it last
   *  heard a remote had. `Branch.remote` is what tells the two apart. */
  branches(): Promise<Branch[]>;
  /** A branch at the commit the folder is on. The folder stays where it is;
   *  {@link History.switch} is what moves it. */
  branch(name: string): Promise<Branch>;
  /** The folder becomes that branch's. Refused where it holds changes that
   *  would be lost. */
  switch(name: string): Promise<void>;
  /**
   * Take that branch's commits into the one the folder is on. A merge that
   * settles is committed as it goes, so `{ merged: true }` is a merge that is
   * done.
   *
   * `conflicts` is every path both sides changed differently. Each one is left
   * in the folder as this branch has it — never as two versions in one file —
   * until {@link History.resolve} settles it, and the merge is finished by
   * committing.
   */
  merge(name: string): Promise<MergeResult>;
  /** One conflicted path, taken whole from one side. */
  resolve(path: string, side: ConflictSide): Promise<void>;
  /** The whole vault as that commit has it. */
  readAt(commit: string): Promise<Vault>;
  /** The commit the folder is on; `undefined` before the first one is made. */
  currentCommit(): Promise<string | undefined>;
  /**
   * Every commit here, across every branch, newest first and never ahead of
   * what it springs from — {@link History.log} is the one line the folder is
   * on, this is the picture. Paged exactly as `log` is.
   *
   * Absent, like every optional act below, is a platform whose histories
   * cannot do this at all; a shell that defines one of them defines all of
   * them, and a surface that finds them missing offers none of it.
   */
  graph?(limit: number, cursor?: string): Promise<CommitGraphPage>;
  /**
   * Which of `paths` a commit made after `commit` has touched, on the branch
   * the folder is on: a subset of what it was given, in the order it was given
   * them, and empty where none of them has moved. A path naming a folder is
   * everything under it, as a history spells one.
   *
   * **These paths alone are not from the vault root.** They are from the root
   * of what the history is keeping — the vault root for a folder that is its
   * own repository, and the PROJECT root for a vault kept inside one, which is
   * where an anchor into code is spelled from. docs/ARCHITECTURE.md § "The
   * vault's history" carries the prefix rule the shell holds.
   */
  changedSince?(commit: string, paths: readonly string[]): Promise<string[]>;
  remotes?(): Promise<Remote[]>;
  /** Refused where something here is already called that. */
  addRemote?(name: string, url: string): Promise<void>;
  /** The branches this folder last heard that remote had, and any branch
   *  following one of them, go with the name. */
  renameRemote?(name: string, to: string): Promise<void>;
  setRemoteUrl?(name: string, url: string): Promise<void>;
  removeRemote?(name: string): Promise<void>;
  /** Take what that remote has without touching what is in the folder. */
  fetch?(remote: string, credential?: Credential): Promise<void>;
  /**
   * Fetch, then merge what the branch follows into it — the same merge, with
   * the same conflicts settled the same way. `{ merged: true }` is also what
   * comes back where there was nothing to take.
   *
   * `remote` absent is whichever one the branch follows. A branch with nothing
   * here to merge into is taken whole and follows what it was taken from from
   * then on, which is what a folder that arrived as a copy is.
   */
  pull?(remote?: string, credential?: Credential): Promise<MergeResult>;
  /**
   * Put this branch's commits where the remote keeps them, and follow it from
   * now on where the branch followed nothing.
   *
   * Refused where the remote has commits this branch does not, so nobody's
   * writing is written over.
   */
  push?(remote?: string, credential?: Credential): Promise<void>;
  /** Refused for the branch the folder is on. What was committed on it is
   *  still there for as long as something else leads back through it. */
  deleteBranch?(name: string): Promise<void>;
  /** A branch at a commit somewhere back in the history, rather than at the
   *  one the folder is on. The folder stays where it is. */
  branchAt?(name: string, commit: string): Promise<Branch>;
  /** Who the commits made here are by. `undefined` is a folder where nobody
   *  has said, here or in their own git config, and the graph's owner stands
   *  in. */
  gitUser?(): Promise<GitUser | undefined>;
  /** For this folder alone, which is what leaves every other folder's alone. */
  setGitUser?(user: GitUser): Promise<void>;
  signing?(): Promise<SigningConfig>;
  setSigning?(config: SigningConfig): Promise<void>;
}
