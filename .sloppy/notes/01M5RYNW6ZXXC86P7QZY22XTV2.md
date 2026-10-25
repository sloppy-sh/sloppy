---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYNW6ZXXC86P7QZY22XTV2
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY223B8PSAQ41P43J00M10
address: 1e10
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - agents
  - cli
  - mcp
title: "An assistant outside the app: no gate, and git is the review"
created: 2026-10-25T07:16:24.927Z
updated: 2026-10-25T07:16:24.931Z
---

<!-- block 01M5RYNW71AMAYD3K81DFWEBGV -->

## What it is for

`sloppy mcp` is a server on its own input and output, started by an assistant working in the repository — Claude Code, an editor's agent, anything that speaks the Model Context Protocol. It finds the nearest container at or above where it was started, binds no port, and ends with the program that started it. Its writes land in the folder's working tree; there is no draft on this path, and the person reads what was written in the diff. It writes as the container, so a note somebody has written in is offered an amendment. Nothing is asked before a write, and an open app is handed nothing: it reads the folder again when the window comes back. This repository commits a `.mcp.json` naming the server. [The tests](code:packages/ts/cli/src/mcp.test.ts#L88-L316) hold the sixteen acts and no build's, writing as the container, and refusing any folder but its own. Where it sits in the tool's direction is [Where the tool is heading](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYHZ4VVDZXWZPZRZMRBP0E).

<!-- block 01M5RYNW72MK5956KPRM2ZC53T -->

## Why

[docs/ARCHITECTURE.md](code:docs/ARCHITECTURE.md) § "An assistant outside the app": "There is no gate, because one would protect nothing. An assistant working in the folder already edits `.sloppy/notes/*.md` with its own file tools. What this server adds is the rules in `@sloppy/local` … and not reach." Git is the review because "the files are the store", and the app needs nothing handed to it because both write as the container, "so what it reads there is by a writer it already knows rather than a second identity."

<!-- block 01M5RYNW73RQGE0P145H4BFY3T -->

## Decided against

A per-folder allowance. The same section: "A per-folder yes in front of it would stand before the careful way in and leave the careless one open, so nothing is asked and nothing is written down about who may."
