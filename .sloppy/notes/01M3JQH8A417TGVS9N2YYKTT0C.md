---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQH8A417TGVS9N2YYKTT0C
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQGKBPGRHT86HDDY1YS7WS
address: 1a3
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - native
  - shell
title: "The native shell: the app given the hardware"
created: 2026-09-28T00:44:43.204Z
updated: 2026-09-28T00:44:43.206Z
---

<!-- block 01M3JQH8A5Z5XH6G13AK8QDQ94 -->

[apps/sloppy/native](code:apps/sloppy/native)

<!-- block 01M3JQH8A6XJXRQB0HB1DAPP1X -->

## What it is

`@sloppy/native` is a Tauri 2 shell for iOS, iPadOS, Android and desktop. It renders the same `@sloppy/app-core` as the web shell and adds what a webview alone cannot give it: Apple Pencil, safe areas, the on-screen keyboard, the device's files, deep links and Android's back gesture. The Rust half lives in `src-tauri/` and is built by Cargo.

## What it adds on top of the web shell

- **Local-only mode.** It can serve the graph off the device, from a folder, through `@sloppy/local` and [its Tauri file adapter](code:apps/sloppy/native/src/lib/files.ts).
- **Sign-in over the ****`sloppy://`**** scheme.** The system browser hands the session back through [deep-link.ts](code:apps/sloppy/native/src/lib/deep-link.ts).
- **Pen draws, touch pans.** Pencil input arrives as pointer events with `pointerType === 'pen'`.
- **iPad-first.** The generated iOS project is patched after generation so the app targets iPad as well as iPhone.

\[Native shell\](code\:docs/ARCHITECTURE.md#Native shell) is the doc of record.

## Running it

`pnpm dev:native`, against a running `pnpm dev` stack. It needs Rust, and the first build compiles an embedded database, which takes a few minutes. [scripts/tauri.sh](code:apps/sloppy/native/scripts/tauri.sh) opens a tunnel so a physical iPad can reach the local API over https.
