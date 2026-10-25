---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYJ0CW5EYEW3B2SZJV5T0J
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY52DTQZHW4Q1NHXM1VYPQ
address: 1d6
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - federation
  - identity
  - protocol
title: "Federation is pull-only, and no instance is a home"
created: 2026-10-25T07:14:18.140Z
updated: 2026-10-25T07:14:18.141Z
---

<!-- block 01M5RYJ0CXANCGM1HH04HEQSZ6 -->

## What it is for

There is no relay and no firehose: follow somebody, find where their writing is served, fetch the kind you want from there. **No identifier names a place**, a `did:syr` included, so where a person's graph is served is their own declaration to make and to move. [Whereabouts](code:packages/ts/types/src/whereabouts.ts#WhereaboutsSchema) is that fact — whose graph, the domain they say is theirs, the instance they say answers — served as one [document](code:packages/ts/types/src/whereabouts.ts#WhereaboutsDocumentSchema) at `/.well-known/sloppy-whereabouts/<principal>` and held to its own subject by [parseWhereabouts](code:packages/ts/types/src/whereabouts.ts#parseWhereabouts).

It is asked in order ([whereabouts.ts](code:apps/sloppy/api/src/peer/whereabouts.ts)): a domain they control first; else the instance named beside the identifier, serving the declaration its subject wrote there — the lesser of the two, and never a host to file somebody under. A domain named by what an instance served is asked once and never followed further. Every fetch either leads to goes through `remote-host.ts`.

What stands today: the resolver, the routes that serve and write a declaration, and public publication routes that take a principal. No screen writes a declaration yet; somebody's whereabouts are said through `PUT /api/whereabouts`.

## Why

AI.md § "Sloppy's Vocabulary Stays Out of the Identity Store (required)": changing instance "costs them one edit and breaks nobody's link"; "anything that treats one host as the identity's home has assumed something the protocol never promises." [docs/ARCHITECTURE.md](code:docs/ARCHITECTURE.md) § "Where a person's graph is" holds the order and why a declaration about somebody else is refused: it "would send a reader wherever the server liked". § "Federating the graph" gives syr's pull-only shape.

## Decided against

Anything designed around a push feed — AI.md calls it "designed against the platform".
