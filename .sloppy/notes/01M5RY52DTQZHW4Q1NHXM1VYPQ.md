---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY52DTQZHW4Q1NHXM1VYPQ
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3E2FRSQAYC42VD7G7A1FQ8R
address: 1d
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - identity
  - syr
title: "Identity, and what Sloppy never holds"
created: 2026-10-25T07:07:14.234Z
updated: 2026-10-25T07:17:51.736Z
---

<!-- block 01M5RY52DT5H4RZD9CPP9RQ696 -->

[packages/ts/types/src/syr.ts](code:packages/ts/types/src/syr.ts)

<!-- block 01M5RY52DVK2MGHEXEH8V80MKF -->

## What it is for

Who a person is to Sloppy, and the line between Sloppy's vocabulary and the identity store. [syr.ts](code:packages/ts/types/src/syr.ts) is the one file that speaks syr's wire, as Sloppy consumes it. The notes beneath\:

- [syr keeps the identity, Sloppy keeps the graph](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYD9GG46YXARG0WCYRXF1X) — the table of who owns what.
- [A platform holds a grant, never an identity](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYDVRN7QNAP01DKRA41WJE) — root, agent, grant; what has landed and what is specified only.
- [Sloppy never holds a private key, and the two places that do](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYEV6E1GXKMYKHN7R85DF1), and beneath it [a sealed identity, opened only to sign](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYF51H0CY07YMYJP6Z5VAM).
- [A device holds several identities](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYFKG4H2W31QSWH3125XAY) — `device`, `sealed`, `delegated`, and which one writes.
- [Every remote asset goes through the proxy, save one](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYG0BVSN2966F9S1WQ4DBN), and beneath it [what a graph on disk says about its owner](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYHD4448TGM8JNX0G13EP1).
- [Federation is pull-only, and no instance is a home](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYJ0CW5EYEW3B2SZJV5T0J).
- [Who may write where](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYP0H2KVKMK1W1KT007S0G) — the vouch, the cascade, the verdict.
- [A principal is compared; a did\:syr is dereferenced](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYQS2XVZJARHBPQ1X62KR4), and beneath it [whose a signed row is](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYJYYX33V6A5XV8VV1PPJN).

The embedded provider is [idp: an identity provider Sloppy can embed](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQM4D9SM2KHHHGXQ5WRFSK); the device's store is [local: the graph served off this device](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQM64HRMA4XRJBWT78C951).

<!-- block 01M5RYPPN48SK92WA4EV32M8VN -->

## Why

The file's own header: "These are somebody else's responses. Unknown keys are dropped rather than rejected, so an instance running ahead of us stays readable." AI.md § "Sloppy's Vocabulary Stays Out of the Identity Store (required)" is the rule the whole branch hangs from.
