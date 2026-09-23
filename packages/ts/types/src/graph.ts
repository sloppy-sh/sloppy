// A graph: one person's notebook, and the context an address is read in.
//
// AI.md § "The Genealogy Is the Protocol" states the scope; docs/ARCHITECTURE.md
// § "The genealogy and the address" states the mechanism.

import { z } from "zod";
import { splitOwnedRef } from "./codecs.js";
import { type DidSyr, OwnedEntitySchema, type OwnedRef } from "./common.js";

/**
 * The local id a graph nobody named is read under: what a row written before
 * graphs existed holds, and what a peer serving a page from before a page
 * carried its graph leaves out. Reserved rather than minted — `ulid()` writes
 * the current time into a ULID's first ten characters — so no graph anybody
 * keeps is ever at it.
 */
export const UNNAMED_GRAPH_ULID = "00000000000000000000000000";

/** What the home graph is called until its owner calls it something else. */
export const HOME_GRAPH_TITLE = "My graph";

/**
 * What a graph does to a note written in it: `open` leaves the note open to
 * anybody writing here, `owned` stamps the writer as its owner so anybody
 * else's change is offered rather than landed — docs/ARCHITECTURE.md § "Whose
 * writing a note carries". A person changes a note's own owner afterwards
 * either way.
 */
export const GraphOwnershipSchema = z.enum(["open", "owned"]);
export type GraphOwnership = z.infer<typeof GraphOwnershipSchema>;

/**
 * Whose writing a graph takes: `optional` takes a write from any identity,
 * `required` takes one only from an identity somebody stands behind —
 * docs/ARCHITECTURE.md § "Who may write where". **Absent is `optional`**, which
 * is what every graph written before this says, and what a folder on somebody's
 * own device says: whoever writes alone there is asked to be vouched by nobody.
 */
export const GraphVouchingSchema = z.enum(["optional", "required"]);
export type GraphVouching = z.infer<typeof GraphVouchingSchema>;

/**
 * A graph somebody keeps. What a note belongs to is the ref; the row is the
 * name, and which of them its owner started with.
 *
 * `home` is that one — where a note naming no graph goes, and the graph its
 * owner cannot close. Absent is a graph that is not it, which is what every
 * graph opened alongside it says and what a row written before the column says.
 */
export const GraphSchema = OwnedEntitySchema.extend({
  title: z.string().min(1).max(512),
  home: z.boolean().optional(),
  /** Absent is `open`, which is what every graph made before the field says. */
  ownership: GraphOwnershipSchema.optional(),
  /** Absent is `optional`, which is what every graph made before the field
   *  says. */
  vouching: GraphVouchingSchema.optional(),
});
export type Graph = z.infer<typeof GraphSchema>;

export class InvalidGraphRefError extends Error {
  constructor(ref: OwnedRef, reason: string) {
    super(`Invalid graph ${JSON.stringify(ref)}: ${reason}`);
    this.name = "InvalidGraphRefError";
  }
}

/** The graph a ref names where nobody named one. */
export function unnamedGraphRef(owner: DidSyr): OwnedRef {
  return `${owner}/${UNNAMED_GRAPH_ULID}`;
}

/**
 * Which graph something is in. **Absent is a graph nobody named** — what a row
 * written before anybody could have a second graph holds, and what a peer that
 * has not heard of graphs sends — so this is the one place the two are made
 * one. It is never somebody's home graph: that one has a ulid of its own and
 * is looked up, not spelled.
 */
export function graphRef(owner: DidSyr, graph: OwnedRef | undefined): OwnedRef {
  return graph ?? unnamedGraphRef(owner);
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

/** Rename one, and say what it does to the notes written in it. */
export const UpdateGraphRequestSchema = z.object({
  title: z
    .string()
    .min(1, "Name this graph.")
    .max(512, "That name is longer than a graph name can be. Trim it."),
  /** Absent leaves it as it is; it reaches notes written from here on and
   *  leaves the ones already written as they are. */
  ownership: GraphOwnershipSchema.optional(),
  /** Absent leaves it as it is. It reaches every write from here on, the ones
   *  on notes already written included. */
  vouching: GraphVouchingSchema.optional(),
});
export type UpdateGraphRequest = z.input<typeof UpdateGraphRequestSchema>;
