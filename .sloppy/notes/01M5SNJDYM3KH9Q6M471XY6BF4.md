---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5SNJDYM3KH9Q6M471XY6BF4
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYHJHSAJZ7TQBX6M5ZXPRR
address: 1g5a
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - agents
  - context
  - mcp
title: "A brief is composed at read time, to a budget, and nothing of it is stored"
created: 2026-10-25T13:56:29.268Z
updated: 2026-10-25T13:56:29.273Z
---

<!-- block 01M5SNJDYP3K11RP4R02MA9BMN -->

## What it is for

[packages/ts/local/src/brief.ts](code:packages/ts/local/src/brief.ts) is how an assistant takes in the micro-context one task needs in one call, and no more. Three reads do it. `list_notes` narrows to a place or to tags, so an agent finds three notes without pulling every one. `read_around` is one note whole and the notes around it to a depth of up to three hops: what it sprang out of, what it cites and what cites it, what springs out of it, and what it is linked to, each of those as one line. `brief` is what an agent calls first on a task: the notes it names, the notes about the places it will touch and the notes some words reach, handed over whole while they fit a budget in characters, and every note around them as a gist, the first paragraph of its writing that is not an anchor alone or a compass.

Each anchor a note is read with says where the code under it stands: `held`, `moved` where the file has changed since a person read the note against it or the name or lines it points at are gone, `unread` where nobody has, `missing` where the checkout has not got it. Gists, neighbourhoods and standings are worked out from the files whenever they are asked for and none of them is stored, so there is nothing to keep true; the acts only read, and `checked` and `read_against` stay the person's. The acts are dispatched in [packages/ts/local/src/acts.ts](code:packages/ts/local/src/acts.ts#performChatCall), and their shapes and the rule that fills a brief to its budget are in [packages/ts/types/src/chat.ts](code:packages/ts/types/src/chat.ts#briefAnswer).

<!-- block 01M5SNJDYRS7FXMEWQCN022T78 -->

## Why

[The token economy: enough micro-context, and no more](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYHJHSAJZ7TQBX6M5ZXPRR) left this open: "should there be an act that reads a note and its neighbourhood to a given depth, and is the depth set by the task, the agent or the person?" `read_around` is that act, and the agent sets the depth on the call, from one hop to three.

The developer, on 2026-10-25, asking for it: Sloppy "gives you the indexed/cached context as required", in "optimal context windows so that they produce best results as we know that agent output goodness falls when the context increases", and so that "no context drift takes place". That is why a brief is held to a budget rather than to a count of notes, why what does not fit whole is handed over as one line rather than dropped, and why every anchor says whether the code under it has moved.

<!-- block 01M5SNJDYSMRWP27C4MRFJFMQ2 -->

## Candidates

- A depth beyond three hops, where a task needs more of the field than a neighbourhood.
- A budget in tokens rather than characters, which needs the agent's own tokenizer to count.
- The planner of a build calling `brief` for each task it hands out, rather than naming the notes for it.
- A summary kept per note, which [the token-economy note](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYHJHSAJZ7TQBX6M5ZXPRR) asks about — who writes it, and how it is kept true when the note changes. A gist is read off the note's writing each time it is asked for, so the question stands only for a summary somebody writes.
