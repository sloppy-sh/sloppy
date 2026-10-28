---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQM6K274H8ZXP14VFNBD1M
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQGKYNV7HMP3611A245MPN
address: 1b11
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - cli
  - tooling
title: "cli: the sloppy command"
created: 2026-09-28T00:46:19.746Z
updated: 2026-10-25T07:40:52.661Z
---

<!-- block 01M3JQM6K4FF7RSKCRXE21VKM7 -->

[packages/ts/cli](code:packages/ts/cli)

<!-- block 01M3JQM6K51YZBPED6JXCEXP5K -->

## What it is

`@sloppy/cli` is the `sloppy` command. It reads, checks and writes a project's notes from a terminal, with no browser involved. Each command answers in lines or, with `--json`, in JSON.

- `sloppy init`, in [init.ts](code:packages/ts/cli/src/init.ts): starts the notes in a project and writes what the file tree can tell.
- `sloppy draft`, in [draft.ts](code:packages/ts/cli/src/draft.ts): writes a detailed note for each file it is given. It reads a TS or JS file's imports and exports through [modules.ts](code:packages/ts/cli/src/modules.ts).
- `sloppy check`, in [check.ts](code:packages/ts/cli/src/check.ts): reads every note and reports what does not hold.
- `sloppy mcp`, in [mcp.ts](code:packages/ts/cli/src/mcp.ts): serves the project's notes over its own input and output to the assistant that started it, through the same sixteen acts the app's chat has ([An assistant outside the app](code:docs/ARCHITECTURE.md#L3982-L4008)).

[sloppy.ts](code:packages/ts/cli/src/sloppy.ts) is the entry point. [Tooling](code:docs/ARCHITECTURE.md#Tooling) is the doc of record.
