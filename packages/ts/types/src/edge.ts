// The lines drawn between two notes, and the look a person set on one.
// DESIGN.md § Edges is the doc of record for how each one is drawn and what it
// says; docs/ARCHITECTURE.md § "A look a person set on a line" for where a look
// is stored and how a pair resolves.

import { z } from "zod";
import { type OwnedRef, OwnedRefSchema, type Timestamp } from "./common.js";

/**
 * Every kind of line, strongest first — the order is the ruling: a pair several
 * of these are true of draws one line, and it is the earliest of them here.
 * `genealogy` and `run` fall out of the addresses; `reference` is a note's own
 * writing naming another, and `link` is one somebody drew by hand.
 *
 * `link` leads because somebody reached for it and a gesture the canvas
 * swallowed is a gesture lost. The run comes next: nobody draws on the canvas
 * by typing `[[1a]]` in `1b`, the two are already joined, and the run is the
 * heaviest line there is because it is the one a reader walks — a citation
 * forward along it would trade that walk for a line that reads like any
 * reference across the tree.
 */
export const EDGE_KINDS = ["link", "run", "reference", "genealogy"] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

/** The one line a pair draws where both of these are true of it. */
export function strongestEdge(a: EdgeKind, b: EdgeKind): EdgeKind {
  return EDGE_KINDS.indexOf(a) <= EDGE_KINDS.indexOf(b) ? a : b;
}

/** A line somebody made on purpose, either way of making one. It is the kind
 *  that takes a pair's line without taking the distance the addresses set it
 *  at — DESIGN.md § Edges. */
export function isConnection(kind: EdgeKind): boolean {
  return kind === "reference" || kind === "link";
}

/**
 * Which end of a line an arrowhead sits at, read against the note the look is
 * STORED on: `to` points at the note {@link EdgeLookSchema}'s `to` names,
 * `from` points back at the note carrying the look, and `both` draws one at
 * each end. Absent is a line with no arrowhead, which is every line today.
 */
export const EDGE_DIRECTIONS = ["to", "from", "both"] as const;
export type EdgeDirection = (typeof EDGE_DIRECTIONS)[number];

/** How broken the line is. Absent leaves the break the line already has —
 *  DESIGN.md § Edges, where the break says how the line was made. */
export const EDGE_STROKES = ["solid", "dashed", "dotted"] as const;
export type EdgeStroke = (typeof EDGE_STROKES)[number];

/** As long a label as a line can carry and still read as a caption. */
export const EDGE_LABEL_MAX = 80;

/**
 * A look one person set on the line between two notes, stored on the note it is
 * read from. It is a LOOK and never a fact: it draws on whatever line is
 * already between the two — genealogy, run, reference or link — and on nothing
 * at all where there is no line. It moves no mark and changes no distance.
 *
 * An absent channel is the default for that channel alone, which is the
 * design's own. A look with no channel set says nothing and is not stored:
 * {@link looksWritten} is what drops one.
 */
export const EdgeLookSchema = z.object({
  /** The note at the other end. It may be somebody else's, and it may be gone:
   *  a look on a line that is not there draws nothing. */
  to: OwnedRefSchema,
  label: z.string().trim().max(EDGE_LABEL_MAX).optional(),
  direction: z.enum(EDGE_DIRECTIONS).optional(),
  stroke: z.enum(EDGE_STROKES).optional(),
});
export type EdgeLook = z.infer<typeof EdgeLookSchema>;

/**
 * One look per note at the other end. Two looks naming one note would be a line
 * drawn two ways, and a pair draws one line.
 *
 * A free predicate rather than a refinement on the schema: `NodeSchema` stays a
 * plain object so the DTOs built off it may still `.omit()` and `.partial()`,
 * which a `.refine()` takes away. Every writer of a list calls this.
 */
export function looksAreOnePerTarget(
  edges: readonly EdgeLook[] | undefined,
): boolean {
  if (edges === undefined) return true;
  return new Set(edges.map((look) => look.to)).size === edges.length;
}

/** A look that names no channel — what "Clear the look" leaves behind. */
export function isBlankLook(look: EdgeLook): boolean {
  return (
    look.label === undefined &&
    look.direction === undefined &&
    look.stroke === undefined
  );
}

/**
 * The looks a write leaves on a note: each with the channels it says nothing on
 * taken off, and the whole list absent where none of them says anything.
 * `undefined` in is `undefined` out, so a caller still tells "no looks" from
 * "leave the looks alone" by whether it had a list at all.
 *
 * One function, so a hosted graph and a folder store the same thing for the
 * same act.
 */
export function looksWritten(
  edges: readonly EdgeLook[] | undefined,
): EdgeLook[] | undefined {
  if (edges === undefined) return undefined;
  const said = edges.map(saidLook).filter((look) => !isBlankLook(look));
  return said.length === 0 ? undefined : said;
}

/** A person who cleared the label field said nothing, rather than said the
 *  empty string. */
function saidLook(look: EdgeLook): EdgeLook {
  if (look.label !== "") return look;
  const { label: _cleared, ...rest } = look;
  return rest;
}

/**
 * Either end of a line, as much of it as {@link lookBetween} reads. `NodeView`
 * is one; so is anything else carrying a ref, its looks and when it was last
 * written.
 */
export interface LookingNote {
  ref: OwnedRef;
  edges?: readonly EdgeLook[];
  updated_at: Timestamp;
}

/** The look `note` carries on its line to `other`, where it carries one. */
export function lookOn(
  note: LookingNote,
  other: OwnedRef,
): EdgeLook | undefined {
  return note.edges?.find((look) => look.to === other);
}

/**
 * Which look draws the line between two notes. Either end may carry one, so a
 * reader answers off both: where one does, that is the look; where both do, the
 * note written later wins, and the smaller ref breaks a tie — so two peers
 * reading one pair read one look.
 *
 * The answer is the winning note's own entry, whose `to` names the OTHER end,
 * which is how a caller knows which way round `direction` points.
 */
export function lookBetween(
  a: LookingNote,
  b: LookingNote,
): EdgeLook | undefined {
  const mine = lookOn(a, b.ref);
  const theirs = lookOn(b, a.ref);
  if (mine === undefined) return theirs;
  if (theirs === undefined) return mine;
  if (a.updated_at !== b.updated_at) {
    return a.updated_at > b.updated_at ? mine : theirs;
  }
  return a.ref < b.ref ? mine : theirs;
}
