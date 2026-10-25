---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYHZ4VVDZXWZPZRZMRBP0E
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY223VP87JR883A1C2HA7K
address: 1g6
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - mcp
  - tooling
  - vision
title: "Where the tool is heading: a separate app, an MCP, maybe an editor"
created: 2026-10-25T07:14:16.859Z
updated: 2026-10-25T07:14:16.861Z
---

<!-- block 01M5RYHZ4WQYCMTBDZ13MZVK84 -->

## What it is for

Sloppy is its own app first, and reaches into the places people already work from there. The first of those has landed: [`serveMcp`](code:packages/ts/cli/src/mcp.ts#serveMcp) is `sloppy mcp`, a server an assistant starts in somebody's repository, serving the same acts the app's chat has through the same implementation, so a rule about addresses or offers is one rule wherever an agent comes in ([docs/ARCHITECTURE.md](code:docs/ARCHITECTURE.md) § "An assistant outside the app"). What a person can rely on: a new way in does not bring new rules with it.

<!-- block 01M5RYHZ4WACMT05X7FFZ8P40N -->

## Why

The developer's r/ContextEngineering post "Sloppy - Context/Drift-avoidance for humans and agents": "I am currently also working on building MCP and implementations tools within it and maybe also turn this into a VSCode extension. I went with a separate app for now just to test the waters with a small but clean segregated app, but it's been going clean so I believe I might end up maintaining this too."

<!-- block 01M5RYHZ4XHSD40XR73SC3ZVV8 -->

## Still open

- What are the "implementations tools" the post names within the MCP? The acts served today read and write notes; whether building from the notes reaches an assistant outside the app the same way is not said.
- Is an editor extension still intended, and would it be a third way in to the same acts, or a surface of its own?
