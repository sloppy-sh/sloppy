---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQM1N063EQHYGXYNCECBNG
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQGKYNV7HMP3611A245MPN
address: 1b2
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - api
  - client
title: "client: one method surface for any backend"
created: 2026-09-28T00:46:14.688Z
updated: 2026-09-28T00:46:14.691Z
---

<!-- block 01M3JQM1N2VS4X5DJ5BVFN2QRA -->

[packages/ts/client](code:packages/ts/client)

<!-- block 01M3JQM1N3GVC8ESPBQ0EKMDFA -->

## What it is

`@sloppy/client` is `SloppyClient`, a typed wrapper over `fetch` with one method per route. The same surface talks to the hosted API, a self-hosted one, or an origin somebody points their device at. [index.ts](code:packages/ts/client/src/index.ts) is the client.

## Beside it

- [host.ts](code:packages/ts/client/src/host.ts): which origin the client is talking to.
- [upload.ts](code:packages/ts/client/src/upload.ts): media uploads.
- [errors.ts](code:packages/ts/client/src/errors.ts): what a failed call turns into.

The app never holds a `SloppyClient` directly. It talks to the `api` proxy in app-core, which resolves to this client or to the on-device one in `@sloppy/local`.
