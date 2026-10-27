---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5Y2HRPVASGE80NTG2MBEFMG
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3E2FRSQAYC42VD7G7A1FQ8R
address: 1h
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - api
  - dev stack
title: "Blobs sit in SeaweedFS in the dev stack, since MinIO's image left Docker Hub"
created: 2026-10-27T07:00:16.731Z
updated: 2026-10-27T16:40:00.000Z
---

<!-- block 01M5Y2HRPXF0GB4KBW7BWVDK5P -->

## Where this sits

north: [[did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQH76ZS8W7KJMCZ29KASPR]]

The API above serves identities itself in dev, and what those identities are given — an avatar, a banner, an emoji, the picture behind a block — is kept in the object store of [the dev stack](code:docker-compose.yml). This note is where that store comes from and why it changed on 2026-10-27.

<!-- block 01M5Y2HRPYQB8JRXZWGX3ATV7D -->

## What changed and why

MinIO's image was withdrawn from Docker Hub, and a withdrawn repository takes every pinned tag with it: `docker compose up` answers "pull access denied for minio/minio, repository does not exist", and [the Verify workflow](code:.github/workflows/verify.yml) had failed at "Bring up the datastores" on every run since at least 2026-10-13. SeaweedFS 4.51 takes the slot. `weed mini` runs the whole store in one process; the gateway's one identity comes from `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, fed from the same `S3_*` values the API reads, so the two sides cannot disagree; the bucket named by `S3_BUCKET` is created as the store starts; `GET /healthz` on the S3 port is the health check; WebDAV, the admin UI and the master's telemetry are off, since nothing here uses them. Host ports are as they were: `S3_PORT` (9010) reaches the S3 API and `S3_CONSOLE_PORT` (9011) now reaches the filer's file browser, bound to this machine only because it asks for no credentials. [The API's store client](code:apps/sloppy/api/src/idp/blob-store.ts) did not change: it speaks S3 by path and does nothing a plain S3 does not. [CONTRIBUTING.md](code:CONTRIBUTING.md) names the browser where it named the console.

<!-- block 01M5Y2HRPYDJ1NXQGF0TPMK999 -->

## For a clone that ran the old store

`s3/data` still holds MinIO's layout. SeaweedFS writes its own files beside it and sees none of the old objects, so pictures given to dev identities before the switch do not load. `stack:reset` in [package.json](code:package.json) clears both stores, the database with them. To carry the pictures over instead, copy the bucket into the new store with any S3 client while the old image is still in the local Docker cache; it cannot be pulled again.

<!-- block 01M5Y2HRPZKK584TS1XD7848BH -->

## What was checked

Against a fresh SeaweedFS and SurrealDB in a separate compose project: an anonymous request is refused, a wrong secret is refused, the bucket is present at boot, a put, get and delete round-trip under the API's own client settings, and creating the bucket again answers that it is already owned. The TypeScript suites with `SLOPPY_INTEGRATION=1` passed 1090 of 1092 tests. The two that fail are the proxy's two rationing floods, which open 600 connections at once; a Mac's listen backlog is 128, and a bare Node server on this machine resets 471 of 600 the same way. They never reach the store, and the same floods are expected to pass on Linux, where an overflowed backlog retries instead of resetting — proven on the runner since: see below.

## On the runner, once the store could be pulled

Three more things stood between the workflow and green, none of them the store. SurrealDB's image runs as `nonroot`, and a bind-mounted directory that does not exist yet is created by the daemon as root, so on a Linux host the database answered "Permission denied" on its first write and left; [the workflow](code:.github/workflows/verify.yml) now makes `db/data` and `s3/data` first, open to any user, and [CONTRIBUTING.md](code:CONTRIBUTING.md) tells a Linux developer the same. Then every package's suite ran at once on the runner's few cores, and each suite's worker pool starved the others: a test that takes half a second on a laptop took twenty there, and a different handful crossed five seconds on every run. The workflow now runs the two halves of `test:ts` with a concurrency of one, and [the types package](code:packages/ts/types/vitest.config.ts) carries a thirty-second bound for its property suites, the way the identity package carries twenty. With that, Verify passed on 2026-10-27 — the first green run in its history — with the TypeScript job at thirteen minutes. The two rationing floods passed on Linux, as expected.
