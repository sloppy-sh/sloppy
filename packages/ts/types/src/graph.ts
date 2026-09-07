// A graph: one person's notebook, and the context an address is read in.
//
// AI.md § "The Address Is the Protocol" states the scope; docs/ARCHITECTURE.md
// § "The addressing protocol" states the mechanism.

import { z } from "zod";
import { splitOwnedRef } from "./codecs.js";
import { type DidSyr, OwnedEntitySchema, type OwnedRef } from "./common.js";

/**
 * The local id of the graph everybody already has. Reserved rather than minted:
 * `ulid()` writes the current time into a ULID's first ten characters, so
 * nothing it draws can collide with this one.
 */
export const HOME_GRAPH_ULID = "00000000000000000000000000";

/** What the home graph is called until its owner calls it something else. */
export const HOME_GRAPH_TITLE = "My graph";

/**
 * A graph somebody keeps. The row is the NAME and nothing more — what a note
 * belongs to is the ref, and the home graph answers to its ref whether or not
 * a row for it has ever been written.
 */
export const GraphSchema = OwnedEntitySchema.extend({
  title: z.string().min(1).max(512),
});
export type Graph = z.infer<typeof GraphSchema>;

export class InvalidGraphRefError extends Error {
  constructor(ref: OwnedRef, reason: string) {
    super(`Invalid graph ${JSON.stringify(ref)}: ${reason}`);
    this.name = "InvalidGraphRefError";
  }
}

/**
 * The graph a person's notes are in before they make a second one. Its local id
 * is fixed, so this is a function of the identity rather than a lookup, and the
 * boot migration in `@sloppy/data`'s `schema.ts` can spell it in SurrealQL.
 */
export function homeGraphRef(owner: DidSyr): OwnedRef {
  return `${owner}/${HOME_GRAPH_ULID}`;
}

export function isHomeGraphRef(ref: OwnedRef): boolean {
  return splitOwnedRef(ref).localId === HOME_GRAPH_ULID;
}

/**
 * Which graph something is in. **Absent is the owner's home graph** — what a
 * note written before anybody could have a second graph says, and what a peer
 * serving that answer sends — so this is the one place the two are made one.
 */
export function graphRef(owner: DidSyr, graph: OwnedRef | undefined): OwnedRef {
  return graph ?? homeGraphRef(owner);
}

/** A graph belongs to one identity, and nobody files a note in somebody else's.
 *  Held over a value from anywhere, a peer's answer included. */
export function requireOwnGraph(
  owner: DidSyr,
  graph: OwnedRef | undefined,
): void {
  if (graph === undefined) return;
  const { did } = splitOwnedRef(graph);
  if (did !== owner) {
    throw new InvalidGraphRefError(graph, `${owner} does not own it`);
  }
}

/**
 * Name a graph. A graph with no name is a row nobody can tell from another in a
 * list, so the name is the whole request.
 */
export const CreateGraphRequestSchema = z.strictObject(
  {
    title: z
      .string()
      .min(1, "Name this graph.")
      .max(512, "That name is longer than a graph name can be. Trim it."),
  },
  { error: "Sloppy is out of date. Update it and try again." },
);
export type CreateGraphRequest = z.input<typeof CreateGraphRequestSchema>;

/** Rename one. Renaming the home graph is what first writes a row for it. */
export const UpdateGraphRequestSchema = z.object({
  title: z
    .string()
    .min(1, "Name this graph.")
    .max(512, "That name is longer than a graph name can be. Trim it."),
});
export type UpdateGraphRequest = z.input<typeof UpdateGraphRequestSchema>;
