---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYFS69S8TT0H4E2J22ZGS7
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYFES5SCVPV9SN25CHRDZX
address: 1f4a
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - canvas
  - sets
title: A mark wears a band for each set it is in
created: 2026-10-25T07:13:05.225Z
updated: 2026-10-25T07:13:05.226Z
---

<!-- block 01M5RYFS6AYBNTRN88VVT2XXKZ -->

## What it is for

A note in several of the sets in front of the reader wears a band of each, side by side across the disc, first set on the left — the order the rail lists them in. A note in one set is the whole disc in that hue. The colour is there before anybody selects anything; selecting chooses which sets lead, and the notes carrying none of the selected tags dim, bands and all, never further than 1.6\:1 against the ground. Bands go as the mark gets small: one narrower than [BAND_MIN_WIDTH](code:packages/ts/graph/src/scene.ts#BAND_MIN_WIDTH) falls back to the first hue, and a pinch brings them back. A pulled mark is hollow, so its edge carries the first hue and the rail says the rest. [scene.bands.test.ts](code:packages/ts/graph/src/scene.bands.test.ts) holds the behaviour.

One ranking feeds every reading — [drawnSetsOf](code:packages/ts/graph/src/contract.ts#drawnSetsOf) — so the graph, the sets figure, the outline and the rail cannot disagree about which tag wears which hue.

## Why

DESIGN.md § "Hue — the sets in front of the reader, and only those": "The mark itself says which of the sets in front of the reader a note stands in, rather than only the first of them", and a band narrower than the floor "is a haze rather than an answer." The same section on the dim: "a graph whose deep generations fade out under the question has answered by drawing a different graph."

PRODUCT.md § "Accessibility & Inclusion": which sets a note is in "is said in hue, a band each, and always in words as well", for a reader who cannot separate two hues "and to one who can but is looking at a note in three sets at once."

## Decided against

One mark, one hue — a mark showing only its first set. The section above replaces it with a band per set, and no mark wears a second band in a hue it already wears.
