---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYG013CQTS529N0ECKXCE1
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYFES5SCVPV9SN25CHRDZX
address: 1f4b
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - canvas
  - design
title: "What a line means, and the look a person sets on one"
created: 2026-10-25T07:13:12.227Z
updated: 2026-10-25T07:13:27.838Z
---

<!-- block 01M5RYG013P6S20X4XTH11SXYY -->

## What it is for

Four kinds of line, told apart by weight, lightness and break, never by hue. Genealogy is the faintest and thinnest; a reference from the writing is a step heavier and darker; the run between notes alongside each other is heaviest and darkest; a link drawn by hand is broken. A pair draws one line: a hand link, then the run, then a reference, then parentage.

A person may set a look on one line, and it wins only on the channels it names: `stroke` (`solid`, `dashed`, `dotted`) overrides the break and only the break; `direction` puts an arrowhead at either end or both, in the line's own ink and weight; `label` is a caption at the midpoint, held to the canvas's level-of-detail rules. A look dims with its line, moves no mark, and draws nothing where there is no line. [scene.edges.test.ts](code:packages/ts/graph/src/scene.edges.test.ts) holds it.

## Why

DESIGN.md § "Edges": the three solid kinds move on weight and lightness at once because width is clamped as the field zooms out, so "the reader who has lost the width still has the order"; and "The break says how the line was made, and it is the only thing that says it."

DESIGN.md § "A look a person set": a hand link drawn solid "says nothing about how it was made any more. That is the point: they said so on purpose"; weight and lightness are not a channel, "so the ladder of the four kinds survives every look anybody sets."

<!-- block 01M5RYGF8YNMBV4BRVEG1RH9FN -->

## Still open

DESIGN.md § "Edges" still says the canvas draws links and references as one broken `connection`. The code no longer does: [connectionsOf](code:packages/ts/graph/src/model.ts#connectionsOf) hands `link` and `reference` over as two kinds, and [scene.ts](code:packages/ts/graph/src/scene.ts) strokes only `link` dashed. Should that paragraph come out of DESIGN.md?
