---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYJBYWCCFR3XXB7HBA8QYH
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY52E418RCHFJ1F3N1JSHG
address: 1f7
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - canvas
  - design
title: "Bottom chrome clears the nav bar; pen draws, touch pans"
created: 2026-10-25T07:14:29.980Z
updated: 2026-10-25T07:14:29.982Z
---

<!-- block 01M5RYJBYYTHTFPYRQP892SVYP -->

## What it is for

Two rules for the edge where the phone meets the hand. Bottom-pinned surfaces pad with `var(--safe-area-inset-bottom, env(safe-area-inset-bottom))`, never bare `env(...)`, and read four vars rather than re-deriving them: `--safe-area-inset-bottom` (the real system bar), `--kb-inset-bottom` (how far to lift above the keyboard, not its height), `--sysnav-inset-bottom` (the pill, set by the pill and unset where it is hidden) and `--app-chrome-top` (the chrome above the page). Whether the keyboard is open is answered by the [keyboard](code:packages/ts/app-core/src/lib/keyboard.svelte.ts#keyboard) store, never by a var.

On the canvas, `pointerType === 'pen'` inks and `'touch'` pans and pinches. There is no mode toggle to find.

## Why

DESIGN.md § "The four inset vars": "Android's WebView reports `env(safe-area-inset-bottom)` as 0 for the 3-button nav bar", so the native shell publishes the real inset itself; and "WebKit ties `env(safe-area-inset-bottom)` to the keyboard, so a raw probe reads a keyboard-sized number and strands whatever padded by it." `--kb-inset-bottom` is 0 when WebKit pans the page instead of shrinking it, which is why it cannot say whether the keyboard is open.

DESIGN.md § "The canvas": "`WKWebView` drives one input type at a time, which turns out to be a gift … the gesture model falls out of the platform instead of fighting it." PRODUCT.md § "Accessibility & Inclusion": "Ink degrades, it never gates … Nothing in the product requires a pencil."

## Decided against

Affordances built on Pencil Pro gestures: DESIGN.md § "The canvas" — squeeze, barrel-roll and double-tap live in `UIPencilInteraction` and are not exposed to the web layer.

## Still open

Moving a mark with a finger is proposed and not decided (DESIGN.md § "The canvas"): it would change the touch contract above. Is it **Move** on the press menu, as the section leans?
