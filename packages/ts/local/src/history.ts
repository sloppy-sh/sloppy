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
}

export interface CommitPage {
  /** Newest first. */
  commits: Commit[];
  /** Hand back to {@link History.log} for the rest. Absent is the end of the
   *  history rather than an empty page after it. */
  cursor?: string;
}

export interface Branch {
  name: string;
  /** The commit it is at. */
  head: string;
  /** Whether the folder is on it. */
  current: boolean;
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
}
