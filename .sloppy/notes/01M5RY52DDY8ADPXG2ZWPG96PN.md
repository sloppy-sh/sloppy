---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY52DDY8ADPXG2ZWPG96PN
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3E2FRSQAYC42VD7G7A1FQ8R
address: 1c
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - genealogy
  - protocol
title: "The protocol: what every peer reads the same way"
created: 2026-10-25T07:07:14.222Z
updated: 2026-10-25T07:16:57.100Z
---

<!-- block 01M5RY52DGZ91EY3F5CDWF4FD9 -->

[packages/ts/local/src/addressing.test.ts](code:packages/ts/local/src/addressing.test.ts)

<!-- block 01M5RY52DHJBPR5X1GVX4RSYKC -->

## What it is for

The rules a peer somewhere is relying on: what every copy of a graph reads the same way, and what a person citing one can count on. Each note beneath states one rule and the reason the documents give for it.

- What a note is: [A note is its ref, and nothing else names it](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYE18WJ2AV6KDMKAAA6WDX), and [Whose graph a note is in, and whose writing it carries](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYNRBZCHVW54BEZ2Z6XMQP).
- The genealogy: [The genealogy is the agreement; the shape is derived from it](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYEBG1VZN59D2QV9Z3M772), with `depth` the one stored exception, and [One order within a run, in one function](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYM2YP6SJM1TNYE3T350XT).
- The address, a person's label: [An address is optional, and unique inside its graph](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYENRKJWTH5MQTV9MGH97P); [The Folgezettel rule suggests an address, deterministically](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYF32TJQ4169BY0JH488AF); [A person writes the label, or a tool they set to work does](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYFFDFDDQF0589B590M1J1); [Every address a note has carried keeps leading to it](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYFV2A62SMND011DAEYC75); [A note in the bin holds its address until somebody asks for it](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYG8BH8TDYRF7FZZ3RP44K); [A move re-addresses into the run it joins](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYGK7GFKM2W4EPRZK1TF44).
- A note's interior: [A block is a section a person adds on purpose](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYP1R6S4JB91BTNMS3W06D).

[addressing.test.ts](code:packages/ts/local/src/addressing.test.ts) is the rule held on a device: a graph on this device and a peer holding nothing but addresses replay the same generated acts and must assign byte-identical addresses, never one twice.

<!-- block 01M5RYPVMBJAYX6GC4AA4NNAXQ -->

## Why

AI.md § "The Genealogy Is the Protocol (required)": "Everything else in Sloppy is an implementation detail that can be replaced. What a note sprang out of cannot, because a peer somewhere is holding a copy of that shape. Once a subtree has been published and pulled, the genealogy inside it is load-bearing on machines we do not control and cannot migrate." The same section is why every rule here is held apart from ordinary work: "A change to these rules is a protocol break, and is treated as one. It does not land inside a feature commit. If implementation shows a rule is wrong, stop and say so."

<!-- block 01M5RYPVMCJFPJMDX22A3ABAT9 -->

## Still open

AI.md § "Match the Machinery to the Change" reserves its full review loop for "the address protocol … anything a peer will hold". Neither document says what a protocol break, once agreed, does for the peers already holding the old shape: is there a version a peer reads, or does every rule here have to stay readable by every copy forever?
