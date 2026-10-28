---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYG00DHCCXDHGD91MEKA8C
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYFJCQCRP07NJ8P1A8N5W5
address: 1g3a
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - agents
  - context
  - vision
title: "Agents writing documentation at scale, and who answers for it"
created: 2026-10-25T07:13:12.205Z
updated: 2026-10-25T07:13:12.207Z
---

<!-- block 01M5RYG00EQFAQQEK1KB4NGW9G -->

## What it is for

Where the notes are the source of truth, a wrong note is a wrong instruction, and an agent can write many of them quickly. This note holds what Sloppy already does about that and what the documents leave open. What a person can rely on today: an agent's writing on a note somebody has written in does not land on it but is offered, and [the offers store](code:packages/ts/app-core/src/lib/stores/offers.svelte.ts) is where its owner takes it in or turns it down; and an agent gives a reason only from a source it names, or writes the open question instead.

<!-- block 01M5RYG00F3NJYEBZY8BMMYK31 -->

## Why

In the thread under the r/ContextEngineering post "Sloppy - Context/Drift-avoidance for humans and agents", the developer put the problem plainly: "my approach treats the documentation as the single source of truth, and i kind of face an accountability problem here atleast if i get agents to do it at scale, not to mention humans make mistakes too obviously, but a mistake here can lead to a lot of loss in the long run." [README.md](code:README.md) § "Documentation-driven development" gives the part Sloppy answers: "writes come back as a change you review, and the agent is held to the same rules as the people — cite what the graph already says, give a reason only from a source you name, and where nothing says why, write the open question down instead of inventing one."

<!-- block 01M5RYG00FN8XR4VY876CCQ8XB -->

## Still open

- Sourcing and review make each write answerable; do they scale to the volume the developer worries about, or does a reviewer reading hundreds of agent-written notes become the next bottleneck? The thread raises the volume and does not answer it.
- How is provenance kept where agents summarise or label groups of notes rather than write one, as the commenter Doc1000 proposed? The developer called that "quite the task".
