---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQGKBPGRHT86HDDY1YS7WS
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3E2FRSQAYC42VD7G7A1FQ8R
address: 1a
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - apps
  - deployment
title: "The three apps: a server and two shells"
created: 2026-09-28T00:44:21.750Z
updated: 2026-09-28T00:44:21.761Z
---

<!-- block 01M3JQGKBTEY21Z0CV2QH990G5 -->

[apps/sloppy](code:apps/sloppy)

<!-- block 01M3JQGKC12E9675A3FD2HP4AJ -->

## What is here

Sloppy ships as three deployables under `apps/sloppy/`\:

- **api** — the NestJS server that owns graphs, notes, addresses, tags, blocks and ink over SurrealDB. Hosted or self-hosted.
- **web** — the SvelteKit single-page shell a browser loads.
- **native** — the Tauri shell for iOS, iPadOS, Android and desktop.

The two shells are thin boots. Every page, component, store and API call lives in the shared app package, so one codebase serves both surfaces.

## Where each one runs

The same client runs in three deployment modes: **hosted** (a Sloppy API plus an external syr instance), **self-hosted** (somebody's own API pointed at their own syr instance), and **local-only** (the native app opens a folder on the device, and that folder is the whole store). What needs a server — publishing, peers, pulling — is not offered in local-only mode.

- \[Deployment modes\](code\:docs/ARCHITECTURE.md#Deployment modes)
- \[Monorepo layout\](code\:docs/ARCHITECTURE.md#Monorepo layout)

## Running it

`pnpm dev` brings up the database, object storage, the shared package builds, the API and the web shell in Docker. The web shell is at `localhost:8030` and forwards `/api` to the API on `8020`. The native shell runs on the host with `pnpm dev:native` against that stack — see \[the README\](code\:README.md#Run it).
