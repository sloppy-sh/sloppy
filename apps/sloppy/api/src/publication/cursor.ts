// Where a page of a published answer resumes. Minted here and handed back
// untouched, so what one means is this instance's own business — nothing on the
// reading side reads one. docs/ARCHITECTURE.md § "Federating the graph".

import { BadRequestException } from "@nestjs/common";
import { type PageCursor, PageCursorSchema } from "@sloppy/types";
import { z } from "zod";

const MarkSchema = z.object({
  /** What the run is of, so a cursor cannot be spent on another answer. */
  of: z.string().min(1),
  /** The last address served, where a run is ordered by address. */
  at: z.string().min(1).optional(),
  /** The last section served of the note at `at`, where its stack ran past one
   *  page and the next carries the rest of it. */
  ord: z.string().min(1).optional(),
  /** The last sequence served, where a run is ordered by version. */
  seq: z.int().positive().optional(),
});
export type PageMark = z.infer<typeof MarkSchema>;

export function markPage(mark: PageMark): PageCursor {
  return PageCursorSchema.parse(
    Buffer.from(JSON.stringify(mark)).toString("base64url"),
  );
}

/** The mark a caller handed back, held to the run it is being spent on.
 *  `undefined` where they asked for the first page. */
export function pageMark(
  raw: string | undefined,
  of: string,
): PageMark | undefined {
  if (raw === undefined || raw === "") return undefined;
  const mark = MarkSchema.safeParse(read(raw));
  if (!mark.success || mark.data.of !== of) {
    throw new BadRequestException("Ask for that again from the start.");
  }
  return mark.data;
}

function read(raw: string): unknown {
  if (!PageCursorSchema.safeParse(raw).success) return null;
  try {
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
