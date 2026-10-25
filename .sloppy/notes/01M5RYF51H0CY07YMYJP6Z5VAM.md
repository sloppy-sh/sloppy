---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYF51H0CY07YMYJP6Z5VAM
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYEV6E1GXKMYKHN7R85DF1
address: 1d3a
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - identity
  - idp
  - local
title: A sealed identity is kept as it arrived and opened only to sign
created: 2026-10-25T07:12:44.593Z
updated: 2026-10-25T07:12:44.594Z
---

<!-- block 01M5RYF51JD6ZGMEG9YANMB87B -->

## What it is for

An identity brought onto a device **sealed** is kept exactly as it arrived, shut under a passphrase this device does not have. The public key is on the outside of the file, so the DID, the name on the row and who writes here need nothing asked of anybody. The seed comes out only for an act that must sign with it: the passphrase is asked at that moment and the seed is wiped after ([withSigilSeed](code:packages/ts/idp/src/sigil.ts#withSigilSeed)). Carrying one to another device hands over the sealed file as it stands, and this device never writes the key down in the clear.

The file's format is `@sloppy/idp`'s business alone: [sigil.ts](code:packages/ts/idp/src/sigil.ts) reads and writes syr's portable format, the same construction as Aegis and reproduced byte for byte so a file written here opens on a syr instance. Nothing above that package names a format.

Nothing in local mode signs today — an identity names whose graph a note is in and no more — so nothing asks for the passphrase at all yet.

## Why

AI.md § "Sloppy's Vocabulary Stays Out of the Identity Store (required)": "A sealed key is not a key this device can use, and it is no exemption: nothing else here keeps a private key at rest, sealed or otherwise." [docs/ARCHITECTURE.md](code:docs/ARCHITECTURE.md) § "A graph off the device" keys the identity's `source` on whether the key is usable here, "never on which product keeps it or which file it arrived in", following AI.md § "Provider-Agnostic Data Shapes (required)".

## Still open

Which act will be the first in local mode to sign with a sealed seed, and so the first to ask for the passphrase?
