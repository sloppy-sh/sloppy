---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYEBG1VZN59D2QV9Z3M772
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY52DDY8ADPXG2ZWPG96PN
address: 1c2
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - canvas
  - genealogy
  - protocol
title: "The genealogy is the agreement; the shape is derived from it"
created: 2026-10-25T07:12:18.433Z
updated: 2026-10-25T07:15:14.147Z
---

<!-- block 01M5RYEBG4V50XN26YEWKRPA5R -->

## What it is for

A note's parent — absent on a branch and on an independent note — and its order among the notes alongside it are the whole of what every peer reads the same way. Everything else about a note's place is computed from those: where its mark is seeded, the angular sector its subtree radiates into, its collapse key, what folds and what a subtree carries. [seedField](code:packages/ts/graph/src/layout/geometry.ts#seedField) is handed a note's ref, parent, `created_at` and depth and nothing more; [SeededNote](code:packages/ts/graph/src/layout/geometry.ts#SeededNote) carries no address by contract, so a label written, edited or removed never moves a mark.

`node.depth` is the one derived value that is stored. It is written from the parent chain — the parent's depth and one more, a branch and an independent note both 1 — and from nothing else, and `ASSERT $value > 0` refuses a writer that counted from the other end. `@sloppy/types`' `node.test.ts` holds that a row's depth no longer has to agree with its address.

<!-- block 01M5RYK04BMNBH7TE6PJTHBETX -->

## Why

AI.md § "The Genealogy Is the Protocol (required)": derived values are "functions of the ref and the genealogy — never of the address, which is what keeps a label from moving a mark; persisting one creates a second copy of a truth that no longer has a single author", so "one person's graph draws the same shape on somebody else's screen without anybody shipping coordinates."

The depth exception is docs/ARCHITECTURE.md § "Data model": a bounded region read knows `depth(focus)` before the query is sent, so the slice arrives as `depth <= $max` over `node_owner_origin_depth`; without the column "a peer pulling a foreign region fetches the whole tree and filters on the client, which is exactly the case the mobile-first stance optimises for." The same section conditions the exception on the column being written from the parent chain and nothing else, because "a second copy of a truth is only safe while it cannot drift."

<!-- block 01M5RYK04CQE38X7W3CTCH1Z03 -->

## Still open

docs/ARCHITECTURE.md § "The genealogy and the address" says a mark "is seeded off the genealogy, and never off the address", and a few paragraphs later that "a mark's seed is a function of its address alone (`layout/geometry.ts`)". The code agrees with the first. Is the second sentence left from before the seed stopped reading the address?
