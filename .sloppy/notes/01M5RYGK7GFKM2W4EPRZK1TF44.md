---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYGK7GFKM2W4EPRZK1TF44
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY52DDY8ADPXG2ZWPG96PN
address: 1c8
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - address
  - genealogy
  - protocol
title: A move re-addresses into the run it joins
created: 2026-10-25T07:13:31.888Z
updated: 2026-10-25T07:16:09.657Z
---

<!-- block 01M5RYGK7HH56P3KTJZ3S0C3Q0 -->

## What it is for

A moved note that has an address takes the next one in the run it joins, by exactly the rule creation uses, unless the person names one; a named one must spring from the address of the note it lands under, or from nothing where it becomes a branch. Everything beneath keeps its place relative to it, and every address the subtree leaves becomes an alias. A note dropped between two siblings lands at the end of their run, and neither sibling is renumbered. A note with no address stays with none, and a note carried into a run nobody numbered comes out with none.

An independent note — no parent and no address — opens no branch: it is in no run, so it never moves what the rule offers the next note. [The device tests](code:packages/ts/local/src/notes.test.ts#L117-L227) hold the move, and [the creation tests](code:packages/ts/local/src/notes.test.ts#L34-L44) hold an unnumbered note left out of the run.

<!-- block 01M5RYND9S61HFRQ3ZBA0QPS19 -->

## Why

AI.md § "The Genealogy Is the Protocol (required)": "A move re-addresses a note that has an address and leaves one that has none alone", and an independent note "opens no branch". docs/ARCHITECTURE.md § "The genealogy and the address" gives the reason both moves with no address come out as they do: each is "the creation rule answering the same way" — there is no address for the rule to spring one from. The same section says what is read in both cases: "What sprang from what is read off the parent chain … never off the addresses, which is also what refuses a move into the moving note's own subtree." The addresses left behind are [Every address a note has carried keeps leading to it](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYFV2A62SMND011DAEYC75).
