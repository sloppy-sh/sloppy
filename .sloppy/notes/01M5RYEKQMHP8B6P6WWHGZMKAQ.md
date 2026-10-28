---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYEKQMHP8B6P6WWHGZMKAQ
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY52E418RCHFJ1F3N1JSHG
address: 1f2
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - design
  - product
title: "Copy names the outcome, never the mechanism"
created: 2026-10-25T07:12:26.868Z
updated: 2026-10-25T07:12:26.869Z
---

<!-- block 01M5RYEKQNGVRWVKF73K51X64T -->

## What it is for

Every word that reaches a person — the app, an empty state, a notification, the message on a thrown error — says what happened and what they can do next, and never how Sloppy is built. No infrastructure nouns, no internal identifiers, no wire enum values. The Folgezettel address is the one exception, because it is a part of the product a person cites, not a part of the machinery.

In the code the rule has one carrier for errors: a host rejects with a [Refusal](code:packages/ts/ui/src/lib/refusal.ts#Refusal) where it has words written for a person, and [refusedWith](code:packages/ts/ui/src/lib/refusal.ts#refusedWith) shows those words or the surface's own line about what to try — never the inside of an error.

## Why

AI.md § "User-Facing Copy Names the Outcome, Never the Mechanism": naming the mechanism "hands the reader a fact they cannot act on and did not ask for", and copy that describes today's implementation "is wrong the day the implementation changes, and nothing fails when it does." Its test: "would this sentence still be true, and still worth saying, if we rebuilt the whole thing behind it tomorrow?"

DESIGN.md § "Show, don't tell (copy)": "The interface demonstrates; it never narrates its own mechanics" — the new note's address appears on the mark the moment it is made, and the author of a pulled region is named across the top of it rather than in a tooltip about federation.

The same section of AI.md keeps what the rule never trims: a consequence that is really the reader's — that publishing makes a branch readable by anyone with the address — and all privacy, legal and safety disclosure.
