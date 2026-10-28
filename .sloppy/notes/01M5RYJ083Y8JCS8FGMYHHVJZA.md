---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYJ083Y8JCS8FGMYHHVJZA
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY52E418RCHFJ1F3N1JSHG
address: 1f6
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - canvas
  - design
  - product
title: "Phone first; a desk is the same parts stood beside the graph"
created: 2026-10-25T07:14:17.987Z
updated: 2026-10-25T07:14:17.988Z
---

<!-- block 01M5RYJ0846E2NVNKG3DTRKSR4 -->

## What it is for

Every surface is designed at phone width and then given room. Two arrangements of the same parts, and the dock width decides which: over the canvas, a pill of destinations at the foot and a card at the top holding the graph you are in, the row that writes and the tags; beside the canvas, one column down the leading edge holding those same parts. Neither has a part the other lacks. The crossing is a class, never a branch around the page, so the canvas keeps its pan and zoom. What stands beside the graph is [SideDock](code:packages/ts/ui/src/lib/components/side-dock.svelte): docked at the wide width, a full-height sheet below it, from one bound `open`.

Dialogs follow the same rule. [ResponsiveModal](code:packages/ts/ui/src/lib/components/responsive-modal.svelte) is the only modal — a drag-to-dismiss bottom sheet on a phone, a centred dialog from 640px, its branch latched for the component's life — and shadcn-svelte is the component vocabulary wherever a component fits ([ui: the design system and the component vocabulary](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQM2QYVQ32970GDSVHCWV2)).

## Why

AI.md § "Project": "mobile and tablet are the primary surface. Desktop is the same parts given room … never a third layout, and never a part the phone lacks or one it has to do without." AI.md § "Design & Product": "An affordance only one of those arrangements has is a bug report against the phone layout", and "Don't add a second modal component; extend this one."

DESIGN.md § "Layout": a per-arrangement branch "would destroy and remount it on every crossing, taking the reader's pan and zoom with it"; the dock's branch is fixed while something is open so "a rotation mid-edit never remounts the editor and loses a caret." PRODUCT.md § "Design Principles", 6: "Never the same product plus features the phone does not get, and never minus the ones it has."

## Decided against

A desktop layout of its own, and a second modal or dock component (AI.md § "Design & Product"; DESIGN.md § "Layout": anything else that docks "is a third use of the same dock, never a second copy of it").
