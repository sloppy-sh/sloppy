---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYFES5SCVPV9SN25CHRDZX
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY52E418RCHFJ1F3N1JSHG
address: 1f4
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - canvas
  - design
  - sets
title: "The graph's colour language: hue, lightness and form"
created: 2026-10-25T07:12:54.565Z
updated: 2026-10-25T07:12:54.566Z
---

<!-- block 01M5RYFES6FCKV43RQZ5GNSZTE -->

## What it is for

Three cheap channels at graph scale, and one meaning each. **Hue** is the sets in front of the reader and only those: the tags they selected, in selection order, then the field's most-carried tags, eight in all, each borrowing a facet slot for as long as it is in front. A tag has no colour of its own and nothing persists one; [assignTagHueSlots](code:packages/ts/types/src/tag.ts#assignTagHueSlots) is the one place the mapping is made. **Lightness** is genealogical depth, a ramp between the look's own ink and paper. **Form** — edge, ring, radius — is provenance and the author's look: own is solid, published wears a thin ring, pulled is hollow with a dashed edge.

A note's own look never uses colour. Every channel it may spend is shape or picture, and the note look controls offer nothing else ([look-controls.svelte](code:packages/ts/ui/src/lib/components/appearance/look-controls.svelte)).

## Why

DESIGN.md § "The graph's colour language": "no two meanings may share one. Two meanings sharing a channel is how a graph view becomes decorative." Its table gives each channel's reason: hue is loudest and a reader scans the field for set membership; lightness "is the only channel read as ordered without a legend"; form "survives greyscale, colour-blindness and full zoom-out."

DESIGN.md § "A note's look never uses colour": hue is the reader's question, legible across a graph pulled from an author they never met, and "A note carrying a colour of its own would answer a question nobody asked." PRODUCT.md § "Accessibility & Inclusion": provenance and set membership "are never carried by colour alone."

## Decided against

A colour picker on a note: DESIGN.md § "A note's look never uses colour" calls one "a bug". A ninth hue: DESIGN.md § "Hue" — it "would wear a hue already spent and so say nothing."
