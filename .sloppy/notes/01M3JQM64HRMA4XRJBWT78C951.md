---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQM64HRMA4XRJBWT78C951
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQGKYNV7HMP3611A245MPN
address: 1b10
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - files
  - identity
  - local
title: "local: the graph served off this device"
created: 2026-09-28T00:46:19.281Z
updated: 2026-09-28T00:46:19.285Z
---

<!-- block 01M3JQM64K7JR7KKKATNV6J3N3 -->

[packages/ts/local](code:packages/ts/local)

<!-- block 01M3JQM64N343G1GDVKZTYS178 -->

## What it is

`@sloppy/local` is what fills app-core's seam when no server is involved. It serves a vault folder on the device through the same method surface the remote client has, and it owns the identity that writes there.

## Where to start

- [api.ts](code:packages/ts/local/src/api.ts): `LocalApi`, the on-device stand-in for the server.
- [files.ts](code:packages/ts/local/src/files.ts): `Files`, the file access a shell provides. `MemoryFiles` is what tests run against.
- [identity.ts](code:packages/ts/local/src/identity.ts), [delegation.ts](code:packages/ts/local/src/delegation.ts), [credentials.ts](code:packages/ts/local/src/credentials.ts): the identity made on this device, or one brought in sealed.
- [notes.ts](code:packages/ts/local/src/notes.ts), [graph.ts](code:packages/ts/local/src/graph.ts), [search.ts](code:packages/ts/local/src/search.ts), [write-onto.ts](code:packages/ts/local/src/write-onto.ts): reading, finding and writing notes in the folder.
- [vaults.ts](code:packages/ts/local/src/vaults.ts), [container.ts](code:packages/ts/local/src/container.ts), [agent-md.ts](code:packages/ts/local/src/agent-md.ts): the folders a device knows, and a project's `.sloppy` container.
- [history.ts](code:packages/ts/local/src/history.ts), [git-defaults.ts](code:packages/ts/local/src/git-defaults.ts): the vault's git history.

\[Local-only mode\](code\:docs/ARCHITECTURE.md#Local-only mode) is the doc of record.
