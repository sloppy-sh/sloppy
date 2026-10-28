---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYP1R6S4JB91BTNMS3W06D
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY52DDY8ADPXG2ZWPG96PN
address: 1c11
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - blocks
  - protocol
title: A block is a section a person adds on purpose
created: 2026-10-25T07:16:30.598Z
updated: 2026-10-25T07:16:30.601Z
---

<!-- block 01M5RYP1R8WPNDNSTV6H6VV1YG -->

## What it is for

A block is a visible section of a note with a handle that reorders it, and a person adds one deliberately. Inside it they write as many paragraphs, headings, lists, code, pictures and drawings as they like; Enter makes a new paragraph inside the block, never a new block, and nothing creates one as a side effect of typing. One `block` row stores the editor's own TipTap/ProseMirror document for that section, losslessly.

The kinds of element inside a document are an open set. `BlockDocumentSchema` bounds a document by shape — a `doc` whose nodes name a `type` and nest under `content`, `marks` and `attrs` — and by nesting depth, `MAX_DOCUMENT_NESTING`, and never by vocabulary. [The tests](code:packages/ts/types/src/document.test.ts#L94-L161) hold a whole section kept with its drawings, a kind with no renderer carried untouched, a document with no element kind refused, and the nesting bound. The genealogy, tags and addresses are untouched by any of this.

<!-- block 01M5RYP1R8X24EJS207XYTCTCD -->

## Why

AI.md § "A Block Is a Section (required)": the handle should mean "you reorder sections, not sentences", and "a surface that maps one editor node to one row has rebuilt the model this rule exists to forbid." The stored shape is the editor's because "Markdown cannot carry ink strokes or picture metadata, and one payload column cannot describe a section with three drawings in it" — a cost stated there: "an editor change is a migration." AI.md § "Provider-Agnostic Data Shapes (required)" makes the element kinds an open set: "a new kind is a node the editor knows and a renderer, never a column." docs/ARCHITECTURE.md § "Blocks and ink" gives the nesting bound's reason: SurrealDB's JavaScript driver never settles a write nested past ninety-six levels, so 48 is half of what was measured.

<!-- block 01M5RYP1R99XGV282BHS17758K -->

## Decided against

docs/ARCHITECTURE.md § "Blocks and ink": enumerating the editor's node types in the schema "would make every editor change a schema change, and would refuse the documents stored before it"; accepting `unknown` "would let a malformed value reach a renderer that cannot defend itself." A field such as `inkStrokes` on every block is named in AI.md § "Provider-Agnostic Data Shapes" as "the same mistake wearing our own brand."
