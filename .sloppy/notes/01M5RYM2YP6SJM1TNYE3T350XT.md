---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYM2YP6SJM1TNYE3T350XT
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY52DDY8ADPXG2ZWPG96PN
address: 1c9
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - genealogy
  - protocol
title: "One order within a run, in one function"
created: 2026-10-25T07:15:26.294Z
updated: 2026-10-25T07:15:26.296Z
---

<!-- block 01M5RYM2YQHWF25501211CYVB0 -->

## What it is for

A run is a note's children, and a graph's branches are the run under no note at all; `runKeyOf` in `@sloppy/types` is that key — the parent's ref, or the graph where there is no parent. Within a run the notes with addresses come first, in address order, and the rest follow in the order they were written, ties broken by ref so two notes written in the same millisecond order the same way on every peer. `orderSiblings` is that order and the only one: [the tests](code:packages/ts/types/src/node.test.ts#L95-L125) hold all three clauses. The canvas seeds a mark by its place in this order, a published version is written down in it, and every list of a run reads it.

Whether a note is in a run at all is [the last describe](code:packages/ts/types/src/node.test.ts#L295-L315): a note that sprang from another is, numbered or not; a branch is; a note that sprang from nothing and carries no number is not.

<!-- block 01M5RYM2YQ88VJVX1846GR5VCT -->

## Why

AI.md § "The Genealogy Is the Protocol (required)": "That is one ordering, in one function, so no two surfaces can disagree about what a run reads as." The tie-break by ref is docs/ARCHITECTURE.md § "The genealogy and the address": "so two notes written in the same millisecond still order the same way on every peer." Because order among siblings is half of the genealogy, it is part of what [The genealogy is the agreement](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYEBG1VZN59D2QV9Z3M772) says every peer reads the same way.

<!-- block 01M5RYM2YRQ49K7R981S79Y7BR -->

## Still open

A person may write a label that is not the one the rule would have offered, so address order inside a run need not match writing order, and the canvas seeds a mark by its place in this order. Does a relabelled note changing place among its siblings count as "a label moving a mark", which AI.md forbids, or is order among siblings meant to follow the label?
