---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M71Z3Z8BAGKH20DJV4PKAA98
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M71Z3Z7G7FW26QJBZ5DEJ0M3
address: 1e12a
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - agents
  - context
  - mcp
title: "What goes in the window: a region of the graph, composed to a budget"
created: 2026-11-10T05:32:58.507Z
updated: 2026-11-10T05:32:58.509Z
---

<!-- block 01M71Z3Z8BWJA2FGX2TKM48Z6N -->

## What it is for

The window is composed whole for one job, never fetched piece by piece. In order it holds: the note whose title and sections best answer the ask, **whole where it fits**; the chain it sprang from, each note as its opening and headings — the way [a brief already reads a note](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5SNJDYM3KH9Q6M471XY6BF4); the notes beside it in its tags, as titles; the code its anchors point at, as the lines, with each anchor's standing said beside it (held, moved, missing); and the one line of the instructions file saying the reasons are in the notes.

A budget bounds it, counted in the tokens of the model that will read it. The order of composing is the reverse of the order of cutting: code goes first, then the tagged siblings, then the ancestors, and the best note last, so what is left under the tightest budget is the one document whole.

It extends [brief.ts](code:packages/ts/local/src/brief.ts), which composes a brief of three reads to a character budget. [That note](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5SNJDYM3KH9Q6M471XY6BF4) already names as candidates "a depth beyond three hops" and "a budget in tokens rather than characters"; the window is both. Nothing of it is stored — it is composed per job from what the notes say now. It is composed in [window.ts](code:packages/ts/local/src/window.ts).

<!-- block 01M71Z3Z8CXWXYE9W512Z08VBP -->

## Why

- [The token economy](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYHJHSAJZ7TQBX6M5ZXPRR) holds the developer's shape for it: "some sort of sliding window for the context the agents fetch while working on a given task, allowing it to fetch nodes up to, say n hops away from the main node it needs to work on."
- [bench/SURVEY.md](code:bench/SURVEY.md) § "Where the gain is": \*brief\* at −0.042 is excerpts of several notes against one document whole — hence "whole where it fits" and the best note cut last.
- [A brief is composed at read time](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5SNJDYM3KH9Q6M471XY6BF4): "nothing of it is stored", which holds here for the same reason — a stored window is a second copy of the notes with no single author.

<!-- block 01M71Z3Z8DJ66DVN7RRPK2ERCQ -->

## Candidates

- How far out: three hops today; whether depth should follow the budget rather than a fixed count.
- Whether the window is composed once per job and then only grows, or composed again on every turn as the model's own writing changes what the ask is.
- Counting tokens needs the reading model's tokenizer; a provider that does not expose one falls back to the character budget the brief uses.
- Whether the Sets reading — the tags as regions — should decide which siblings count as beside, rather than a shared tag alone.
