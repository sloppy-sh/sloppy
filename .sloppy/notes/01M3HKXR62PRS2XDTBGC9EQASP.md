---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3HKXR62PRS2XDTBGC9EQASP
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3HKX28V3SDGTQF38FB3AZHK
aliases:
  - 1a1
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - apps
  - architecture
title: "The three apps: an API and two shells"
created: 2026-09-27T14:22:23.938Z
updated: 2026-09-27T14:22:23.945Z
---

<!-- block 01M3HKXR662F9QAVN6AAF5FKNJ -->

[apps/sloppy](code:apps/sloppy)

<!-- block 01M3HKXR69252SQS1DAE83F6TJ -->

## What lives here

Three deployables, and only one of them has product logic of its own\:

- **`api/`** — the NestJS backend for hosted and self-hosted Sloppy, over SurrealDB.
- **`web/`** — the SvelteKit single-page shell a browser loads.
- **`native/`** — the Tauri shell for iOS, iPadOS, Android and desktop, with Rust in `src-tauri/`.

The two shells are deliberately thin boots over `@sloppy/app-core`: every page, component and store lives there, so a route added to a shell is almost always a change that belongs in app-core. The API is the opposite — it owns the SurrealQL for each entity, beside the service that owns the concern, while the table definitions it shares with the device come from `@sloppy/data`.
