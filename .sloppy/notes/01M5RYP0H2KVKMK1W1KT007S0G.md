---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYP0H2KVKMK1W1KT007S0G
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY52DTQZHW4Q1NHXM1VYPQ
address: 1d7
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - identity
  - permissions
title: "Who may write where, and whether anybody stands behind them"
created: 2026-10-25T07:16:29.346Z
updated: 2026-10-25T07:16:29.348Z
---

<!-- block 01M5RYP0H30NSMHMP5B59VMHWJ -->

## What it is for

Whether a graph lets a write through at all, before a note's own gate decides what it does. Three pieces\:

- **A vouch.** Resolving an identity answers `vouched`, `anonymous` or `unknown`, starting only from an address this reader already trusts. `unknown` grants nothing and takes nothing away; [standingVouch](code:packages/ts/types/src/vouch.ts#standingVouch) turns it back into the last settled answer. `Graph.vouching` is `optional` or `required`, absent `optional`, and a graph never holds its own owner to it.
- **The cascade.** Graph, then note. Somebody a graph is not kept for holds nothing; for everybody else [resolvePermissionFold](code:packages/ts/types/src/permission.ts#resolvePermissionFold) folds roles and overrides over `DEFAULT_PERMISSIONS`, and the owner holds every verb. [permission.test.ts](code:packages/ts/types/src/permission.test.ts) holds the fold to that.
- **The verdict.** [writeDecision](code:packages/ts/types/src/authority.ts#writeDecision) answers lands, offered or refused, the note's gate and the graph's policy in one place.

**Nothing holds a write to any of this yet**: the vocabulary, the evaluator, the rows and the resolver are here, and `gate.ts` still asks `writeOutcome` alone.

<!-- block 01M5RYP0H4C1V94X9YX4WCM37W -->

## Why

[docs/ARCHITECTURE.md](code:docs/ARCHITECTURE.md) § "Whether anybody stands behind an identity": syr serves its listing unsigned, so "there is no word for an address that arrived with a DID from a peer" — adding one "would be deciding that a principal may name its own voucher" — and "an instance having a bad afternoon is not a statement about anybody". § "The cascade": a graph nobody wrote a policy on "is therefore closed to a stranger, not open to one", and a bit's position "is written once and never moved" because renumbering "would silently re-grant every role already written". § "Who may write where": a graph with none of this written on it behaves exactly as every graph did before.

<!-- block 01M5RYP0H4SXR25M54G0EA0FX9 -->

## Still open

Which sites will call `writeDecision`, and in what order do they land?
