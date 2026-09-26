// The pieces a section is written out of, as the CLI writes one —
// docs/ARCHITECTURE.md § "Tooling and the review". Everything here is an
// ordinary document the editor already knows; nothing is the CLI's own kind.

import {
  type BlockDocument,
  CODE_SCHEME,
  type CodeAnchor,
  type Compass,
  COMPASS_DIRECTIONS,
  compassNode,
  type DocumentNode,
  type OwnedRef,
} from "@sloppy/types";

/** The href an anchor is carried in, which {@link parseCodeAnchor} reads back. */
export function anchorHref(anchor: CodeAnchor): string {
  const fragment = anchor.fragment;
  if (fragment === undefined) return `${CODE_SCHEME}${anchor.path}`;
  const after =
    fragment.kind === "symbol"
      ? fragment.name
      : fragment.from === fragment.to
        ? `L${fragment.from}`
        : `L${fragment.from}-L${fragment.to}`;
  return `${CODE_SCHEME}${anchor.path}#${after}`;
}

export function text(said: string): DocumentNode {
  return { type: "text", text: said };
}

export function anchor(label: string, at: CodeAnchor): DocumentNode {
  return {
    type: "text",
    text: label,
    marks: [{ type: "link", attrs: { href: anchorHref(at) } }],
  };
}

/** A citation of another note, the same element a `[[` writes. `label` is what
 *  a reader who has not got that note sees, so it is the title as it read when
 *  the citation was written. */
export function cites(note: OwnedRef, label: string): DocumentNode {
  return {
    type: "reference",
    attrs: { note, ...(label === "" ? {} : { label }) },
  };
}

export function heading(said: string): DocumentNode {
  return {
    type: "heading",
    attrs: { level: 2 },
    content: [text(said)],
  };
}

export function paragraph(...held: DocumentNode[]): DocumentNode {
  return held.length === 0
    ? { type: "paragraph" }
    : { type: "paragraph", content: held };
}

export function bullets(items: readonly DocumentNode[][]): DocumentNode {
  return {
    type: "bulletList",
    content: items.map((held) => ({
      type: "listItem",
      content: [paragraph(...held)],
    })),
  };
}

/** A drawing of what a module reaches and what reaches into it. */
export function diagram(source: string): DocumentNode {
  return { type: "diagram", attrs: { language: "mermaid", source } };
}

/** A compass with the slots named filled and the rest left empty. */
export function compass(filled: Partial<Compass>): DocumentNode {
  const slots = {} as Compass;
  for (const direction of COMPASS_DIRECTIONS) {
    slots[direction] = [...(filled[direction] ?? [])];
  }
  if (filled.kind) slots.kind = filled.kind;
  return compassNode(slots);
}

/** One section, headed by the words the CLI knows it by. */
export function section(said: string, ...held: DocumentNode[]): BlockDocument {
  return { type: "doc", content: [heading(said), ...held] };
}
