---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYJA8HNYQGNRC09PS08Z6M
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY223B8PSAQ41P43J00M10
address: 1e7
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - agents
  - container
  - tooling
title: "AGENT.md is the whole format, where an agent already looks"
created: 2026-10-25T07:14:28.241Z
updated: 2026-10-25T07:14:28.243Z
---

<!-- block 01M5RYJA8JT72QFMMB44BYWVTS -->

## What it is for

`.sloppy/AGENT.md` is committed beside the notes and carries everything a person can write in one: the file, the front matter, the sections, citations, `code:` anchors, the compass and its three methods, tags, how a mark is drawn, the shapes a note starts from, pictures and drawings. Then the doctrine — look before writing and cite what is already there, offer rather than write over, the list of what an agent never writes, and the commands. It also says which of two situations an agent is in: working in the repository on its own, or called from the app, where it writes no file at all. `AGENT_MD` in `@sloppy/local` is the one copy of the text, its shapes and methods drawn from `@sloppy/types`; [what AGENT.md teaches](code:packages/ts/local/src/agent-md.test.ts#L76) is held by test.

<!-- block 01M5RYJA8KM529T6V0P1FZTR3H -->

## Why

[docs/ARCHITECTURE.md](code:docs/ARCHITECTURE.md) § "Tooling": "It is the whole format because an agent that can write only a subset of it produces notes a person cannot finish." Drawing the shapes and methods from `@sloppy/types` means "a fourth method or a renamed slot cannot leave it saying the old thing."

§ "Asking a tool to write the notes" adds that "a person editing a note must not be writing something the next pass cannot read", and that the two situations are told apart in the file because "nothing else could tell the two apart from inside the file, and an agent that wrote into `notes/` would be past `writeOnto`."
