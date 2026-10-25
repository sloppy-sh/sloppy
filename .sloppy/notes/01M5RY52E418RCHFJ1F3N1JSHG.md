---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY52E418RCHFJ1F3N1JSHG
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3E2FRSQAYC42VD7G7A1FQ8R
address: 1f
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - canvas
  - design
title: "The look, and the readings of the graph"
created: 2026-10-25T07:07:14.244Z
updated: 2026-10-25T07:15:30.654Z
---

<!-- block 01M5RY52E4RT07G9ZV5T5ZRPGB -->

[packages/ts/types/src/look.ts](code:packages/ts/types/src/look.ts)

<!-- block 01M5RY52E5P4Y6ZSKV35SRRM2Z -->

## What it is for

How Sloppy looks and why, and the ways a graph is read. [look.ts](code:packages/ts/types/src/look.ts) is the shape a look takes; the notes beneath are the rules every surface is held to.

- The feeling: [Ink on good paper: the chrome is a margin, the graph is the page](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYEA5KXV2VKXFY1MJRM4VF), and the words: [Copy names the outcome, never the mechanism](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYEKQMHP8B6P6WWHGZMKAQ).
- The chrome's colour: [One axis decides colour, four decide none, and a look is a file](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYF3B8XGBEHA8QEFT7SWCE).
- The canvas's colour: [The graph's colour language: hue, lightness and form](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYFES5SCVPV9SN25CHRDZX), with [A mark wears a band for each set it is in](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYFS69S8TT0H4E2J22ZGS7) and [What a line means, and the look a person sets on one](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYG013CQTS529N0ECKXCE1).
- The readings: [The readings: a tree that folds, and tags that light rather than filter](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYGVSV1128Z52ZD7MSBMGD), with [Sets is an arrangement of the one canvas](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYH5XNF06KTDP5HFKS9345).
- The platform: [Phone first; a desk is the same parts stood beside the graph](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYJ083Y8JCS8FGMYHHVJZA) and [Bottom chrome clears the nav bar; pen draws, touch pans](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYJBYWCCFR3XXB7HBA8QYH).
- Two surfaces with rules of their own: [An anchor into code, and the compass card on the note](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYJNB3XFHVCXYWB16QGDDK) and [The profile on a device, and the one line a linked picture earns](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYJX56ZXH6B7QJFEFWHHTY).

What the packages are is [ui: the design system and the component vocabulary](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQM2QYVQ32970GDSVHCWV2) and [graph: the canvas renderer](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQM3WWBG2TQ3Q7SMJXF12R); these notes are what was decided.

## Why

AI.md § "Design & Product (required reading for any UI work)": Sloppy "should feel like ink on good paper — quiet, legible, unhurried, with the graph carrying all the colour there is", and DESIGN.md and PRODUCT.md are the documents of record for every UI change.
