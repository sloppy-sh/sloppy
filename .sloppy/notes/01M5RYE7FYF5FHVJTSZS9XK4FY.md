---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYE7FYF5FHVJTSZS9XK4FY
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY223B8PSAQ41P43J00M10
address: 1e1
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - container
  - vault
title: "A project's notes are an ordinary vault at .sloppy/"
created: 2026-10-25T07:12:14.334Z
updated: 2026-10-25T07:12:14.339Z
---

<!-- block 01M5RYE7G1G4SMVPNE09Y783F7 -->

## What it is for

A project keeps its notes in `<project>/.sloppy/`, a folder with a `graph.json` in it like any other vault. `graph.json` gains one field, `project`, the path from the vault root to the code — `..` in the ordinary case; absent is a graph that is nobody's project, where an anchor into code draws as an ordinary link. Opening a project means picking its ROOT: [containerOf](code:packages/ts/local/src/container.ts#containerOf) answers with the vault inside it, or nothing where nobody has started one, and [projectRootOf](code:packages/ts/local/src/container.ts#projectRootOf) holds `project` to a path that lands in the picked folder or under it. [The tests](code:packages/ts/local/src/container.test.ts) are what holds those two answers.

The vault's own sidecars sit one level down, at `<project>/.sloppy/.sloppy/`.

<!-- block 01M5RYE7G2T3XW2VYWVBTWVD93 -->

## Why

[docs/ARCHITECTURE.md](code:docs/ARCHITECTURE.md) § "A project's container": being an ordinary vault means "the archive, the history, offered changes, the picker and publishing all work on it unchanged, and there is no second kind of graph anywhere in the code." Holding `project` inside the picked folder means "a graph file a hand has been in cannot point the app above the folder somebody picked."

The doubled `.sloppy/.sloppy/` is "accepted as it is, because renaming it would move every path in a layout other people's folders are already written in."

<!-- block 01M5RYE7G3PNSH463VK6FH6AH7 -->

## Decided against

Renaming the sidecar folder inside a container, for the reason above (same section).
