---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYE18WJ2AV6KDMKAAA6WDX
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY52DDY8ADPXG2ZWPG96PN
address: 1c1
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - protocol
title: "A note is its ref, and nothing else names it"
created: 2026-10-25T07:12:07.964Z
updated: 2026-10-25T07:20:44.165Z
---

<!-- block 01M5RYE18ZFJW840SAH2NZ9XJ7 -->

## What it is for

A note is identified by its ref, `<principal>/<ulid>`, and by nothing else. [OwnedRefSchema](code:packages/ts/types/src/common.ts#OwnedRefSchema) is that shape: each half is held to its own schema, so a ref is exactly a principal and a ULID and nothing that merely looks like the pair. A link holds a ref; a publication is rooted at one; a pulled region is a copy keyed by them; every route and every lookup in the store keys on one. The address beside a note is a person's label and is never what the system finds a note by — the one lookup that resolves an address is the one a person types.

<!-- block 01M5RYMC4WH3SZDS1T2GKSVSGP -->

## Why

AI.md § "The Genealogy Is the Protocol (required)": "A note is identified by its ref, `<did>/<ulid>`, and by nothing else. That is what a link holds, what a publication is rooted at, what a pulled region is a copy of, and what every lookup on the wire and in the store keys on. Nothing keys a note by its address." docs/ARCHITECTURE.md § "The genealogy and the address" adds that no lookup resolves a note by address "except the one a person types, which is exactly the citation case the address exists for."

That the ref is a string rather than a SurrealDB record link is docs/ARCHITECTURE.md § "Data model" ("A link is a ref, not a SurrealDB record link"): measured on 3.1.3, an index on a column holding a composite record id enforces `UNIQUE` but the planner never chooses it, while the same equality on a string is an index scan.

<!-- block 01M5RYMC4W0P02BYR8G6XG28QK -->

## Still open

AI.md spells the ref `<did>/<ulid>`; docs/ARCHITECTURE.md and the schema spell it `<principal>/<ulid>`, a principal being wider than a DID (§ "Who a person is"). Is AI.md's spelling meant to narrow it, or is it older wording for the same thing?
