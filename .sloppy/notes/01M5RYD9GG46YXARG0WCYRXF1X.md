---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYD9GG46YXARG0WCYRXF1X
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY52DTQZHW4Q1NHXM1VYPQ
address: 1d1
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - identity
  - protocol
  - syr
title: "syr keeps the identity, Sloppy keeps the graph"
created: 2026-10-25T07:11:43.632Z
updated: 2026-10-25T07:11:43.635Z
---

<!-- block 01M5RYD9GK35CGFV5JPWZD9F77 -->

## What it is for

The line between what syr owns and what Sloppy owns. syr holds the identity, its DID, keys and signing; the profile, resolved from the identity and cached; media blobs, uploaded presign → PUT → complete; emoji, stickers, reactions and comments as per-DID catalogs; and who somebody follows. Sloppy's own API and SurrealDB hold graphs, nodes, addresses, tags, blocks and ink. `graph`, `node` and `block` are never records in anybody's identity store: a feature that seems to need a new record type in syr needs a table in Sloppy instead.

[SyrService](code:apps/sloppy/api/src/syr/syr.service.ts#SyrService) is where the API reaches syr's side of the line — [identityManifest](code:apps/sloppy/api/src/syr/syr.service.ts#identityManifest) reads `/.well-known/syr/{did}` from the instance a person signed in against — and [syr.ts](code:packages/ts/types/src/syr.ts) is the one file that speaks syr's wire.

## Why

syr has no lexicon system and no extension point for third-party record types, and its own comparison document names that as a feature: "third-party repo pollution: structurally prevented; apps don't write into your identity store." So the split "is not a preference we could revisit; it is the shape syr enforces" — AI.md § "Sloppy's Vocabulary Stays Out of the Identity Store (required)". [docs/ARCHITECTURE.md](code:docs/ARCHITECTURE.md) § "The constraint that shapes everything" carries the table, and names it the same split Slyng made.

## Still open

AI.md's table leaves out "Who somebody follows", which the table in docs/ARCHITECTURE.md gives to syr. Is the follow list syr's in both documents?
