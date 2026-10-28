---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYGY02TFXDAD08HJ7ZQKPC
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYGJV2X9VS85GRDSV39A28
address: 1g4a
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - container
  - context
  - vision
title: Context kept beside the code is versioned with it
created: 2026-10-25T07:13:42.914Z
updated: 2026-10-25T07:13:42.916Z
---

<!-- block 01M5RYGY04BXZWH31S7KZR7832 -->

## What it is for

The notes are files in the repository, so they travel with the code: a decision is saved in the same commit as the change that prompted it, a colleague reads the same notes out of the same checkout, and an earlier version of the project carries the notes it was written against. [CONTRIBUTING.md](code:CONTRIBUTING.md) § "This repository's own notes" is this repository doing it: its reasoning is in `.sloppy/`, and what an assistant writes there "is reviewed in the diff with the rest of the change." How a folder holds that is [The graph beside the code, and the tools that write it](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY223B8PSAQ41P43J00M10).

<!-- block 01M5RYGY04VZS50FQDBE7NBVG1 -->

## Why

[PRODUCT.md](code:PRODUCT.md) § "Users", on the developer: "the notes live in the project, they point at the files and the names they are about, and they are saved in the same commit as the change that prompted them." [README.md](code:README.md) § "Where it went" names what it replaces: reasoning kept "in a document that stopped being true a year ago". In the thread under the r/ContextEngineering post "Sloppy - Context/Drift-avoidance for humans and agents", the commenter End0rphinJunkie put the same case: keeping context in the repo "ensures your architectural docs get versioned right alongside the code changes instead of slowly drifting in a detached wiki somewhere."
