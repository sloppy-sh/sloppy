---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYP9Q5P5RFZ2QPJY36662W
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY223B8PSAQ41P43J00M10
address: 1e11
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - agents
  - history
title: "Building from the notes: roles, a line, and the hand-off"
created: 2026-10-25T07:16:38.757Z
updated: 2026-10-25T07:16:38.759Z
---

<!-- block 01M5RYP9Q6TVR0SRTDW9R4CTW3 -->

## What it is for

**Build** takes a note, or a chosen set, and has assistants write the code that answers it. It runs as a LINE of work, `build/<name>` ([buildLine](code:packages/ts/types/src/build.ts#buildLine)), forked from the version the person last kept, and nothing reaches their own line until they bring it in. Each phase is one session with one role — planner, implementer, reviewer, merger — and [toolsForRole](code:packages/ts/types/src/build.ts#toolsForRole) decides which acts it is served. The planner answers only through `plan_build`. An implementer that meets a question the notes do not answer calls `raise_need`, which holds the task and puts the question to the person, who answers it by writing a note. Every session ends with `hand_off`, the only thing passed to the next one. One build stands on a project at a time.

<!-- block 01M5RYP9Q6GCMKRVTEZEPQ7X1T -->

## Why

[docs/ARCHITECTURE.md](code:docs/ARCHITECTURE.md) § "Building from the notes": the notes come first, and this "is the act that runs in that direction" ([Intent-driven development: the note comes first](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYFJCQCRP07NJ8P1A8N5W5)).

- A line rather than a draft, because the project's repository already gives "a real branch … a real merge of the whole tree", so the build "reuses it rather than growing a second vocabulary."
- "No transcript travels": the hand-off "keeps every context small and makes a session replaceable."
- `.sloppy/AGENT.md` § "When asked to build": "A guess written into working code is the one thing no later reader can tell from a decision."

<!-- block 01M5RYP9Q7Z9AHSG2CGRPH1XTT -->

## Decided against

Sub-agents of the assistant's own, in the same section: "a session that spawns its own has a context nobody here can see or bound, and the whole of this design is that every context is composed for one job." And a second build on one project at once: "two answers to one question."
