---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQM256WHADRJZ466MAXTDJ
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQGKYNV7HMP3611A245MPN
address: 1b3
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - app-core
  - frontend
title: "app-core: the application both shells render"
created: 2026-09-28T00:46:15.206Z
updated: 2026-09-28T00:46:15.209Z
---

<!-- block 01M3JQM257C0JGZ01K6JD1E0TX -->

[packages/ts/app-core](code:packages/ts/app-core)

<!-- block 01M3JQM259XKWWARD175HYJG5A -->

## What it is

`@sloppy/app-core` is the Sloppy app: every page, product component, store and API call. The web and native shells boot it and add nothing product-shaped of their own.

## The surfaces a person meets

Pages live in `src/lib/pages/`\:

- **sign-in** and **first-run**: getting in, and the first graph.
- **frame**: what surrounds every page once somebody is signed in.
- **graph** and **graph-tree**: the canvas, and the same graph read as a tree.
- **node** and **new**: reading and writing one note.
- **profile**, **settings**, **history**: a person, their preferences, and the vault's history.
- **cited**: what cites a note.

`src/lib/components/` holds the app-level pieces: the chat panel and draft review, offered changes, publishing and sync controls, the code preview beside a note, and the commit graph.

## The seam to the shell

Two files are how a shell plugs in\:

- [runtime.ts](code:packages/ts/app-core/src/lib/runtime.ts): `AppRuntime`, the capabilities a shell hands over. A member that is absent means the shell does not have that capability.
- [api.ts](code:packages/ts/app-core/src/lib/api.ts): the `api` proxy, which resolves to a remote client or to one served off the device.

\[The two files that carry the platform seam\](code\:docs/ARCHITECTURE.md#The two files that carry the platform seam) is the doc of record.
