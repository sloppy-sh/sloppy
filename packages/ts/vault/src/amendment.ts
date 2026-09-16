// One offered change as one file, and back — docs/ARCHITECTURE.md § "A graph on
// disk" and § "Whose writing a note carries".

import {
  type AmendmentView,
  type DidSyr,
  DidSyrSchema,
  isUnstyled,
  type NodeAppearance,
  NodeAppearanceSchema,
  type OwnedRef,
  OwnedRefSchema,
  splitOwnedRef,
  type Timestamp,
  TimestampSchema,
} from "@sloppy/types";
import {
  frontBlock,
  frontList,
  frontString,
  splitNoteFile,
  writeFront,
} from "./front.js";
import { amendmentPath, VaultFormatError } from "./layout.js";
import {
  lookBlock,
  type NoteFiles,
  type NoteSource,
  readSections,
  type VaultSection,
  type VaultSoFar,
  writeSections,
} from "./note.js";

/**
 * An offer as a vault carries it. Its own ulid is the file's name rather than a
 * field: an offer is read inside the graph that holds it, so the DID half of
 * its reference is that graph's owner and nothing in the file repeats it.
 */
export interface VaultAmendment {
  /** The note it is offered on. */
  amends: OwnedRef;
  by: DidSyr;
  /** Absent where the file did not say, which is a file a hand has been in. */
  at?: Timestamp;
  /** Absent is an offer made with nothing said about it. */
  message?: string;
  title: string;
  tags: string[];
  /** Absent is an offer that leaves the note's look alone. */
  appearance?: NodeAppearance;
  sections: VaultSection[];
}

/** One offer as its file, with each drawing written beside it. */
export function amendmentToVault(
  amendment: AmendmentView,
  held: VaultSoFar = {},
): NoteFiles {
  const front = writeFront([
    ["amends", amendment.note],
    ["by", amendment.by],
    ["at", amendment.at],
    ["message", amendment.message],
    ["title", amendment.title],
    ["tags", [...amendment.tags]],
    ["appearance", lookBlock(amendment.appearance)],
  ]);
  return writeSections(
    amendmentPath(splitOwnedRef(amendment.ref).localId),
    front,
    amendment.blocks,
    held,
  );
}

/**
 * The offer a file holds. Throws where it is not one: an offer that names no
 * note, or nobody offering it, is not an offer. Everything else a hand can get
 * wrong costs that field and not the offer.
 */
export function vaultToAmendment(files: NoteSource): VaultAmendment {
  const { front, body } = splitNoteFile(files.markdown);
  const amends = OwnedRefSchema.safeParse(frontString(front, "amends"));
  const by = DidSyrSchema.safeParse(frontString(front, "by"));
  if (!amends.success || !by.success) {
    throw new VaultFormatError("This file isn't an offered change.");
  }
  const at = TimestampSchema.safeParse(frontString(front, "at"));
  const message = frontString(front, "message");
  const look = NodeAppearanceSchema.safeParse(frontBlock(front, "appearance"));
  return {
    amends: amends.data,
    by: by.data,
    ...(at.success ? { at: at.data } : {}),
    ...(message === undefined ? {} : { message }),
    title: frontString(front, "title") ?? "",
    tags: frontList(front, "tags"),
    ...(look.success && !isUnstyled(look.data)
      ? { appearance: look.data }
      : {}),
    sections: readSections(body, files),
  };
}
