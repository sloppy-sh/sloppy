---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYFFDFDDQF0589B590M1J1
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY52DDY8ADPXG2ZWPG96PN
address: 1c5
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - address
  - agents
  - protocol
title: "A person writes the label, or a tool they set to work does"
created: 2026-10-25T07:12:55.215Z
updated: 2026-10-25T07:15:53.923Z
---

<!-- block 01M5RYFFDGAHAQTWPJQX2SFQM4 -->

## What it is for

A person edits and removes an address wherever one is shown, and a tool they set to work may write one for them. Either way it is one note's label that changes: nothing renumbers the notes around it, and the number given up keeps leading to the note. [The numbering acts](code:packages/ts/local/src/acts.test.ts#L543-L612) hold this for an assistant: `number_note` writes and takes off the number a person cites a note by, the number it gave up still finds the note, and a number the graph refuses comes back as words rather than being written anyway. A write may also [name the number](code:packages/ts/local/src/acts.test.ts#L1200-L1262) the new note takes, under the same refusals.

Writing an address touches nothing else: `depth`, `parent` and `origin` stay where they are, because a label is not a place in the tree (docs/ARCHITECTURE.md § "The genealogy and the address").

<!-- block 01M5RYFZYRXVQMBGCBEQJM54V9 -->

## Why

AI.md § "The Genealogy Is the Protocol (required)": "That is the whole of what makes it a label: it is theirs to change, not theirs alone to author. The rule already offers one at creation, so a machine has always written most of them; an agent naming one is the same act, done where it can see the run. Somebody who hands over three hundred notes is not then reading three hundred notes to number them. Renumbering the notes AROUND one is still not a thing that happens: a person changes their own note's label and nobody else's, and so does anything acting for them."

What happens to the number left behind is [Every address a note has carried keeps leading to it](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYFV2A62SMND011DAEYC75).
