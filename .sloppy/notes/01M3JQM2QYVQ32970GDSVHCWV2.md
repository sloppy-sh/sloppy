---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQM2QYVQ32970GDSVHCWV2
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQGKYNV7HMP3611A245MPN
address: 1b4
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - design-system
  - frontend
  - ui
title: "ui: the design system and the component vocabulary"
created: 2026-09-28T00:46:15.806Z
updated: 2026-09-28T00:46:15.809Z
---

<!-- block 01M3JQM2QZKFH794Z4ED4XQ2AF -->

[packages/ts/ui](code:packages/ts/ui)

<!-- block 01M3JQM2R1B4MYZX2V0ATV7AHZ -->

## What it is

`@sloppy/ui` is the design system, built on shadcn-svelte and Tailwind v4. [app.css](code:packages/ts/ui/src/lib/app.css) holds the tokens and the four theme axes on `<html>`: `data-theme`, `data-accent`, `data-style` and `data-app-font`. It also holds the graph's colour language. The apps import it as `@sloppy/ui/styles`. [DESIGN.md](code:DESIGN.md) is the doc of record.

## What else lives here

More than primitives. `src/lib/components/` also holds the building blocks of the product's surfaces\:

- **editor**: the block editor and its element kinds, which are ink, pictures, maths, diagrams, the compass, code anchors, emoji and references to other notes.
- **graph**: the sheets around the canvas, such as find, move, import, graphs, nesting and the wallpaper.
- **peers**, **publish**, **social**: pulled notebooks, publishing, and conversations.
- **tags**, **templates**, **history**, **identity**, **appearance**.
- `ResponsiveModal`, the only modal: a bottom sheet on a phone and a dialog on a wider screen.
