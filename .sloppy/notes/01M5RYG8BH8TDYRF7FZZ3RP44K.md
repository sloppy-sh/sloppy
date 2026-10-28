---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYG8BH8TDYRF7FZZ3RP44K
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY52DDY8ADPXG2ZWPG96PN
address: 1c7
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - address
  - protocol
title: A note in the bin holds its address until somebody asks for it
created: 2026-10-25T07:13:20.753Z
updated: 2026-10-25T07:16:03.778Z
---

<!-- block 01M5RYG8BJY2RZXY9KB468ZPDH -->

## What it is for

Deleting a note frees nothing on its own: nothing is renumbered, and the rule never offers a number a binned note holds. But a person who writes that number on another note, names it on a move, or writes a new note at it is given it. The binned note keeps the number as an alias, so a citation still leads there while the note now at the address is what it resolves to; it comes back from the bin with no number and the one it gave up shown beside it, for its author to renumber. Where that number already led back to a note that left it earlier, that note keeps it and the binned note comes back with nothing beside it. A note that is there never yields this way.

[The bin tests](code:packages/ts/local/src/graph.test.ts#L208-L243) hold it on a device: a binned note's `1` goes to the note a person renumbers, and the binned note keeps `1` as an alias and no address; after a purge the standing note's number is still its own to take back, and a purged note's number is refused to everyone.

<!-- block 01M5RYN7HP3ECQHZ76R4G26HVJ -->

## Why

AI.md § "The Genealogy Is the Protocol (required)", the bullet "A note in the bin holds its address only until a person asks for it", is the rule as written above. docs/ARCHITECTURE.md § "The genealogy and the address" says what keeps the rule deterministic: `nextChildAddress` steps past a number the graph has spent, "a note in the bin included", and `NodeService.claim` is the one check that lets a binned note yield while a note that is there refuses the write. The rows it leaves behind are those of [Every address a note has carried keeps leading to it](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYFV2A62SMND011DAEYC75).

<!-- block 01M5RYN7J21T8PEKNZM7VGBMFT -->

## Still open

Neither document says why a binned note yields to a person but is passed over by the rule. Is it that the rule must stay deterministic across peers while a person's explicit ask need not, or something else?
