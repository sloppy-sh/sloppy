---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQM4ZNKWBGXW918HZ724C0
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQGKYNV7HMP3611A245MPN
address: 1b8
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - identity
  - openpgp
title: "openpgp: checking an OpenPGP signature"
created: 2026-09-28T00:46:18.101Z
updated: 2026-09-28T00:46:18.104Z
---

<!-- block 01M3JQM4ZPFWY2SAQ5GHTJ2P6W -->

[packages/ts/openpgp](code:packages/ts/openpgp)

<!-- block 01M3JQM4ZRM53TQBB0JQEN5EGB -->

## What it is

`@sloppy/openpgp` is the adapter for OpenPGP, and the only package in Sloppy that speaks it. It verifies a signature and finds the key a person published for an email address.

- [verify.ts](code:packages/ts/openpgp/src/verify.ts): checking a signature.
- [wkd.ts](code:packages/ts/openpgp/src/wkd.ts), then [keyserver.ts](code:packages/ts/openpgp/src/keyserver.ts): finding a key, first at the address's own domain and then at a keyserver.
- [binding.ts](code:packages/ts/openpgp/src/binding.ts), [keys.ts](code:packages/ts/openpgp/src/keys.ts): tying a key to the person it speaks for.

\[Who a person is\](code\:docs/ARCHITECTURE.md#Who a person is) is the doc of record.
