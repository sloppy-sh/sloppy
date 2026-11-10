---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M71Z3Z7G7FW26QJBZ5DEJ0M3
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY223B8PSAQ41P43J00M10
address: 1e12
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - agents
  - context
  - mcp
  - tooling
title: "Sloppy as the harness: the window composed from the graph, then the loop"
created: 2026-11-10T05:32:58.480Z
updated: 2026-11-10T05:32:58.594Z
---

<!-- block 01M71Z3Z7JY16FPFX9MY933G5Q -->

[packages/ts/local/src/harness.ts](code:packages/ts/local/src/harness.ts)

<!-- block 01M71Z3Z7KCR32SYFCG21YRYMV -->

## What it is for

Today Sloppy is a server an agent calls ([An assistant outside the app: no gate, and git is the review](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYNW6ZXXC86P7QZY22XTV2)). The agent owns the loop and chooses what to read, one tool at a time, from [CORE](code:packages/ts/types/src/chat-served.ts#CORE_CHAT_TOOLS)[_CHAT_](code:packages/ts/types/src/chat-served.ts#CORE_CHAT_TOOLS)[TOOLS](code:packages/ts/types/src/chat-served.ts#CORE_CHAT_TOOLS). A harness owns both ends of that: what the model sees, and what happens next. This decides that Sloppy becomes one, in this order — first the **window**, composed from the graph by rules Sloppy holds, to a budget; then the **loop**, run by Sloppy against a model reached with a provider's key; and the same window pushed into Claude Code, whose loop stays its own.

The one thing nothing else in the agent's reach can do is compose the window from the genealogy: the note whose title and sections best answer the ask, the chain it sprang from, the notes beside it in its tags, the code its anchors point at — so the model reads and acts instead of fishing a call at a time. Everything else here is the plumbing that puts that window in front of a model.

<!-- block 01M71Z3Z7MS8MWCHHT4YJT1RWQ -->

## Why

- The developer, here, on 2026-11-10: "with the api keys and stuff i want sloppy to manage the loops and the context, and with claude code too if possible … i want to be able to call it a harness."
- The same ask from October, already held in [A brief is composed at read time, to a budget](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5SNJDYM3KH9Q6M471XY6BF4): Sloppy "gives you the indexed/cached context as required", in "optimal context windows so that they produce best results as we know that agent output goodness falls when the context increases". [The token economy](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYHJHSAJZ7TQBX6M5ZXPRR) left open "which pieces does Sloppy own, and which does it leave open to integrate with?" This is the answer: the window and the loop are Sloppy's; the model is not.
- [bench/WHERE-SLOPPY-HELPS.md](code:bench/WHERE-SLOPPY-HELPS.md) § "What doesn't help": a tool answering "where in the code is this?" was offered in 60 runs and used once — "agents rely on what their first call returns, not on extra tools." Pushing the window removes the choice rather than adding one more thing to call.
- [bench/SURVEY.md](code:bench/SURVEY.md) § "Where the gain is, by what the task asks": Sloppy pays on \*why\* (+0.046) and \*handoff\* (+0.037), nothing on \*locate\*, and loses on \*brief\* (−0.042) because the agent works from excerpts of several notes where one document whole would have served. A window composed to a budget is aimed at exactly that loss.

<!-- block 01M71Z3Z7NNFC7VRN9PGCNX522 -->

## Decided against

- **More tools.** The 60-runs-once figure above, and the developer on 2026-11-10 asking for Sloppy to "manage the loops and the context" — not to offer more things an agent may or may not call.
- **Sub-agents of Sloppy's own**, already ruled out in [Building from the notes: roles, a line, and the hand-off](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYP9Q5P5RFZ2QPJY36662W): "a session that spawns its own has a context nobody here can see or bound, and the whole of this design is that every context is composed for one job." The harness composes one window per job and spawns nothing.

<!-- block 01M71Z3Z7PXY8J2PMZHJK2FR6H -->

## Candidates

- Whether the window ships first and is measured on its own before the loop follows, or both together. The fourth bar below can tell them apart only if the window exists without the loop.
- A summary kept per note, which [The token economy](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYHJHSAJZ7TQBX6M5ZXPRR) asks about — who writes it and how it stays true. Not part of this: the window is composed from what the notes already say.

<!-- block 01M71Z3ZB269VTE38NKFDAM7PA -->

## Where this sits

north: [[did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYHJHSAJZ7TQBX6M5ZXPRR]]
south: [[did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M71Z3Z8BAGKH20DJV4PKAA98]] [[did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M71Z3Z90XFGCW851WNFDSBG3]] [[did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M71Z3Z9PHK79DCSTHGFC76Y4]] [[did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M71Z3ZAA2FAE9YGWTTMY58DR]]
east: [[did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYP9Q5P5RFZ2QPJY36662W]]
