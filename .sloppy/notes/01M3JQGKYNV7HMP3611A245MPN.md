---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQGKYNV7HMP3611A245MPN
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3E2FRSQAYC42VD7G7A1FQ8R
address: 1b
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - packages
title: The shared packages
created: 2026-09-28T00:44:22.357Z
updated: 2026-09-28T00:44:22.361Z
---

<!-- block 01M3JQGKYQXMS50J8MV2G0JMVY -->

[packages/ts](code:packages/ts)

<!-- block 01M3JQGKYSXBVC935390HG3B8R -->

## What is here

Every `@sloppy/*` TypeScript package lives under `packages/ts/`. The workspace globs (`apps/*/*`, `packages/ts/*`) are non-recursive on purpose; `pnpm-workspace.yaml` says why.

Roughly by layer\:

- **Vocabulary**: `types`, the Zod schemas every other package speaks.
- **Talking to a backend**: `client` for a remote API, and `local` and `vault` for a graph served off the device as files.
- **Storage**: `data`, the SurrealDB table definitions and the per-user purge.
- **Identity**: `idp`, an embedded identity provider, and `openpgp`, which checks OpenPGP signatures.
- **The product**: `app-core` (every page, store and API call), `ui` (the design system) and `graph` (the canvas renderer).
- **Tooling**: `cli`, the `sloppy` command that reads, checks and writes a project's notes.

## Who formats what

Biome owns the pure TS/JS packages and Prettier owns everything Svelte. The split is declared once, in [biome.json](code:biome.json).
