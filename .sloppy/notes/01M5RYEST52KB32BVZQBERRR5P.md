---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYEST52KB32BVZQBERRR5P
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY223VP87JR883A1C2HA7K
address: 1g2
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - genealogy
  - sets
  - vision
title: "Different views, same information"
created: 2026-10-25T07:12:33.093Z
updated: 2026-10-25T07:12:33.096Z
---

<!-- block 01M5RYEST6NP1CSW2NCJ3W2TY1 -->

## What it is for

One graph is read more than one way, and every reading is of the same notes. The genealogy says what each note sprang out of and carries the Folgezettel address a person walks it by; the tags cut across it, and [the tag store](code:packages/ts/app-core/src/lib/stores/tags.svelte.ts#TagsState) is what the canvas is lit by when somebody selects some. [README.md](code:README.md) names the three readings that result: Graph for "How did this come to be?", Outline for "Let me work.", and Sets for "What belongs together?", where tags are drawn as overlapping places the notes stand in.

What a person can rely on: switching reading changes the question asked of the notes, never the notes. How each reading is drawn is [The look, and the readings of the graph](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY52E418RCHFJ1F3N1JSHG).

<!-- block 01M5RYEST7BGHRSVPJ4W31SSE9 -->

## Why

In the r/ContextEngineering post "Sloppy - Context/Drift-avoidance for humans and agents", the developer gives both halves. For the sets: "often in code we work with abstractions and within my head I often imagine, say methods/properties in objects and their interactions as a Venn diagram so I added that sort of view here with a tagging api." For the addresses: a graph view is "very helpful for someone making the graph themselves/co-authoring but very difficult to comprehend for someone who might be new to it", so the Folgezettel addressing helps "transform the graph more into a tree of organized and easily traversable information." The post sums it up as "Different views, same information."

<!-- block 01M5RYEST8TV1WXF1DCQP7ZW9Q -->

## Decided against

The same post finds docusaurus, Obsidian and Logseq "too geared towards either a linear reading style or graph like view of information", each one paradigm alone.
