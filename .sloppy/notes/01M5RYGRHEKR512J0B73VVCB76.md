---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYGRHEKR512J0B73VVCB76
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY223B8PSAQ41P43J00M10
address: 1e3
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - history
  - vault
title: "Git is the folder's history, and a version is written from"
created: 2026-10-25T07:13:37.326Z
updated: 2026-10-25T07:13:37.329Z
---

<!-- block 01M5RYGRHF41GH8ZBEQ7PRNHVW -->

## What it is for

The app keeps no history of its own: a vault is a git repository, and [history.rs](code:apps/sloppy/native/src-tauri/src/history.rs) runs git's commands over `git2`. A container uses the project's own repository as a PREFIX, so a commit Sloppy makes stages only the notes and never the person's code. The bin, the identities, the keys and the credentials stay out of every commit and every push. Standing on an earlier version is a real checkout ([stand\_on](code:apps/sloppy/native/src-tauri/src/history.rs#stand_on)) with every act still the person's, and the first write there opens a line ([line\_here](code:apps/sloppy/native/src-tauri/src/history.rs#line_here)). A difference and a merge are read note by note and section by section; no note is ever written with conflict markers in it.

<!-- block 01M5RYGRHG0VCAKXA0ZW5Y28FB -->

## Why

[docs/ARCHITECTURE.md](code:docs/ARCHITECTURE.md) § "The vault's history"\:

- "A folder of markdown files is a folder git can keep … a second implementation of git in TypeScript is not a thing anybody should own."
- A prefix, because "reasoning that moves with the code it is about has to land in the same commit as the code."
- The bin stays out because its ledger of spent addresses "only ever grows — going back to an older commit and handing those addresses back would let a second note be written at one."
- Standing on a version is a checkout because "the documents come first … so an earlier version of a project is somewhere a person WRITES from" — the rule [Intent-driven development: the note comes first](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYFJCQCRP07NJ8P1A8N5W5) holds.
- "Git's hunks are lines of a file, and a line of a note's file is not a thing anybody wrote — a section is."

<!-- block 01M5RYGRHHN2KEKV8PWMX7HCDR -->

## Decided against

Git's own merge on the notes, and markers in a note: markers "make a note that reads as neither version and a section stack that is neither stack" (same section).
