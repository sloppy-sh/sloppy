---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYENRKJWTH5MQTV9MGH97P
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY52DDY8ADPXG2ZWPG96PN
address: 1c3
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - address
  - data
  - protocol
title: "An address is optional, and unique inside its graph"
created: 2026-10-25T07:12:28.947Z
updated: 2026-10-25T07:15:41.894Z
---

<!-- block 01M5RYENRMXVJM6M447AXY7Y1Q -->

## What it is for

The address is a person's label, read inside one graph the way a page number is read inside a book. A note may hold none, and that is an ordinary note: written with no parent and no address it is an independent note, linked to, published and read like any other. While a note holds an address, no other note in its graph holds the same one; a second graph of the same person, or another person's graph, has its own `1a`.

The database holds that rather than the code around it. `node_owner_graph_address` is UNIQUE, and [the integration test](code:packages/ts/data/src/schema.integration.test.ts#L271-L321) shows a second `3` refused in one graph and accepted in another. Because a UNIQUE index does not constrain a row whose column is absent, [any number of unaddressed notes](code:packages/ts/data/src/schema.integration.test.ts#L323-L361) sit in one graph, while `node.graph` is declared `TYPE string` so no note escapes the index by having no graph. A label is given up by unsetting the column; `NULL` is refused.

<!-- block 01M5RYMJ6697T6EM4J4RVHZA33 -->

## Why

AI.md § "The Genealogy Is the Protocol (required)": "Two notes at `1a` in one graph would be a citation that means two things; two across a person's graphs are two labels, the way two people's `1a`s always were. The database holds that rule rather than the code around it, on our own rows and on the ones a peer hands us." docs/ARCHITECTURE.md § "The genealogy and the address" gives the mechanism: absence "is not a value in" the index, "which is the behaviour this rule wants", measured on 3.1.3.

Why a note needs no address at all is the same section of AI.md: the address "is not a machine identifier and nothing in the system needs one to be there" — see [A note is its ref, and nothing else names it](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYE18WJ2AV6KDMKAAA6WDX).
