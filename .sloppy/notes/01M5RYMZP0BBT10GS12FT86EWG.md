---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYMZP0BBT10GS12FT86EWG
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY223B8PSAQ41P43J00M10
address: 1e8
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - agents
  - local
  - mcp
title: "Sixteen acts, one vocabulary, one implementation"
created: 2026-10-25T07:15:55.712Z
updated: 2026-10-25T07:15:55.714Z
---

<!-- block 01M5RYMZP1RPXDAQN0FF2F4JPZ -->

## What it is for

An agent reaches the notes through sixteen of Sloppy's own acts: seven that read (the notes, a search, one note whole, the tags, the bin, the offers on a note, the graph itself) and nine that write (a note, a move, tags, a number, a line, a line's look, a mark's look, the bin and back out). `CHAT_TOOLS` and `CHAT_TOOL_SPECS` in `@sloppy/types` are the vocabulary; `performChatCall` in `@sloppy/local` is what each act does, for the app's chat and for `sloppy mcp` alike. The app's endpoint, [tools.rs](code:apps/sloppy/native/src-tauri/src/tools.rs), serves exactly the acts it is handed and holds none of its own. An act holds no rule either: addresses, aliases, cycles, ownership and offers live in `@sloppy/local`, and an act hands the agent the words that refused it. Search answers what a note SAYS, so an agent looks before it writes.

<!-- block 01M5RYMZP1ST8SQ6ZHVZJTQ7J3 -->

## Why

[docs/ARCHITECTURE.md](code:docs/ARCHITECTURE.md) § "Asking a tool to write the notes"\:

- "A shorter list is not a safeguard: somebody who hands three hundred files to a tool and then has to draw every relation themselves has offloaded nothing."
- The endpoint "holds no vocabulary of its own — a new act costs it nothing", and a second copy of a rule "would be a rule that can disagree with itself."
- "An agent that cannot ask what is already written writes it again, and two notes about one fact come apart the moment the code under them moves."

<!-- block 01M5RYMZP256EA360JCXFS5CJR -->

## Decided against

The same section names what a person can write and an agent deliberately cannot: `checked` and `read_against`, because "the signature stays the person's"; `owner`, because gating a note "is an authority change and not a look"; and the person's identity and keys, the versions their history keeps and what signs them, and what their profile says, which are "none of an agent's business." None is an act, so none can be called.
