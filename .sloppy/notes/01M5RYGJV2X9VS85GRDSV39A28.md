---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYGJV2X9VS85GRDSV39A28
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY223VP87JR883A1C2HA7K
address: 1g4
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - context
  - mcp
  - vision
title: "Context declared once, instead of re-explained to every agent"
created: 2026-10-25T07:13:31.490Z
updated: 2026-10-25T07:13:31.492Z
---

<!-- block 01M5RYGJV3VGVE9BX53PG37D3A -->

## What it is for

The account of why a project is the way it is lives in the repository, so whoever works in it — a person, or any assistant they switch to — is pointed at it rather than told it again. [`.mcp.json`](code:.mcp.json) is this repository saying so once for everyone: it names the `sloppy` server, so an assistant opened here finds the notes without being told where they are. What a person can rely on: changing which assistant they work with does not cost them the context, because the context was never in the assistant.

<!-- block 01M5RYGJV4PY0DNDZTKHAPGCJH -->

## Why

The developer's r/ContextEngineering post "Sloppy - Context/Drift-avoidance for humans and agents" gives the origin: "I discovered that I was wasting a lot of time redeclaring context of the codebase to the agents, which I also frequently migrate between (claude agents, cheaper deepseek etc.), so I realized that maintaining docs within the codebase (sort of mono-repo style) saves a lot of time as I just point the agent to it." The same post adds that large codebases "face personnel and agent change, thus making context preservation even more important". [docs/ARCHITECTURE.md](code:docs/ARCHITECTURE.md) § "An assistant outside the app" says what the file does: "this one commits a `.mcp.json` at its root naming the `sloppy` server, so an assistant opened here finds the notes without being told where they are." [README.md](code:README.md) § "Where it went" names the failure it replaces: an assistant "working from whatever context somebody typed from memory, leaving no record of what it was told."
