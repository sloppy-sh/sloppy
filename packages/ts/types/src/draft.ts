// A draft of the notes: where an agent's writing lands until somebody has read
// it — docs/ARCHITECTURE.md § "Asking a tool to write the notes".

import { z } from "zod";
import { UlidSchema } from "./common.js";

/**
 * What git calls a draft's branch, before the draft's own ulid. **It is never
 * shown**: a person reads "a draft", and the surfaces that say "branch" are the
 * history's own — AI.md § "User-Facing Copy Names the Outcome".
 *
 * One spelling, read by the shell that makes the branch and by
 * {@link draftIdIn}, which is how a draft standing from an earlier run of the
 * app is found again in the repository rather than in memory.
 */
export const DRAFT_BRANCH_PREFIX = "sloppy/draft/";

/** Longer than any folder a platform hands back, and short enough that a path
 *  arriving from anywhere else is refused before anything opens it. */
export const DRAFT_PATH_MAX = 4096;

/** Longer than a commit spelled in full by any history this app reads. */
export const DRAFT_COMMIT_MAX = 128;

/** {@link DRAFT_BRANCH_PREFIX} and a ulid, with room to spare. */
export const DRAFT_BRANCH_MAX = 128;

/** The branch a draft with that ulid is written on. */
export function draftBranch(id: string): string {
  return `${DRAFT_BRANCH_PREFIX}${id}`;
}

/** The draft a branch is one, and nothing for a branch that is a person's own
 *  — which is every branch this app did not make. */
export function draftIdIn(branch: string): string | undefined {
  if (!branch.startsWith(DRAFT_BRANCH_PREFIX)) return undefined;
  const id = UlidSchema.safeParse(branch.slice(DRAFT_BRANCH_PREFIX.length));
  return id.success ? id.data : undefined;
}

/**
 * A draft standing for one folder: a copy of it the chat writes into, kept
 * apart from the folder a person has open until they merge it or discard it.
 *
 * `root` and `vault` are where that copy is, as the platform spells a folder,
 * and are the shell's own business — nothing shows either. They are two paths
 * because a project keeps its notes in a container inside it: `root` is the
 * copy of the project, which is where the agent works and what a store serving
 * its acts is rooted at, and `vault` is the notes inside that copy, which is
 * what a history of the draft is opened at. They are the same folder for a
 * graph that is a folder of its own.
 *
 * `from` is the version the draft began at, which is the draft's OWN first
 * version: the notes as the folder had them when it was made, kept whether the
 * folder had kept them or not. A review reads the draft against the folder as
 * it stands now, and against this: a note THIS held that the draft does not is
 * one the draft put in the bin, which is the one thing two copies alone cannot
 * say — and measuring against the version the folder was last kept at instead
 * would read everything written since as the draft's own writing.
 *
 * **There is no "when".** A draft is read back out of the repository, which
 * records when a version was kept and not when a branch was made, and writing
 * one down beside it would be a second copy of a truth the repository already
 * owns. Nothing a person decides about a draft turns on its age.
 */
export const StandingDraftSchema = z.object({
  id: UlidSchema,
  root: z.string().min(1).max(DRAFT_PATH_MAX),
  vault: z.string().min(1).max(DRAFT_PATH_MAX),
  branch: z.string().min(1).max(DRAFT_BRANCH_MAX),
  from: z.string().min(1).max(DRAFT_COMMIT_MAX),
});
export type StandingDraft = z.infer<typeof StandingDraftSchema>;
