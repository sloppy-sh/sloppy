---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYJNB3XFHVCXYWB16QGDDK
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY52E418RCHFJ1F3N1JSHG
address: 1f8
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - container
  - design
title: "An anchor into code, and the compass card on the note"
created: 2026-10-25T07:14:39.587Z
updated: 2026-10-25T07:14:39.588Z
---

<!-- block 01M5RYJNB4CN6SR6NQNY8PRB23 -->

## What it is for

Two things a note beside a codebase carries in its writing, both drawn in ink rather than hue. An anchor ([code-anchor.ts](code:packages/ts/ui/src/lib/components/editor/code-anchor.ts)) is a chip inline in the sentence, reading as the path's last part and the lines or name after it; tapping it opens the code as a read-only sheet. When the code under a note has moved since a person read it, one quiet line per file sits under the title with "Still true" beside them, and the mark on the canvas wears one dot on its rim. A note nobody has read against the code shows nothing: unread is not stale.

The compass ([compass-node.ts](code:packages/ts/ui/src/lib/components/editor/compass-node.ts)) is an element inside a section: the note in the middle and four slots around it, read by one of three methods — the idea compass (Part of, Made of, Like, Instead of), QEC, or AJI. Switching method changes the questions and nothing else. It is drawn on the note and never on the canvas.

## Why

DESIGN.md § "An anchor into code": a note pointing at four files "must not read as a control panel"; "a product that nags somebody about a note they wrote this morning has made a chore out of thinking"; and the dot is one however many files moved "because a count was never the thing to act on and a number on a mark is a score."

DESIGN.md § "The compass card": "a compass that put arrows on the field would be a second shape saying something the first one already says"; an empty slot shows its question and "no red, no 'incomplete', no three-of-four counter." The method tokens and their questions are [.sloppy/AGENT.md](code:.sloppy/AGENT.md) § "The three methods", cited in [The graph beside the code, and the tools that write it](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY223B8PSAQ41P43J00M10).
