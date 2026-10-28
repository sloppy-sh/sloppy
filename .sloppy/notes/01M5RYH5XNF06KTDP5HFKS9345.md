---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYH5XNF06KTDP5HFKS9345
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYGVSV1128Z52ZD7MSBMGD
address: 1f5a
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - canvas
  - sets
title: Sets is an arrangement of the one canvas
created: 2026-10-25T07:13:51.029Z
updated: 2026-10-25T07:13:51.030Z
---

<!-- block 01M5RYH5XP00Y1GKHJ2CWWH83A -->

## What it is for

The sets in front of the reader — the same eight every reading colours by — drawn as circles, each with an area that is its count, placed so that what two circles share is what the two sets share. Every note stands inside a circle of a tag it carries; one carrying two stands where they cross, where the figure has that place; one carrying none stands outside every circle. A note the figure has no exact place for stands inside its leading set, so selecting a tag always lights its notes inside its own circle. The fit is deterministic: no clock, no random number, so two devices holding the same notes draw the same figure.

The marks are the marks: depth, provenance, the author's look, bands and the lift on an open note are drawn exactly as on the graph; only where a mark stands changes. [scene.sets.test.ts](code:packages/ts/graph/src/scene.sets.test.ts) holds it.

## Why

DESIGN.md § "Sets — the tags as places": "It is an arrangement of the same marks, never a second canvas", because "A reading that redrew notes as plain dots would be a poorer copy of the mark, and the phone would be the surface that lost it." The same section: "Two sets that share a note overlap, and that comes first", since a pair drawn apart says they have nothing in common.

PRODUCT.md § "Design Principles", 7: Sets "is a reading the reader chooses deliberately", and selecting a tag there "leads the drawing and lights its notes, as selecting does anywhere."

## Still open

DESIGN.md § "Sets" says the figure's promise runs one way: sets that share notes always cross, but two that share none may cross too where eight discs leave no room. Is there a way to tell a reader which crossings are empty, beyond the rail's words?
