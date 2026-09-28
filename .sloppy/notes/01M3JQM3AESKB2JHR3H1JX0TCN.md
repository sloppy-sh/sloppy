---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQM3AESKB2JHR3H1JX0TCN
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQGKYNV7HMP3611A245MPN
address: 1b5
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - data
  - storage
title: "data: the shape of the store"
created: 2026-09-28T00:46:16.398Z
updated: 2026-09-28T00:46:16.401Z
---

<!-- block 01M3JQM3AGPDVZ07T1JJ4ZP3Y2 -->

[packages/ts/data](code:packages/ts/data)

<!-- block 01M3JQM3AH1JN77SN642CSQK2S -->

## What it is

`@sloppy/data` is what every surface that holds Sloppy's rows in SurrealDB has to agree on. That is the hosted API against a remote database, and the native app against an embedded one.

- [schema.ts](code:packages/ts/data/src/schema.ts): every `DEFINE TABLE` and `DEFINE INDEX`, in one string. In production SurrealDB serves only tables that are defined, so a table missing from this string fails there even when it works locally.
- [purge.ts](code:packages/ts/data/src/purge.ts): deleting everything one person owns, table by table, keyed by `created_by`.

The queries that read and write one entity are not here. They live beside the API service that owns that entity.
