---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M71Z3Z9PHK79DCSTHGFC76Y4
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M71Z3Z7G7FW26QJBZ5DEJ0M3
address: 1e12c
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - agents
  - context
  - mcp
title: "Inside Claude Code: the window pushed at the prompt, the loop left where it is"
created: 2026-11-10T05:32:58.550Z
updated: 2026-11-10T05:32:58.552Z
---

<!-- block 01M71Z3Z9Q0NADWKHM43S6RHSJ -->

## What it is for

Where the agent is Claude Code — the app's chat, whose [start](code:apps/sloppy/native/src-tauri/src/chat.rs#start) spawns `claude` as [its one agent](code:apps/sloppy/native/src-tauri/src/chat.rs#L53), or a terminal — Sloppy cannot own the loop and does not try. It owns what the loop sees. At the moment a prompt is submitted, the window is composed for that prompt and put in front of the model, so the first turn already holds what takes three calls today. Claude Code's hooks are the seam — the prompt being submitted, a tool being called, a session starting — and the MCP server stays for the acts that write.

[The hook](code:packages/ts/cli/src/hooks/claude-code.ts) composes the window on the prompt being submitted and adds nothing where the prompt only brushes against the notes; `sloppy hook` prints the settings entry that installs it.

<!-- block 01M71Z3Z9Q5XACSXBZNH8QY0W3 -->

## Why

- The developer, 2026-11-10: "and with claude code too if possible".
- [bench/WHERE-SLOPPY-HELPS.md](code:bench/WHERE-SLOPPY-HELPS.md): offered tools go unused; what the first call returns is what the agent uses. Pushing at the prompt makes the window the first thing it has.
- [An assistant outside the app](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYNW6ZXXC86P7QZY22XTV2): there is no gate, because a hook reads the same folder the agent already reads with its own tools.

<!-- block 01M71Z3Z9RV2N03NAEZPSE1B5W -->

## Candidates

- Whether a hook sees the prompt early enough to compose a window to a budget before the model is called. It does: a `UserPromptSubmit` hook runs on the prompt as submitted, before the model is called, and the context it returns joins that same turn ([Claude Code's hooks reference](https://code.claude.com/docs/en/hooks)).
- Whose budget wins where the agent's own context and the pushed window disagree in size.
- Whether the pushed window should carry the same anchor standings the runner's does, so Claude Code is told when a note's code has moved.
