---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYHJHSAJZ7TQBX6M5ZXPRR
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY223VP87JR883A1C2HA7K
address: 1g5
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - agents
  - context
  - mcp
  - vision
title: "The token economy: enough micro-context, and no more"
created: 2026-10-25T07:14:03.961Z
updated: 2026-10-25T07:28:36.873Z
---

<!-- block 01M5S0A1A1A1A1A1A1A1A1A1A1 -->

## What it is for

Sloppy exists to spend fewer tokens, not more. Somebody working on one part of a project, a person or an agent, should take in exactly the notes that part needs, read them once and act, instead of re-reading a repository or re-explaining it to every model they bring in. The graph is that budget made visible: a note is small, placed under what it sprang out of, tagged with its system and anchored to its code, so what an agent takes in is the neighbourhood of the thing it is working on and not the whole field ([AI.md](code:AI.md) § "Project").

<!-- block 01M5S0A2A2A2A2A2A2A2A2A2A2 -->

## Why

The developer's account of re-explaining a codebase to every agent is [Context declared once, instead of re-explained to every agent](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYGJV2X9VS85GRDSV39A28). On the budget itself, in the r/ContextEngineering thread under the post "Sloppy - Context/Drift-avoidance for humans and agents": "I have been building this solo and I don't have the token budget to be able to ask it to do that, and I know that the people who are supposed to fix this problem (Anthropic, OpenAI) etc. won't because us wasting tokens is what makes them money." And on 2026-10-25, asking for this graph: the project is for "limiting token use while providing the models enough micro context to be able to perform the delegated task well".

<!-- block 01M5RYHJHT0BEDKZ683R6JC1VF -->

## Still open

- The developer proposed "some sort of sliding window for the context the agents fetch while working on a given task, allowing it to fetch nodes up to, say n hops away from the main node it needs to work on." Today an agent lists every note or reads one; should there be an act that reads a note and its neighbourhood to a given depth, and is the depth set by the task, the agent or the person?
- The same comment suggests pairing the window "with some sort of indexing/cache system which further reduces the amount of tokens wasted per documentation node in the graph." Would that be a summary kept per note, and if so who writes it, and how is it kept true when the note changes?
- The developer expects the answer "would have to be a combination of a lot of independent pieces of work", and that "a simple graph" is "the start not the end". Which pieces does Sloppy own, and which does it leave open to integrate with?
