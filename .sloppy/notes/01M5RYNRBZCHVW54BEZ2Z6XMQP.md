---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYNRBZCHVW54BEZ2Z6XMQP
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY52DDY8ADPXG2ZWPG96PN
address: 1c10
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - identity
  - protocol
title: "Whose graph a note is in, and whose writing it carries"
created: 2026-10-25T07:16:20.991Z
updated: 2026-10-25T07:16:20.994Z
---

<!-- block 01M5RYNRC0ENNE2NVXM8NRYXKT -->

## What it is for

The ref's DID says whose graph a note is in. Whose writing it is, is a list on the note: `authors` names every DID whose writing it carries, in the order they first wrote into it, and absent or empty reads as the ref's DID alone — `authorsOf` in `@sloppy/types` is the one reader of that fallback. `owner` is who gates the writing; absent is an open note. `contributors` lists whoever's offered change the owner took in.

One function, `writeOutcome`, decides every write on every surface. On an open note, or by the owner, the write lands — on an open note appending the writer to `authors` once. By anybody else on an owned note it does not land: it is offered to the owner, who takes it in whole or turns it down, and taking it in adds a contributor and leaves `authors` alone. The graph's own owner still places every note; an offer carries a note's writing and never its place. [The device tests](code:packages/ts/local/src/whose-writing.test.ts#L136-L232) hold the list and the gate, and [the offer tests](code:packages/ts/local/src/whose-writing.test.ts#L386-L845) hold taking in and turning down.

<!-- block 01M5RYNRC1VX924RYAHSK6JWNH -->

## Why

AI.md § "The Genealogy Is the Protocol (required)" states the rule, including that taking an offer in "adds a `contributor` and leaves `authors` alone, because ownership is not writing." docs/ARCHITECTURE.md § "Whose writing a note carries" gives why the place stays the graph's: "the genealogy and the numbers are the graph's, and handing a note's writing on does not hand those with it", and why an act that carries a subtree is held to every gate in it: "a gate a person cannot reach through the note above it is the whole of what a gate is."

<!-- block 01M5RYNRC2XSXQA00G5F1YH1DS -->

## Still open

docs/ARCHITECTURE.md says taking part of an offer "is a later theme": should a person be able to take some sections of an offer and not others, and what would `contributors` record then?
