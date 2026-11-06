// Where `sloppy organise --agent` writes: a branch of the project's own
// history, checked out somewhere of its own, never the person's checkout —
// docs/ARCHITECTURE.md § "Tooling". The app's chat makes its draft the same
// way, in `draft.rs`.

import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { CONTAINER_DIR } from "@sloppy/local";
import { git, gitSays } from "./git.js";

/** What every branch this command makes is called before its date. */
export const ORGANISE_BRANCH = "sloppy/organise/";

/** Where each branch's base is written down: the version its notes began at,
 *  which a review reads it against. Never `refs/<branch>`, which git reads
 *  before `refs/heads/<branch>`, so `git merge <branch>` would take the base. */
const BASE_REF = "refs/sloppy/bases/organise/";

const BEGAN = "The notes as the draft found them";

export const NOTHING_KEPT =
  "Keep a version of this project first, with git commit. The draft starts from it.";

export const NOT_KEPT =
  "This project is not kept in git, so there is nowhere to put a draft. Start its history with git init and a first commit.";

/** A draft that could not be made or read, in words a person acts on. */
export class OrganiseRefused extends Error {}

export const NO_BRANCH =
  "There is no draft by that name. Name a branch sloppy organise --agent made.";

export interface Draft {
  branch: string;
  /** The checkout the draft is written in. */
  worktree: string;
  /** The project's root inside it. */
  project: string;
  /** The version the draft's notes began at. */
  base: string;
}

/** The repository `project` is kept in, and where the project sits in it. */
export async function keptIn(
  project: string,
): Promise<{ top: string; prefix: string }> {
  const top = await git(project, ["rev-parse", "--show-toplevel"]).then(
    (said) => said.trim(),
    () => undefined,
  );
  if (top === undefined) throw new OrganiseRefused(NOT_KEPT);
  const prefix = relative(await realpath(top), await realpath(project))
    .split("\\")
    .join("/");
  return { top, prefix };
}

function under(prefix: string, path: string): string {
  return prefix === "" ? path : `${prefix}/${path}`;
}

/**
 * A branch off the person's HEAD, checked out under the system's temporary
 * folder, whose notes begin as the project's notes stand now — kept and not
 * kept alike, and the identity the container writes under with them, since a
 * draft written under a fresh one would offer every change back as somebody
 * else's.
 */
export async function startDraft(project: string, on: Date): Promise<Draft> {
  const { top, prefix } = await keptIn(project);
  const head = await git(top, ["rev-parse", "--verify", "HEAD"]).then(
    (said) => said.trim(),
    () => undefined,
  );
  if (head === undefined) throw new OrganiseRefused(NOTHING_KEPT);
  const branch = await freeBranch(top, on);
  const worktree = await mkdtemp(join(tmpdir(), "sloppy-organise-"));
  const inside = join(worktree, prefix);
  try {
    await git(top, ["worktree", "add", "-q", "-b", branch, worktree, head]);
    await mirror(join(project, CONTAINER_DIR), join(inside, CONTAINER_DIR));
    const container = under(prefix, CONTAINER_DIR);
    const base = (await kept(worktree, container, BEGAN)) ?? head;
    await git(top, ["update-ref", baseRef(branch), base]);
    return { branch, worktree, project: inside, base };
  } catch (thrown) {
    // A draft half made is one nothing lists, so what was made of it goes.
    await letGo(top, worktree, branch).catch(() => undefined);
    throw thrown;
  }
}

/** What the agent wrote in the draft kept on its branch, and the checkout let
 *  go. A draft nothing was written in is let go of whole, and is absent. */
export async function finishDraft(
  draft: Draft,
  message: string,
): Promise<string | undefined> {
  const { top, prefix } = await keptIn(draft.project);
  const tip = await kept(draft.worktree, under(prefix, CONTAINER_DIR), message);
  const main = await mainOf(top);
  if (tip !== undefined) {
    await git(main, ["worktree", "remove", "--force", draft.worktree]);
    return draft.branch;
  }
  await letGo(main, draft.worktree, draft.branch);
  return undefined;
}

async function letGo(
  top: string,
  worktree: string,
  branch: string,
): Promise<void> {
  await git(top, ["worktree", "remove", "--force", worktree]).catch(() =>
    rm(worktree, { recursive: true, force: true }),
  );
  await git(top, ["worktree", "prune"]);
  await git(top, ["branch", "-D", branch]).catch(() => undefined);
  await git(top, ["update-ref", "-d", baseRef(branch)]).catch(() => undefined);
}

/** The person's own checkout, from inside any checkout of the repository. */
async function mainOf(top: string): Promise<string> {
  const common = (
    await git(top, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
  ).trim();
  return join(common, "..");
}

/** The version a draft's branch began at. */
export async function baseOf(top: string, branch: string): Promise<string> {
  const written = await git(top, ["rev-parse", "--verify", baseRef(branch)])
    .then((said) => said.trim())
    .catch(() => undefined);
  if (written !== undefined) return written;
  return (await git(top, ["merge-base", "HEAD", branch])).trim();
}

export function baseRef(branch: string): string {
  return `${BASE_REF}${branch.slice(ORGANISE_BRANCH.length)}`;
}

async function freeBranch(top: string, on: Date): Promise<string> {
  const day = on.toISOString().slice(0, 10);
  for (let count = 1; ; count++) {
    const name = `${ORGANISE_BRANCH}${day}${count === 1 ? "" : `-${count}`}`;
    if (
      !(await gitSays(top, [
        "show-ref",
        "--verify",
        "--quiet",
        `refs/heads/${name}`,
      ]))
    ) {
      return name;
    }
  }
}

/** Everything under `path` in the checkout kept as one version, and that
 *  version; absent where nothing there had changed. */
async function kept(
  worktree: string,
  path: string,
  message: string,
): Promise<string | undefined> {
  await git(worktree, ["add", "-A", "--", path]);
  if (await gitSays(worktree, ["diff", "--cached", "--quiet", "--", path])) {
    return undefined;
  }
  const who = (await gitSays(worktree, ["config", "user.email"]))
    ? []
    : ["-c", "user.name=sloppy", "-c", "user.email=sloppy@localhost"];
  await git(worktree, [...who, "commit", "-q", "--no-verify", "-m", message]);
  return (await git(worktree, ["rev-parse", "HEAD"])).trim();
}

/** `into` made byte for byte what `from` holds. A link is passed over: it is
 *  the one way a copy reaches outside the folder it copies. */
async function mirror(from: string, into: string): Promise<void> {
  await mkdir(into, { recursive: true });
  const held = new Set<string>();
  for (const entry of await readdir(from, { withFileTypes: true })) {
    held.add(entry.name);
    const at = join(from, entry.name);
    const to = join(into, entry.name);
    if (entry.isSymbolicLink()) continue;
    const there = await lstat(to).catch(() => undefined);
    if (entry.isDirectory()) {
      if (there && !there.isDirectory()) await rm(to, { force: true });
      await mirror(at, to);
    } else if (entry.isFile()) {
      if (there?.isDirectory()) await rm(to, { recursive: true, force: true });
      await copyFile(at, to);
    }
  }
  for (const entry of await readdir(into)) {
    if (!held.has(entry)) {
      await rm(join(into, entry), { recursive: true, force: true });
    }
  }
}
