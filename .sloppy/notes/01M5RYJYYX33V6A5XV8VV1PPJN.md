---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYJYYX33V6A5XV8VV1PPJN
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYQS2XVZJARHBPQ1X62KR4
address: 1d8a
aliases:
  - 1c1a
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - federation
  - identity
  - signing
title: "Whose a signed row is: theirs, unattributed or refuted"
created: 2026-10-25T07:14:49.437Z
updated: 2026-10-25T07:17:32.977Z
---

<!-- block 01M5RYJYYY2K1B0CAG4K469S6F -->

## What it is for

Two halves let a reader say "written by Alice" and mean it. [KeyBinding](code:packages/ts/types/src/key-binding.ts#bindingFor) answers which key speaks for a principal right now, one implementation per scheme reached through `bindingFor`: syr answers from the identifier itself with a key that `signs: "delegations"`, and `mailto:` asks Web Key Directory then a keyserver for one that `signs: "content"`. Only a content key counts. [attribution.ts](code:apps/sloppy/api/src/identity/attribution.ts) is where the halves meet, and it answers in three\:

- **`theirs`** — the signature checks out under a key that author holds.
- **`unattributed`** — it checks out, and nobody has been shown to hold the key: an instance that did not answer, no published key, a key rotated away.
- **`refuted`** — the row does not say what it was signed saying, the only thing a copy is destroyed over.

Keys are asked for once per author, never once per note, and only where something on the page carries a signature. A reader is told one line for an unattributed note and nothing for an unsigned one.

## Why

[docs/ARCHITECTURE.md](code:docs/ARCHITECTURE.md) § "Whose a signed row is": "neither unreachability nor staleness is refutation", because "a reader who dropped a note over a key its author retired would cost that author their words for rotating one"; and per-row asks "would aim this instance at a stranger's network once per note". § "Which key speaks for a principal" says why holding a syr root settles nothing: it "stands behind the keys that sign content rather than signing any".

## Still open

`signature_scheme` is absent on every comment, syr's comment record having no such column. Will syr carry one?
