# The Pulsar pack

Eight tasks over Apache Pulsar (`subjects/pulsar.json`), about 1.2 million lines of Java with 316
design proposals under `pip/`. Every key and fact names in `sources` the sentence it comes from, and
every one of those cites Pulsar's documents or code **at `543ddd4e`**, the tip of `master` when the
survey measured it (SURVEY.md).

| task                              | family | tools | written from              | graded by             |
| --------------------------------- | ------ | ----- | ------------------------- | --------------------- |
| `pulsar-why-recycler`             | why    | read  | PIP-443, added 2025-09-29 | facts, then the judge |
| `pulsar-why-etcd`                 | why    | read  | PIP-462, added 2026-03-21 | facts, then the judge |
| `pulsar-why-json-schema`          | why    | read  | PIP-464, added 2026-03-23 | facts, then the judge |
| `pulsar-why-close-inactive`       | why    | read  | PIP-470, added 2026-08-27 | facts, then the judge |
| `pulsar-locate-topic-list-memory` | locate | read  | PIP-442, added 2025-09-18 | files, then the judge |
| `pulsar-locate-metadata-threads`  | locate | read  | PIP-453, added 2026-01-26 | files, then the judge |
| `pulsar-drift-v1-topic-names`     | drift  | read  | PIP-457, added 2026-03-09 | facts, then the judge |
| `pulsar-brief-scalable-topics`    | brief  | read  | PIP-460 to PIP-494, 2026  | the judge             |

## The base commit

`543ddd4e`. The container is carried onto it on the branch `sloppy/notes` of the subject's clone,
as one commit (`90b5fcdd`) that adds `.sloppy/` and `.mcp.json` and changes nothing else, so every
quote, path and patch here holds at the branch tip. Run with `--sha 90b5fcdd`; `--sha 543ddd4e`
runs the same tasks with no container.

The notes are carried by `carry-docs.mjs` from `pip/pip-*.md` (SURVEY.md § "How their documents
become notes"): 316 notes, 379,554 words, 113 code links, on top of the 68 `sloppy init` wrote.

## Why these decisions

Each date is the commit that added the proposal to `pip/`, read from `git log --diff-filter=A`. The
proposals numbered below 414 were added in bulk on 2025-08-22 when the wiki was moved into the
repository, so their date says nothing about when they were decided; none is used. Every task is
drawn from a proposal added after 2025-06-01, and each was checked to be built at `543ddd4e`, so the
key describes running code: the etcd refusal in `MetadataStoreFactoryImpl.findProvider`, the
`schemaJsonAllowLegacyJacksonFormat` switch in `StructSchemaDataValidator` and
`JsonSchemaCompatibilityCheck`, the close branch of `PersistentTopic.checkGC`, the limiter classes
and the metadata store executors.

`pulsar-why-recycler` is the one whose rule the canonical documents also state: `CODING.md` says
not to add new `Recycler` usage and links PIP-443. `CODING.md` is not among the subject's `docs`, so
every condition keeps it; the task measures whether an answer finds the reasons, which only the
proposal gives.

## The drift task

`pulsar-drift-v1-topic-names` plants `fixtures/drift/pulsar-v1-topic-names.patch` as a commit
before the run. In the `TopicName` constructor a fully qualified four-part name, which PIP-457 says
must be refused with an `IllegalArgumentException`, is instead accepted with its cluster component
dropped, and the comment there and the two matching cases in `TopicNameTest` are rewritten to
agree. `TopicName.toFullTopicName` is left rejecting four-part names, so the two now disagree.
The patch is checked with `git apply --check` against `543ddd4e` only: Pulsar's build and tests
are not run here.

## No change task

A change task is graded by the project's own tests, and running Pulsar's Gradle build was outside
what this pack was allowed to do. The pack has no change task, and its results are not comparable
with the other subjects' on that family.

## The conditions on this subject

`docs` is `pip/`, `AGENTS.md` (to which `CLAUDE.md` links) and `README.md`. `ARCHITECTURE.md`,
`CODING.md`, `CONTRIBUTING.md` and `spec/` stay in every variant. `pointed` names `AGENTS.md` and
the three proposals other documents cite most: PIP-460, PIP-468 and PIP-486. `dump` is `AGENTS.md`
then proposals in order of how many other documents in the repository cite them, ties broken by the
newer proposal first, stopping at the first that would take the total past about 150,000 tokens
(bytes divided by four): 12 files, about 143,000 tokens. None of the why, locate or drift tasks'
proposals is in it; the brief's main proposals are.

## Writing them

Prompts were written as a developer on Pulsar would ask them, from the proposals and the code,
without reading the carried notes. Each objective grader is scored with the bench's own
`gradeObjective` against at least three correct answers worded differently and at least two wrong
ones, among them those a fairness review wrote to break it. A correct answer must score 1, or miss
at most one fact; a wrong one must score at most a third. The scores at the last revision:

| task                              | answers | scores              |
| --------------------------------- | ------- | ------------------- |
| `pulsar-why-etcd`                 | correct | 1.00 1.00 1.00      |
|                                   | wrong   | 0.00 0.00 0.00 0.00 |
| `pulsar-why-recycler`             | correct | 1.00 1.00 1.00      |
|                                   | wrong   | 0.00 0.00 0.00      |
| `pulsar-why-close-inactive`       | correct | 1.00 1.00 1.00      |
|                                   | wrong   | 0.00 0.00           |
| `pulsar-why-json-schema`          | correct | 1.00 1.00 1.00      |
|                                   | wrong   | 0.00 0.00           |
| `pulsar-drift-v1-topic-names`     | correct | 1.00 1.00 1.00      |
|                                   | wrong   | 0.25 0.25 0.00      |
| `pulsar-locate-topic-list-memory` | correct | 1.00 1.00 1.00      |
|                                   | wrong   | 0.00 0.00           |
| `pulsar-locate-metadata-threads`  | correct | 1.00 1.00 1.00      |
|                                   | wrong   | 0.00 0.00           |

`pulsar-brief-scalable-topics` has no objective grader; the judge alone scores it.

## Handoff tasks

Two `handoff` tasks, `pulsar-handoff-*`, written against `90b5fcdd` (README.md § "Handoff tasks" in `bench/`). Each gives stage A a small change and a reason found nowhere in the project, and asks stage B something that turns on it. Their facts cite `prompt_a`, the only place the reason is written; `test/handoff-tasks.test.mjs` checks each against right and wrong answers, that stage B is never told it, and that it is new to the project at that commit.
