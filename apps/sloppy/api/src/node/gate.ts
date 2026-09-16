// What a note gated by somebody else does to a write here —
// docs/ARCHITECTURE.md § "Whose writing a note carries".

import { ForbiddenException } from "@nestjs/common";
import { type DidSyr, type Node, writeOutcome } from "@sloppy/types";

/** Whether this person's writing lands on this note. */
export function writable(note: Pick<Node, "owner">, writer: DidSyr): boolean {
  return writeOutcome(note, writer) === "lands";
}

/**
 * Thrown where it does not. A graph here has one writer, so there is nothing to
 * offer the gate's holder and the way through is to take the gate off — which
 * is the graph owner's, and so is the person reading this.
 */
export function gatedElsewhere(): ForbiddenException {
  return new ForbiddenException(
    "This note is somebody else's to write. Change who owns it, in the note's details, to write it here.",
  );
}
