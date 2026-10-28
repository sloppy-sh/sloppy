---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYJX56ZXH6B7QJFEFWHHTY
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY52E418RCHFJ1F3N1JSHG
address: 1f9
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - design
  - identity
title: "The profile on a device, and the one line a linked picture earns"
created: 2026-10-25T07:14:47.590Z
updated: 2026-10-25T07:14:47.591Z
---

<!-- block 01M5RYJX57HVAJ5DH37PRGKF0G -->

## What it is for

"You" draws the same parts whether a Sloppy serves the graph or this device keeps it: the banner, the picture over its lower edge, the name, a line or two about the person, and Edit beside them ([profile.svelte](code:packages/ts/app-core/src/lib/pages/profile.svelte)). Edit offers each picture two ways — choose a file, which the folder keeps and carries, or paste an `https://` link ([person-editor.svelte](code:packages/ts/ui/src/lib/components/identity/person-editor.svelte)). Under the link field sits one help line: "Whoever opens this folder loads this picture from that address." A link that does not load draws the plain band and the plain disc, and nothing announces it. Where a Sloppy serves the graph there is no link field at all.

## Why

DESIGN.md § "The profile page": "A graph kept on a device is not a lesser profile: the folder carries all of it." The help line "changes what somebody would choose — they can choose a file instead — and nothing more about it is theirs to know", and "a control that can only be refused is not offered."

AI.md § "Sloppy's Vocabulary Stays Out of the Identity Store" makes the linked picture the one exception to proxying every remote asset: "whoever opens that folder loads it from where it lives, and the profile page says so"; a served graph refuses one. That line is AI.md § "User-Facing Copy Names the Outcome, Never the Mechanism" applied: a consequence that is the reader's, stated once, not a dialog and not a warning colour ([Copy names the outcome, never the mechanism](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYEKQMHP8B6P6WWHGZMKAQ)).
