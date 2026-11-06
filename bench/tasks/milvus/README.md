# The Milvus pack

Eight tasks over Milvus (`subjects/milvus.json`), a Go, C++ and Rust vector database of about
650,000 lines. Every key and fact names in `sources` the sentence it comes from, and every one of
those cites Milvus's design documents **at `3ed06f8a`**, the commit the survey measured
(`survey/measured.json`).

| task                          | family | tools | graded by             | decision written                            |
| ----------------------------- | ------ | ----- | --------------------- | ------------------------------------------- |
| `milvus-why-autoid-upsert`    | why    | read  | facts, then the judge | 2026-08-03, landed in #53158 on 2026-09-17  |
| `milvus-why-rg-shard-leaders` | why    | read  | facts, then the judge | 2026-08-24, landed in #52716 on 2026-09-02  |
| `milvus-why-metacache-by-id`  | why    | read  | facts, then the judge | 2026-07-16 (the document's date)            |
| `milvus-why-import-v3`        | why    | read  | facts, then the judge | 2026-09-21, landed in #53334 on 2026-10-19  |
| `milvus-locate-wal-chunking`  | locate | read  | files, then the judge | 2026-08-22, landed in #52775 on 2026-09-02  |
| `milvus-locate-s3-auth-guard` | locate | read  | files, then the judge | added in #53728 on 2026-09-22               |
| `milvus-drift-ewma-seed`      | drift  | read  | facts, then the judge | 2026-10-19, landed in #54427 on 2026-10-21  |
| `milvus-brief-query-views`    | brief  | read  | the judge             | #51887 on 2026-08-11, revised to 2026-11-02 |

The dates are the document's own (its file name, its front matter or its Date line) and the
commit that landed it (`git log` on the document). Every one is after 2025-06-01, so none of these
decisions can be answered from memory. There is no change task: grading one needs Milvus's own
tests run, which this pack does not do.

## The base commit

`3ed06f8a` is the tip of Milvus's `master` when the survey measured it. The container is committed
on `sloppy/notes`, one commit on top of it that adds `.sloppy/` and `.mcp.json` and changes nothing
else, so every quote, path and patch here holds there unchanged. Run the pack with `--sha` of the
`sloppy/notes` tip; `--sha 3ed06f8a` runs the same tasks with no container.

## The tasks

- `milvus-why-autoid-upsert`, from `docs/design-docs/design_docs/20260803-autoid-upsert-primary-key-preservation.md`:
  Delete(P) and Insert(G) can commit in different WAL transactions, so a Snapshot can lose the
  entity; an existing key is kept, a missing one is allocated, an omitted one is refused, and the
  caller's key is only a lookup key because allocator ownership is the safety invariant.
- `milvus-why-rg-shard-leaders`, from `20260824-per-resource-group-load-and-shard-leader-readiness.md`:
  the tag is the replica's group because replicas borrow nodes; a response tag over a request filter
  for the proxy cache and for old coordinators; progress is the minimum over a group's replicas.
- `milvus-why-metacache-by-id`, from `20260716-proxy-metacache-id-inverted-index.md`: id-keyed
  primary with validated hints in place of invalidation scans, and fills ordered by `fillMu` in
  place of the timestamp floor.
- `milvus-why-import-v3`, from `20260921-import-v3-reshard-design.md`: read once into sorted,
  bucket-routed fragments, one sorted segment per plan, off by default behind a one-way gate.
- `milvus-locate-wal-chunking`, from `20260822-wal-payload-chunking.md`: `SplitIntoChunks` and
  `ChunkAssembler` in `pkg/streaming/util/message/chunk.go`, `appendWithOptionalChunking` in the WAL
  adaptor, the scanner that reassembles, and `streaming.splitChunkSN`. The design names
  `handleUpstream` in `scanner_adaptor.go`; the assembler is driven from `scanner_switchable.go` at
  `3ed06f8a`, and either file counts.
- `milvus-locate-s3-auth-guard`, from `docs/design-docs/s3-endpoint-auth-guard.md`:
  `GuardedS3EndpointProvider` and `InstallS3EndpointAuthGuard` in
  `internal/core/src/storage/minio/GuardedS3EndpointProvider.h`, installed from
  `MinioChunkManager::PreCheck`. All paths and names in both locate keys were checked to exist at
  `3ed06f8a`.
- `milvus-drift-ewma-seed` plants `fixtures/drift/milvus-refined-ewma-seed.patch`:
  `RefinedLookAsideBalancer.UpdateCostMetrics` now seeds its smoothed metrics whenever the smoothed
  service time is 0 instead of when the previous sample expired or never existed, its comment says
  so, and the two tests that pinned the old rule are replaced by one that pins the new. The rule it
  breaks is in `20261019-look-aside-balancer-fix-design.md` ("Seeding"): 0 is ServiceTime's normal
  value, so a 20ms outlier after a run of 0ms samples now jumps straight to 20, and an idle node's
  stale value is blended into its first fresh sample. The patch was checked with `git apply --check`
  at `3ed06f8a` only; Milvus's tests were not run on it. Its verdict fact counts only in an answer that also
  names the zero test, so a bare "no" earns nothing.
- `milvus-brief-query-views`, from `qviews/README.md`: who does what once StreamingNode stops
  being the delegator, the DataView and QueryView versions, the state machine, and that production
  routing is not switched yet. Judged only.

## How the pack was written

From the documents and the code, before and without reading the Sloppy notes. The tasks are asked
the way a developer on Milvus would ask them, and none names a document. Each `facts` task was scored with
`lib/grade.mjs` against at least three correct answers in other words, which must score 1 or
lose at most one fact, and at least two wrong answers, among them answers that use the right
vocabulary for a wrong claim, which must score at most a third:

```
milvus-drift-ewma-seed  correct: 1.00 1.00 1.00 1.00 1.00
milvus-drift-ewma-seed  wrong:   0.20 0.20 0.00 0.00
milvus-why-metacache-by-id  correct: 1.00 1.00 1.00
milvus-why-metacache-by-id  wrong:   0.00 0.00 0.00
milvus-why-autoid-upsert  correct: 1.00 1.00 1.00
milvus-why-autoid-upsert  wrong:   0.20 0.20 0.00
milvus-why-import-v3  correct: 1.00 1.00 1.00
milvus-why-import-v3  wrong:   0.20 0.00 0.00
milvus-why-rg-shard-leaders  correct: 1.00 1.00 1.00
milvus-why-rg-shard-leaders  wrong:   0.25 0.00 0.00
```

## The conditions on this subject

`docs` is `docs/design-docs` (172 Markdown files, about 490,000 words), `CLAUDE.md` (`AGENTS.md` is
its symlink) and `README.md`. `pointed` is `CLAUDE.md` and three central design documents: the WAL
summary, the query view design and the manifest format. `dump` is `CLAUDE.md` and then the design
documents most often cited by the repository's other Markdown files, as many as fit about 150,000
tokens (30 files, about 600 KB). `docs/agent_guides`, which `CLAUDE.md` points to, is not among the
documents and is not carried, so every condition keeps it.

## Handoff tasks

Two `handoff` tasks, `milvus-handoff-*`, written against `fad64304` (README.md § "Handoff tasks" in `bench/`). Each gives stage A a small change and a reason found nowhere in the project, and asks stage B something that turns on it. Their facts cite `prompt_a`, the only place the reason is written; `test/handoff-tasks.test.mjs` checks each against right and wrong answers, that stage B is never told it, and that it is new to the project at that commit.
