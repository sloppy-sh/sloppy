---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYEHJY9ZK54N8DZ200WH1D
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY223B8PSAQ41P43J00M10
address: 1e2
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - container
  - vault
title: "Anchors, readings, and drift that is never stored"
created: 2026-10-25T07:12:24.670Z
updated: 2026-10-25T07:13:16.797Z
---

<!-- block 01M5RYEHJZ16PY727KBM0V0HVT -->

## What it is for

A note points at code with an ordinary markdown link, `code:<path>` with `#L12-L20` or `#<symbol>` after it. Two fields say a person has read the note against that code: `checked`, the commit they read it at, and `read_against`, a `{ path, digest }` per place the note points at. Absent is UNREAD, never out of date. Whether the code has moved since is worked out at the moment somebody looks — [driftOf](code:packages/ts/vault/src/drift.ts#driftOf) over what [digestsIn](code:packages/ts/local/src/code.ts#digestsIn) reads of the folder — and written nowhere. Only a person writes either field: no act, no shape a note starts from and nothing arriving invents one.

<!-- block 01M5RYEHK0G89F1ERBH1G273BW -->

## Why

[docs/ARCHITECTURE.md](code:docs/ARCHITECTURE.md) § "A project's container"\:

- The anchor is a link "the vault already carries losslessly … so a note pointing at code is still a file somebody reads on a forge."
- Both fields exist because `checked` "answers the question through a history, which only a folder git is keeping can be asked; a reading of the files answers it wherever the code is open."
- An unknown digest spelling reads as unread, because "saying a file has moved because a spelling changed is worse than saying nothing."
- "A reading is somebody saying they read the note against the code as it stands, so no act of a tool's writes one."

`.sloppy/AGENT.md` § "Never write": writing either "would silence the app's line about code that has moved under them."

<!-- block 01M5RYEHK1N5R9DEXH0QCRK7YM -->

## Still open

The same section carries a TODO: the hosted import still names `checked` alone, so does a reading arriving from a folder into the hosted store get dropped until it names both?
