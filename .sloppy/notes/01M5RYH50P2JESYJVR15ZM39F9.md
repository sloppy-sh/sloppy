---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYH50P2JESYJVR15ZM39F9
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY223B8PSAQ41P43J00M10
address: 1e4
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - agents
  - cli
  - tooling
title: A tool offers its writing on a note somebody has written in
created: 2026-10-25T07:13:50.102Z
updated: 2026-10-25T07:13:50.106Z
---

<!-- block 01M5RYH50QFBBJEQ16NQBKT0KY -->

## What it is for

Every machine writer — `sloppy draft`, the app's chat, `sloppy mcp` — writes onto a standing note only where that note's `authors` is its own identity and nobody else's. On any note a person has written in, alone or beside it, it proposes an amendment, which stands until the note's author takes it in. A place with no note yet gets one written outright. [writeOnto](code:packages/ts/cli/src/writer.ts#writeOnto) is where the CLI reaches that rule, and the rule itself is written once in `@sloppy/local`, so the three cannot drift. The package itself is [cli: the sloppy command](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQM6K274H8ZXP14VFNBD1M).

<!-- block 01M5RYH50SRC666X7P7CKWA1NS -->

## Why

[docs/ARCHITECTURE.md](code:docs/ARCHITECTURE.md) § "Tooling": "A note somebody else has written in is never written over — by authorship, never by ownership … so an offer stands on a note with no owner rather than being refused as a change the writer could have made."

The same document, § "Asking a tool to write the notes", says why the writer has to hold itself to it: a project's container is an open graph, so the store "answers `lands` for every writer on every one of them", and "a machine writer is held to it BY ITSELF." A writer that wrote a note file by hand "would be the one writer in Sloppy held to nothing at all."

<!-- block 01M5RYH50T0YX45PA0ZXAT2WZD -->

## Decided against

Gating a container in the CLI's name. § "Tooling": `init` mints an identity for the machine it runs on, "so a container gated in its name is one the person who later opens the project cannot write a word in."
