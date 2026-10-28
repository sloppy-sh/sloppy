---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYFKG4H2W31QSWH3125XAY
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY52DTQZHW4Q1NHXM1VYPQ
address: 1d4
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - identity
  - local
title: "A device holds several identities, each saying where it came from"
created: 2026-10-25T07:12:59.396Z
updated: 2026-10-25T07:12:59.397Z
---

<!-- block 01M5RYFKG5DCXNRASBXWVH007R -->

## What it is for

With no API, the device is its own platform. Its private data holds a list of identities, each a DID, its public key and a `source` ([IdentitySourceSchema](code:packages/ts/types/src/identity.ts#IdentitySourceSchema))\:

- **`device`** — made here with nothing asked, the key in a file in the app's private data, with no password over it.
- **`sealed`** — [kept shut and opened only to sign](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYF51H0CY07YMYJP6Z5VAM).
- **`delegated`** — kept by an identity store elsewhere and reached through Platform Delegation, which the app performs itself; no private key is on the device, and what it holds is a [grant](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYDVRN7QNAP01DKRA41WJE).

The first run and Settings offer the same three doors. Which identity writes is [whoWrites](code:packages/ts/local/src/identity.ts#whoWrites): the graph's owner where this device holds it, otherwise one chosen here, writing as a contributor; switching changes nothing already written. A token that lapses leaves the identity held — "the DID is a fact, not a permission". In a tab that opens a folder beside a served graph, the writer is the signed-in account's DID or a device identity minted into the browser's storage. The tests here are [identity.test.ts](code:packages/ts/local/src/identity.test.ts).

## Why

[docs/ARCHITECTURE.md](code:docs/ARCHITECTURE.md) § "A graph off the device": the source is keyed on "whether the key is usable here", "so a key manager nobody has written yet is a value here and not a field" (AI.md § "Provider-Agnostic Data Shapes (required)"). There is no password over a `device` key "because there is nothing a password would protect it from that reaching the file would not already have defeated." § "A graph on this device, beside the one a Sloppy serves" settles the tab's writer.

See [local: the graph served off this device](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQM64HRMA4XRJBWT78C951) for the package.
