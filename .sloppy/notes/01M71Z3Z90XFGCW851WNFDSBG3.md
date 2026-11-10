---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M71Z3Z90XFGCW851WNFDSBG3
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M71Z3Z7G7FW26QJBZ5DEJ0M3
address: 1e12b
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - agents
  - context
  - tooling
title: "Owning the loop: the runner, a provider's key, and when it stops"
created: 2026-11-10T05:32:58.528Z
updated: 2026-11-10T05:32:58.530Z
---

<!-- block 01M71Z3Z91WE623CJS51A71WJV -->

## What it is for

The runner is the benchmark's own loop promoted into Sloppy. [runAgent](code:bench/backends/api.mjs#runAgent) already drives a model through `/v1/messages` with a key, turn after turn ([the loop](code:bench/backends/api.mjs#L261)), and [bridgeMcp](code:bench/backends/api.mjs#bridgeMcp) already hands it Sloppy's tools. Moved into `@sloppy/local` it becomes the thing `sloppy` runs for an ask: compose the window, call the model, apply whatever act it asks for through the one acts implementation in [acts.ts](code:packages/ts/local/src/acts.ts), and go round again. It is [harness.ts](code:packages/ts/local/src/harness.ts), and `sloppy run` in [run.ts](code:packages/ts/cli/src/run.ts) puts an ask to it.

It stops when the model answers with no act asked for; when the budget named at the start — turns, or spend — is spent; or when an act is refused. Every turn is recorded the way the bench records a run, so a session is readable afterwards and replaceable, which is what [the build](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYP9Q5P5RFZ2QPJY36662W) means by "no transcript travels".

The key comes from the environment or the operating system's own keychain and never from a file in the folder. The rule that Sloppy holds no private key ([AI.md](code:AI.md) § "Sloppy's Vocabulary Stays Out of the Identity Store") is about identity and signing; a provider's key is a credential to a service, and it lives where the bench already reads one — `key_env` in [providers.json](code:bench/providers.json).

<!-- block 01M71Z3Z92D1FRVHW77Q79J4Q9 -->

## Why

- The developer, 2026-11-10: "with the api keys and stuff i want sloppy to manage the loops and the context".
- The loop exists and has been measured: the `api` backend is how the bench runs a model that is not an installed agent, so the runner is a move, not an invention, and its first measurement costs wiring rather than design.
- [Building from the notes](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYP9Q5P5RFZ2QPJY36662W): a context "composed for one job" and a hand-off "that keeps every context small and makes a session replaceable" — the runner is that discipline applied to a single ask rather than a build.

<!-- block 01M71Z3Z92CNZPPMSYF6YG57S2 -->

## Candidates

- Whether the app's chat, which today hands its loop to Claude Code ([The chat works on a draft](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYNA3Z9GKJRAR2D2N5XCCV)), moves onto the runner or keeps spawning — decided by the fourth bar, not before it.
- Which acts the runner may apply unasked, and which it offers the way a tool's writing is offered on a note somebody else wrote.
- The name of the command.
