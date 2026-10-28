---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYNA3Z9GKJRAR2D2N5XCCV
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY223B8PSAQ41P43J00M10
address: 1e9
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - agents
  - history
title: "The chat works on a draft, read whole and merged once"
created: 2026-10-25T07:16:06.399Z
updated: 2026-10-25T07:16:06.402Z
---

<!-- block 01M5RYNA4095Q01W60BXQB1WVD -->

## What it is for

A chat session works in a DRAFT: a second checkout of the repository under the app's own data, on a branch of its own, one per thread. Every act lands there at once; the folder in front of the person is untouched the whole time. The draft begins as the folder's working files, so the person's unkept notes are not counted as the draft's. It outlives the session and the app. The person reads the whole draft note by note — written, changed, moved, renumbered, retitled, binned — and merges it once, by the same note-by-note settling a copy of a graph goes through; no merge of git's runs on the folder. Discarding takes the checkout and the branch with it. [draft.rs](code:apps/sloppy/native/src-tauri/src/draft.rs) holds the drafts, and copies in the container's private data so the draft writes as the same container.

<!-- block 01M5RYNA41ZQ1N318QWQMCAXTM -->

## Why

[docs/ARCHITECTURE.md](code:docs/ARCHITECTURE.md) § "Asking a tool to write the notes": "What a person actually wants to say yes to is finished work, read whole. So they read it whole." A copy without the container's identity "would write under an identity of its own — after which every note the folder already holds comes back as somebody else's amendment rather than landing." And "git settles files and Sloppy settles notes, and a note is not a file's worth of lines."

<!-- block 01M5RYNA42JM7TX4VY66VM8HZ6 -->

## Decided against

A question in front of every write. The same section: "A per-call gate interrupted a pass over a repository thirty times; it raced, because the endpoint serves each call on its own thread and two questions could be open at once; and it asked somebody to approve a note they had not read, one at a time, which is the opposite of the judgement they are there to bring."
