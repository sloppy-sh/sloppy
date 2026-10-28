---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYHF5XJSJ7BHAPM47KVJR6
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY223B8PSAQ41P43J00M10
address: 1e5
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - agents
  - cli
  - tooling
title: A reason is written from a source or not at all
created: 2026-10-25T07:14:00.509Z
updated: 2026-10-25T07:14:05.899Z
---

<!-- block 01M5RYHF5Y7A4K59QW7NRZ1D7W -->

## What it is for

What was decided against, and why — the compass's west and a section headed "Why" — goes into a note only from something named in that note: what a person said, a commit message, a comment, a document in the repository. Where nothing says, the open question goes down instead. An agent in the chat or over `sloppy mcp` is held to that by `.sloppy/AGENT.md` and by the words on `write_note`. `sloppy draft` writes neither at all: what a compass might hold goes under a "Candidates" heading as writing, and [the draft test](code:packages/ts/cli/src/commands.test.ts#L259-L288) holds that a drafted note carries candidates and no compass.

<!-- block 01M5RYHF5YYQJDHHRBAW78DDGK -->

## Why

[docs/ARCHITECTURE.md](code:docs/ARCHITECTURE.md) § "Asking a tool to write the notes": "one an agent supplies out of its own reading puts words in somebody's mouth that no reader can tell from theirs." § "Tooling": "The CLI never writes a 'west' and never writes a 'Why' — it reads files and has nobody to ask, so a reason it wrote would be its own."

`.sloppy/AGENT.md` § "The compass" keeps the same rule for an agent editing the files: "an open question is worth keeping, and a reason nobody gave is not."
