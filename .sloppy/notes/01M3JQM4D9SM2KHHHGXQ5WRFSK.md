---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQM4D9SM2KHHHGXQ5WRFSK
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQGKYNV7HMP3611A245MPN
address: 1b7
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - identity
  - idp
title: "idp: an identity provider Sloppy can embed"
created: 2026-09-28T00:46:17.513Z
updated: 2026-09-28T00:46:17.516Z
---

<!-- block 01M3JQM4DBSY5EY7PRQDA6KX8G -->

[packages/ts/idp](code:packages/ts/idp)

<!-- block 01M3JQM4DCTP3CKCQP8A0AHQ6K -->

## What it is

`@sloppy/idp` implements syr's side of sign-in: its wire contracts, its crypto and an identity store. With it, the API can serve identities itself, so Sloppy runs with no syr instance anywhere. It is one of the two places in Sloppy that holds a person's key, because it serves identities rather than consuming them.

## Where to start

- [contracts.ts](code:packages/ts/idp/src/contracts.ts): syr's wire shapes.
- [identity.ts](code:packages/ts/idp/src/identity.ts), [keys.ts](code:packages/ts/idp/src/keys.ts), [aegis.ts](code:packages/ts/idp/src/aegis.ts): identities and the bundle a root seed is kept in.
- [delegation.ts](code:packages/ts/idp/src/delegation.ts): the signed delegation a platform receives when somebody signs in.
- [sealing.ts](code:packages/ts/idp/src/sealing.ts), [secrets.ts](code:packages/ts/idp/src/secrets.ts): keys kept shut under a passphrase.
- [manifest.ts](code:packages/ts/idp/src/manifest.ts), [emojis.ts](code:packages/ts/idp/src/emojis.ts), [follows.ts](code:packages/ts/idp/src/follows.ts): what else an identity carries.

\[syr integration\](code\:docs/ARCHITECTURE.md#syr integration) is the doc of record.
