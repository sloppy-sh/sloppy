---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYFV2A62SMND011DAEYC75
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY52DDY8ADPXG2ZWPG96PN
address: 1c6
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - address
  - protocol
title: Every address a note has carried keeps leading to it
created: 2026-10-25T07:13:07.146Z
updated: 2026-10-25T07:15:57.806Z
---

<!-- block 01M5RYFV2BAZ8QKX8VJWH1KQE6 -->

## What it is for

An address a note was moved from or renamed away from becomes an alias: it resolves to that note for as long as the note is there and is never given to a second one. Where an address reaches both a note at it and a note that was, the note at it answers; where two notes have left it, the first to leave it does. Purging a note takes its aliases with it and retires every one of those numbers rather than freeing it — except a number another note is at, which stays that note's.

A retired number carries the note that spent it, and only that note, arriving again by the same ref in the same graph, takes it back. [The archive tests](code:packages/ts/local/src/archive.test.ts#L768-L840) hold the three cases: a number the graph retired is still refused to a new note after a copy is brought in; the note that spent it comes home at it, and nobody else may have it; a retired number naming no note is refused to everyone.

<!-- block 01M5RYN1QE53PC4KBJNG6WP9AS -->

## Why

AI.md § "The Genealogy Is the Protocol (required)": an address a note left "is never given to a second one — a citation somebody wrote down still lands where they meant." On retirement: the note that spent a number taking it back "is what lets somebody carry a graph out of Sloppy and bring it home again with their citations intact", and "a row written before one could say whose it was is a number this graph has used, and nothing more." docs/ARCHITECTURE.md § "The genealogy and the address" names the rows: `node_alias`, one per address left behind, and `retired_address`, whose `note` names the ref the number was purged off and is what `NodeService.claim` lets back.
