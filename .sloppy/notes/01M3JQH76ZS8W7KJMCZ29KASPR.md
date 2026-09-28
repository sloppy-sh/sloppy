---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQH76ZS8W7KJMCZ29KASPR
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQGKBPGRHT86HDDY1YS7WS
address: 1a1
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - api
  - server
title: "The API: Sloppy's own server"
created: 2026-09-28T00:44:42.079Z
updated: 2026-09-28T00:44:42.083Z
---

<!-- block 01M3JQH771FCFB7ZRVBVNT7M8D -->

[apps/sloppy/api](code:apps/sloppy/api)

<!-- block 01M3JQH7733H9YW6VKPP9HXVVF -->

## What it is

`@sloppy/api` is a NestJS server over SurrealDB. It holds the part of Sloppy that is Sloppy's own — graphs, notes, addresses, tags, blocks and ink — and leaves identity, profiles, media, emoji and reactions to syr. It can be hosted or self-hosted.

## The modules

The server is assembled in [app.module.ts](code:apps/sloppy/api/src/app.module.ts), one feature module per concern\:

- **config, db, health**: the plumbing. `GET /api/health` answers 200 when the database is reachable and 503 when it is not.
- **auth, idp, identity**: signing in. `idp` lets the API serve identities itself, so a dev stack needs no syr instance. It is on by default in `docker-compose.yml` through `SLOPPY_LOCAL_IDP`.
- **node, block, amendment**: notes, their sections, and changes offered to a note's owner.
- **publication, peer, social**: publishing a subtree, pulling a peer's published region, and the social layer on top of it.
- **media, profile, emoji**: syr-backed content, reached through the API's proxy.
- **export**: everything somebody has written, handed back as one file.

## Entry point

[main.ts](code:apps/sloppy/api/src/main.ts) boots it, and [cors.ts](code:apps/sloppy/api/src/cors.ts) decides which origins may call it.

## Filling it for a look

`pnpm --filter @sloppy/api seed` fills one identity's graph with about 2,400 notes. `--fresh` erases everything that identity already has first.
