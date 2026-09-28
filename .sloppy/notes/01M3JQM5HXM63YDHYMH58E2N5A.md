---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQM5HXM63YDHYMH58E2N5A
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQGKYNV7HMP3611A245MPN
address: 1b9
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - files
  - vault
title: "vault: a graph as files"
created: 2026-09-28T00:46:18.685Z
updated: 2026-09-28T00:46:18.688Z
---

<!-- block 01M3JQM5HZWDTVF0MGE4ZWWA32 -->

[packages/ts/vault](code:packages/ts/vault)

<!-- block 01M3JQM5J0QXVHK4H83BP0MJ56 -->

## What it is

`@sloppy/vault` is the graph written out as files: a folder with one markdown file per note (like the ones this graph lives in), and the archive, which is that folder zipped. It converts a block's editor document to markdown and back without losing anything.

## Where to start

- [note.ts](code:packages/ts/vault/src/note.ts), [front.ts](code:packages/ts/vault/src/front.ts): one note file and its front matter.
- [markdown.ts](code:packages/ts/vault/src/markdown.ts): a section's document to markdown and back.
- [ink.ts](code:packages/ts/vault/src/ink.ts): drawings as files beside the note.
- [layout.ts](code:packages/ts/vault/src/layout.ts): where everything goes in the folder.
- [archive.ts](code:packages/ts/vault/src/archive.ts): the whole graph as one file.
- [difference.ts](code:packages/ts/vault/src/difference.ts), [review.ts](code:packages/ts/vault/src/review.ts), [amendment.ts](code:packages/ts/vault/src/amendment.ts): what changed between two copies, and offering a change.
- [rekey.ts](code:packages/ts/vault/src/rekey.ts): carrying a graph over to a different identity.

\[A graph on disk\](code\:docs/ARCHITECTURE.md#A graph on disk) is the doc of record.
