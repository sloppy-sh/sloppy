---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYJ0V1YV104QM22BM73KYA
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY223B8PSAQ41P43J00M10
address: 1e6
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - cli
  - container
  - identity
title: "The container writes as itself, and its keys stay out of git"
created: 2026-10-25T07:14:18.593Z
updated: 2026-10-25T07:14:18.594Z
---

<!-- block 01M5RYJ0V2JHY1XATQ04W9R2PF -->

## What it is for

`sloppy init` writes under an identity of the container's own, minted the first time and kept in the container's sidecar, `<project>/.sloppy/.sloppy/`. That same identity is the writer for `sloppy draft`, the app's chat and `sloppy mcp`. Because the key now sits inside somebody's repository, `<project>/.sloppy/.gitignore` is told to pass over everything that is this device's alone: every `*.key`, the identities, the list of folders, the credentials, the git defaults, saved identity copies, the bin and what was attached in a chat. [KEPT\_OUT](code:packages/ts/local/src/kept-out.ts#KEPT_OUT) is that list, and [keepOut](code:packages/ts/local/src/kept-out.ts#keepOut) adds the missing lines and touches nothing else in a file somebody wrote. A drawing's strokes and what each picture was called are the graph's, and commit with the notes. `--identity <file>` writes under an identity carried from another device instead.

<!-- block 01M5RYJ0V2W1XY7D2R7Q3902V2 -->

## Why

[docs/ARCHITECTURE.md](code:docs/ARCHITECTURE.md) § "Tooling": the key goes in the sidecar "because there is no app here", and "a key committed is a key pushed." The rest of the sidecar commits, "or a teammate who clones gets the writing with the drawings missing." § "Asking a tool to write the notes": the writer is never one the app writes under, because a page writing as the person would find `writesAlone` true on every note they wrote, "so every one of those is written over rather than offered" — the rule in [A tool offers its writing on a note somebody has written in](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYH50P2JESYJVR15ZM39F9).

The comment on `KEPT_OUT` gives the wildcard's reason: "a key this build has not named yet is the one mistake with no way back."
