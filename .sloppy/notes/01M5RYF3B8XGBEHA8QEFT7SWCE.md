---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYF3B8XGBEHA8QEFT7SWCE
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY52E418RCHFJ1F3N1JSHG
address: 1f3
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - design
  - look
title: "One axis decides colour, four decide none, and a look is a file"
created: 2026-10-25T07:12:42.856Z
updated: 2026-10-25T07:15:09.347Z
---

<!-- block 01M5RYF3B9BR2JWHWT9PVSYFJB -->

## What it is for

Five attributes on `<html>`, mixed freely. `data-look` is every colour there is — surfaces, ink, accent, the eight facet hues — and carries one of Sloppy's five (Paper, Graphite, Light, Dark, High contrast) or the id of a look carried as data. The faces decide legibility, `data-style` how surfaces are drawn, `data-density` how close, `data-effect` the texture over the screen; none of the four names a colour, and one that did would be a bug. There is no accent axis: a look names its own `--primary`.

A look is a small JSON file — `LookSchema` in `@sloppy/types` — holding any of those five plus its own CSS. What it holds is applied, what it leaves out is left alone, and it can be copied, saved, opened or pasted. Its CSS is bounded and may not reach the network: `cssIsSafe` refuses `@import` and anything naming a host, and [look.test.ts](code:packages/ts/types/src/look.test.ts) is the file of record. The [prefs store](code:packages/ts/app-core/src/lib/stores/prefs.svelte.ts) keeps which look somebody wears.
