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
 * The document one block stores. Bounded by shape and not by vocabulary: an
 * element kind this version has no renderer for still parses, and an `attrs`
 * payload is carried without being read. docs/ARCHITECTURE.md § "Blocks and
 * ink" says why the bound sits there.
 */
export const BlockDocumentSchema = z.object({
  type: z.literal("doc"),
  content: z.array(DocumentNodeSchema).default(() => []),
});
export type BlockDocument = z.infer<typeof BlockDocumentSchema>;

/** A section with nothing written in it yet. */
export function emptyDocument(): BlockDocument {
  return { type: "doc", content: [] };
}
