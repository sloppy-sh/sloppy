# The GitLab pack

Eight tasks over GitLab (`subjects/gitlab.json`), the `gitlabhq/gitlabhq` mirror of GitLab's Rails
monolith, about 4.7 million lines. Every key and fact names in `sources` the sentence it comes
from, and every one of those cites GitLab's development documents **at `d7b9a617`**, the commit the
survey measured (`survey/measured.json`).

| task                            | family | tools | graded by             | decision written                                                     |
| ------------------------------- | ------ | ----- | --------------------- | -------------------------------------------------------------------- |
| `gitlab-why-state-propagation`  | why    | read  | facts, then the judge | 2026-07-07; `StatePrecedence` landed 2026-07-10                      |
| `gitlab-why-retention-strategy` | why    | read  | facts, then the judge | 2026-09-08; `RetentionPolicy` landed 2026-09-10                      |
| `gitlab-why-cells-claims`       | why    | read  | facts, then the judge | 2025-12-05                                                           |
| `gitlab-why-fixed-items`        | why    | read  | facts, then the judge | 2026-03-20                                                           |
| `gitlab-locate-cells-claims`    | locate | read  | files, then the judge | 2025-12-05                                                           |
| `gitlab-locate-retention-check` | locate | read  | files, then the judge | 2026-09-08; the spec's path written down 2026-10-15                  |
| `gitlab-drift-state-precedence` | drift  | read  | facts, then the judge | 2026-07-07                                                           |
| `gitlab-brief-cells`            | brief  | read  | the judge             | the Cells principles 2026-05-12; claims 2025-12; fixed items 2026-03 |

The dates are the commit that added the document to the mirror (`git log --diff-filter=A` on it),
or for the Cells principles the commit that added that section (`git log -S` on
`doc/development/cells/_index.md`). The mirror's commits are syncs titled "Add latest changes from
gitlab-org/gitlab@master", so a date is when the sync carried the change, a day or so after it
merged upstream. Every one is after 2025-06-01, so none of these decisions can be answered from
memory. There is no change task: grading one needs GitLab's own tests run, which this pack does not
do.

## The base commit

`d7b9a617` is the tip of the mirror's `master` when the survey measured it. The container is
committed on `sloppy/notes`, one commit (`91e491cf`) on top of it that adds `.sloppy/` and
`.mcp.json` and changes nothing else, so every quote, path and patch here holds there unchanged.
Run the pack with `--sha 91e491cf`; `--sha d7b9a617` runs the same tasks with no container.

## The tasks

- `gitlab-why-state-propagation`, from `doc/development/namespaces_state_propagation.md`: reading
  a namespace's state by walking its ancestors cost a query on every check and needed caching, so
  the state is written onto every descendant and a read is one column; the change and an outbox
  row commit together and a cron worker re-enqueues what stalls; a lower-precedence state never
  overwrites a higher one, so a subgroup scheduled for deletion stays so when its parent is
  archived.
- `gitlab-why-retention-strategy`, from
  `doc/development/database/database_growth_control/data_retention_policy.md` § "Why deleting rows
  is a last resort": deletes are a write workload paid forever (vacuum, no shrinking, WAL to every
  replica), detaching a partition is paid once, and `delete_rows` is for narrow, lightly indexed,
  low-traffic tables with no partition key.
- `gitlab-why-cells-claims`, from `doc/development/cells/claims.md` and § "Unique constraints" of
  `doc/development/cells/_index.md`: each cell has its own database, so a unique constraint cannot
  span cells; scope it by sharding key or claim it in the Topology Service; `delete_all` and
  friends bypass the claiming callbacks, so they schedule `Cells::BulkClaimsWorker` after commit.
- `gitlab-why-fixed-items`, from `doc/development/fixed_items_model.md` and § "Static data" of the
  Cells guide: a sequence gives the same row different ids on different cells, a fixed items model
  hard-codes them, and `_identifier` because `_id` implies a foreign key the database cannot
  enforce on an in-memory model.
- `gitlab-locate-cells-claims`: `Cells::Claimable` (`app/models/concerns/cells/claimable.rb`) and its
  save and destroy callbacks, `Cells::BulkClaimsWorker`, `Cells::Claims::VerificationService` and the
  two verification workers.
- `gitlab-locate-retention-check`: `db/docs/data_retention/`, `Gitlab::Database::RetentionPolicy` in
  `lib/gitlab/database/retention_policy.rb`, `spec/db/retention_policy_definitions_spec.rb` and its
  allowlist. The retention page names only the folder; the spec's path is in
  `doc/development/database/new_decomposed_database.md`. Every path and name in both locate keys was
  checked to exist at `d7b9a617`.
- `gitlab-drift-state-precedence` plants `fixtures/drift/gitlab-state-precedence.patch`:
  `StatePrecedence.overwritable_states` now overwrites every non-default state on any reversal,
  whatever the source, so unarchiving a group also takes its descendants out of
  `deletion_scheduled` and `maintenance`. Its comments and the three affected cases of
  `state_precedence_spec.rb` are rewritten to match. The rule it breaks is the State precedence
  table of `namespaces_state_propagation.md` ("Unarchive, but stop at `deletion_scheduled`"). The
  patch was checked with `git apply --check` at `d7b9a617` only; GitLab's tests were not run on it,
  so other specs may still notice.
- `gitlab-brief-cells`: what Cells asks of a new feature with tables and a job, from the Cells
  development principles, the sharding guide, claims and the fixed items model. Judged only.

## How the pack was written

From the documents and the code, before and without reading the Sloppy notes. The tasks are asked
the way a developer on GitLab would ask them, and none names a document. Every key and every mock
answer scores 1 against its own grader. After a fairness review, each objective grader was scored
with `lib/grade.mjs` against at least three correct answers in other words and at least two wrong
ones, including the reviewer's; the drift task's verdict needs the change framed as a departure, so
an answer that trusts the rewritten comments scores 0:

- `gitlab-drift-state-precedence`: correct 1.00, 1.00, 1.00, 1.00
  wrong 0.00, 0.00, 0.00
- `gitlab-why-fixed-items`: correct 1.00, 1.00, 1.00
  wrong 0.20, 0.00
- `gitlab-why-state-propagation`: correct 1.00, 1.00, 1.00
  wrong 0.00, 0.00
- `gitlab-why-retention-strategy`: correct 1.00, 1.00, 1.00
  wrong 0.00, 0.00
- `gitlab-why-cells-claims`: correct 1.00, 1.00, 1.00
  wrong 0.00, 0.00
- `gitlab-locate-cells-claims`: correct 1.00, 1.00, 1.00
  wrong 0.00, 0.00
- `gitlab-locate-retention-check`: correct 1.00, 1.00, 1.00
  wrong 0.00, 0.00

## The conditions on this subject

`docs` is `doc/development` (668 Markdown files, about 1,000,000 words), `AGENTS.md` (the
instructions file; `CLAUDE.md` is a one-line include of it and is listed too), `.ai` (the
instruction files `AGENTS.md` loads and the principles distilled from `doc/development`, about
86,000 words) and `README.md`. `doc/architecture`, which the survey's brief named, does not exist
in this mirror. `pointed` is `AGENTS.md`, `doc/development/architecture.md` and the Cells
development guide. `dump` is `AGENTS.md` and then the documents under `doc/development` most often
linked from the others, as many as fit about 150,000 tokens (18 files, about 600 KB), leaving out
the documentation, testing, language and i18n style guides; a document too large for what is left
is passed over for the next. None of the four why-documents is in it apart from the Cells guide:
on a corpus this size the dump holds about 75,000 of the million words. `doc/AGENTS.md` and
`workhorse/AGENTS.md`, instructions for writing the user documentation and for Workhorse, are not
among the documents, so every condition keeps them.

## The notes

Carried by `bench/carry-docs.mjs` from `doc/development`: 769 notes (668 documents and 101 folder
notes), 999,438 words and 3,267 code links; 124 images were skipped. `sloppy check` read 803 notes
(with the 34 that `sloppy init` wrote) and found nothing to fix.

## Handoff tasks

Two `handoff` tasks, `gitlab-handoff-*`, written against `91e491cf` (README.md § "Handoff tasks" in `bench/`). Each gives stage A a small change and a reason found nowhere in the project, and asks stage B something that turns on it. Their facts cite `prompt_a`, the only place the reason is written; `test/handoff-tasks.test.mjs` checks each against right and wrong answers, that stage B is never told it, and that it is new to the project at that commit.
