// What a block holds: the editor's own document, one section of a note.
// docs/ARCHITECTURE.md § "Blocks and ink".

import { z } from "zod";

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
