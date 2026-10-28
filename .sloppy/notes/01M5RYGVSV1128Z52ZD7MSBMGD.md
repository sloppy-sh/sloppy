---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYGVSV1128Z52ZD7MSBMGD
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY52E418RCHFJ1F3N1JSHG
address: 1f5
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - canvas
  - genealogy
  - sets
title: "The readings: a tree that folds, and tags that light rather than filter"
created: 2026-10-25T07:13:40.667Z
updated: 2026-10-25T07:14:04.951Z
---

<!-- block 01M5RYGVSWQ30XMRKGCX273DSX -->

## What it is for

The same notes are seen three ways, chosen by one control that stands beside the graph's name in every view ([SEEN\_AS](code:packages/ts/app-core/src/lib/stores/prefs.svelte.ts#SEEN_AS)): the graph, the outline, and Sets.

The graph is the genealogical tree. A subtree away from where the reader stands folds into one mega-node sized by what it holds, and tapping it moves the focus there and opens it ([lod.test.ts](code:packages/ts/graph/src/lod.test.ts)). Selecting tags lights the notes that carry them and dims the rest along with the tree's lines; nothing leaves the canvas. The outline is the same graph as a keyboard-navigable list — addresses, titles, tags, parent and children — kept in step with the canvas. Sets is the third: [Sets is an arrangement of the one canvas](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYH5XNF06KTDP5HFKS9345).
