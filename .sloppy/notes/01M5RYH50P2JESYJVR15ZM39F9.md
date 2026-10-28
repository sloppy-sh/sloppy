---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYH50P2JESYJVR15ZM39F9
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY223B8PSAQ41P43J00M10
address: 1e4
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - agents
  - cli
  - local
  - mcp
  - tooling
title: A tool offers its writing on a note somebody has written in
created: 2026-10-25T07:13:50.102Z
updated: 2026-10-25T14:30:02.432Z
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

<!-- block 01M5SQFVXYQMKEWA6SKJTRQ7TK -->

## The question, sharpened

Two things a `write_note` does today take an author's or an earlier writer's words out of an offer without anybody choosing to. First, a section whose ` ##  ` heading the note already carries replaces that section — in an offer as much as on a note written straight onto — so an agent that sends `## Candidates` onto a proposal replaces the author's candidates with its own in the offer, and the author who takes the offer in loses them. Second, a writer whose offer is already standing on a note and who writes again re-proposes the offer from the note's own sections plus the new write, so the sections its earlier offer carried are gone from the one that stands. An offer is an [amendment](code:packages/ts/types/src/amendment.ts); [writeOnto](code:packages/ts/local/src/write-onto.ts) decides whether a write lands or is offered; [writeNote](code:packages/ts/local/src/acts.ts#writeNote) is where the sections are merged by heading; [proposeAmendment](code:packages/ts/local/src/api.ts#proposeAmendment) is where an offer is made. Is either of these what a writer means?

<!-- block 01M5SQFVXZ26MYQH9Y3NMXY87K -->

## What hangs on it

An offer is read by its author as the whole note proposed, so a section missing from it reads as a section the writer meant to take away. Found in use on 2026-10-25, building a payment rail from a project's proposal notes with several agents writing back through `sloppy mcp`: one agent's offer replaced six of the author's open questions under `## Candidates` with its own two, and a later agent's write onto a note that already carried the container's offer dropped the two sections the first agent had offered. Both were caught in review and mended by hand. What a person can rely on is that an offer carries everything the note said and everything the writer added, and today it does not.

<!-- block 01M5SQFVY0XHZBQDG6GCY88124 -->

## Where I've looked

The `write_note` description says a heading already in the note replaces that section and a section left out stays as it is, which is the rule for a note written straight onto; nothing says what it means for an offer. [AGENT.md](code:.sloppy/AGENT.md) § "Changing a note somebody already wrote" says a write on a person's note goes as an offer and says nothing about a second write by the same writer. Candidates, none decided: `write_note` refusing a heading the note already carries unless the writer says it means to replace it; a new write by a writer with a standing offer merging into that offer instead of re-proposing from the note; the act's description saying plainly that an offer is proposed whole and what a heading already there does to it.
