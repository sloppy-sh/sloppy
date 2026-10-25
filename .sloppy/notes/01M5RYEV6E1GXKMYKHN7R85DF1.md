---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYEV6E1GXKMYKHN7R85DF1
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY52DTQZHW4Q1NHXM1VYPQ
address: 1d3
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - identity
  - idp
  - local
  - syr
title: "Sloppy never holds a private key, and the two places that do"
created: 2026-10-25T07:12:34.510Z
updated: 2026-10-25T07:12:34.511Z
---

<!-- block 01M5RYEV6F5BQ9XF4P617H5FBT -->

## What it is for

Everything that CONSUMES an identity signs through the delegation and keeps no key of the person. The API signs content by calling `platform.sign` ([signContent](code:apps/sloppy/api/src/syr/syr.service.ts#signContent)); the identity store holds the delegate key. Somebody who signs in with a key of their own ([key-sign-in.service.ts](code:apps/sloppy/api/src/auth/key-sign-in.service.ts)) keeps it, and Sloppy keeps nothing of theirs and could sign nothing on their behalf.

Two packages are identity stores, and they hold keys for that reason\:

- **`@sloppy/idp`** serves identities rather than consuming them, so it holds what a syr instance holds: today a root seed in an Aegis bundle and a root signature on each delegation ([aegis.ts](code:packages/ts/idp/src/aegis.ts), [delegation.ts](code:packages/ts/idp/src/delegation.ts)); at the target an agent key under a mandate and no root. See [idp: an identity provider Sloppy can embed](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQM4D9SM2KHHHGXQ5WRFSK).
- **`@sloppy/local`** mints a `device` identity on the machine and writes its key to the app's private data ([makeLocalIdentity](code:packages/ts/local/src/identity.ts#makeLocalIdentity), [holdDeviceIdentity](code:packages/ts/local/src/identity.ts#holdDeviceIdentity)), because there is no instance behind it to ask.

## Why

AI.md § "Sloppy's Vocabulary Stays Out of the Identity Store (required)": "Code that wants to sign locally has misread the delegation model." [docs/ARCHITECTURE.md](code:docs/ARCHITECTURE.md) § "Auth: Platform Delegation v0.1" states the consumer side — "the identity store holds the delegate key, so Sloppy never touches a private key" — and § "An API that serves identities itself" says a server holding somebody's root "is exactly what the authority model removes", which is why the embedded provider's root is today's shape and not the target.
