// What a block holds: the editor's own document, one section of a note.
// docs/ARCHITECTURE.md § "Blocks and ink".

import { z } from "zod";
import { type OwnedRef, OwnedRefSchema } from "./common.js";

/** A mark on a run of text — emphasis, a link — carrying its own attributes. */
export interface DocumentMark {
  type: string;
  attrs?: Record<string, unknown>;
}

/**
 * One node of a stored document, in ProseMirror's own encoding: `text` on a
 * text node, `content` on anything holding others, `attrs` for whatever the
 * element itself needs — an ink element's strokes, a picture's upload.
 */
export interface DocumentNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocumentNode[];
  marks?: DocumentMark[];
  text?: string;
}

export const DocumentMarkSchema: z.ZodType<DocumentMark, DocumentMark> =
  z.object({
    type: z.string().min(1),
    attrs: z.record(z.string(), z.unknown()).optional(),
  });

export const DocumentNodeSchema: z.ZodType<DocumentNode, DocumentNode> = z.lazy(
  () =>
    z.object({
      type: z.string().min(1),
      attrs: z.record(z.string(), z.unknown()).optional(),
      content: z.array(DocumentNodeSchema).optional(),
      marks: z.array(DocumentMarkSchema).optional(),
      text: z.string().optional(),
    }),
);

/**
 * How deep a document may nest, counting every object and array level — an
 * element, its `content`, and whatever an `attrs` payload holds. Past
 * ninety-six of them the database driver stops answering a write at all, so
 * the bound sits at half that; docs/ARCHITECTURE.md § "Blocks and ink" carries
 * the measurement.
 */
export const MAX_DOCUMENT_NESTING = 48;

function nesting(value: unknown): number {
  let deepest = 0;
  const pending: { value: unknown; depth: number }[] = [{ value, depth: 1 }];
  for (let at = pending.pop(); at; at = pending.pop()) {
    if (at.value === null || typeof at.value !== "object") continue;
    if (at.depth > deepest) deepest = at.depth;
    for (const child of Object.values(at.value)) {
      pending.push({ value: child, depth: at.depth + 1 });
    }
  }
  return deepest;
}

/**
 * The document one block stores. Bounded by shape and not by vocabulary: an
 * element kind this version has no renderer for still parses, and an `attrs`
 * payload is carried without being read. docs/ARCHITECTURE.md § "Blocks and
 * ink" says why the bound sits there.
 */
export const BlockDocumentSchema = z.object({
  type: z.literal("doc"),
  // The bound rides the array rather than the document, so `BlockDocumentSchema`
  // keeps the `.omit()`/`.partial()` a refinement on an object schema takes away.
  content: z
    .array(DocumentNodeSchema)
    .check((ctx) => {
      // One level deeper than its content: the document node holding it.
      if (1 + nesting(ctx.value) <= MAX_DOCUMENT_NESTING) return;
      ctx.issues.push({
        code: "custom",
        input: ctx.value,
        message:
          "This section is nested too deeply to save. Pull a few levels back out and try again.",
      });
    })
    .default(() => []),
});
export type BlockDocument = z.infer<typeof BlockDocumentSchema>;

/** A section with nothing written in it yet. */
export function emptyDocument(): BlockDocument {
  return { type: "doc", content: [] };
}

/** `upload_id`, or anything ending `_upload_id`. */
const CITES_UPLOAD = /^(?:.*_)?upload_id$/;

/**
 * Where a PUBLISHED emoji carries the publication's copy of its picture. An
 * emoji in a note names a shortcode and an address minted for the author's own
 * catalog, so publishing resolves that catalog once, writes the copy here, and
 * **clears the minted `src`** — an address into a catalog its author can empty
 * is exactly what a snapshot exists not to depend on. The key ends
 * `_upload_id`, so from then on {@link citedUploads} reaches it like any other
 * picture. A reader draws a published emoji from this and never from `src`,
 * which a published element does not carry. docs/ARCHITECTURE.md § "Pictures".
 */
export const EMOJI_UPLOAD_ATTR = "emoji_upload_id";

/**
 * Every upload a section's document cites, in the order it cites them and
 * without repeats — which is what publishing has to copy, and what a published
 * section may cite nothing outside of.
 *
 * An `attrs` key named `upload_id`, or ending `_upload_id`, names an upload in
 * the author's store: a picture's, a drawing's raster. That is a convention
 * across elements rather than a list of them, so an element kind this build has
 * no renderer for is walked like any other and its pictures travel with it —
 * AI.md § "A Block Is a Section" is why storage does not enumerate the kinds.
 *
 * What it does NOT reach is an element that names a picture by something other
 * than an upload, which today is the custom emoji: publishing resolves that one
 * itself and writes the copy under {@link EMOJI_UPLOAD_ATTR}.
 * docs/ARCHITECTURE.md § "Pictures".
 */
export function citedUploads(content: BlockDocument): string[] {
  const cited = new Set<string>();
  // Depth is what `MAX_DOCUMENT_NESTING` already bounds, so the walk is written
  // the way the document is shaped.
  const walk = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    for (const [key, held] of Object.entries(value)) {
      if (CITES_UPLOAD.test(key) && typeof held === "string" && held) {
        cited.add(held);
      } else {
        walk(held);
      }
    }
  };
  walk(content.content);
  return [...cited];
}

// The element a `[[` writes, and the attribute on it naming the note cited.
// `reference-node.ts` in `@sloppy/ui` is what renders one; the two names live
// here because {@link citedNotes} has to read what that renderer wrote.
export const REFERENCE_NODE = "reference";
export const REFERENCE_NOTE_ATTR = "note";

/**
 * Every note a section's document cites, in the order it cites them and
 * without repeats — which is what a note's `references` are derived from, and
 * so which dashed lines its writing draws. DESIGN.md § Edges rules on the line.
 *
 * A stored document is whatever some client wrote, so an element naming
 * anything that is not a `<did>/<ulid>` names no note and is skipped: a
 * reference nobody can resolve must not become an edge to nowhere.
 */
export function citedNotes(content: BlockDocument): OwnedRef[] {
  const cited = new Set<OwnedRef>();
  const walk = (nodes: readonly DocumentNode[] | undefined): void => {
    for (const node of nodes ?? []) {
      if (node.type === REFERENCE_NODE) {
        const named = OwnedRefSchema.safeParse(
          node.attrs?.[REFERENCE_NOTE_ATTR],
        );
        if (named.success) cited.add(named.data);
      }
      walk(node.content);
    }
  };
  walk(content.content);
  return [...cited];
}
