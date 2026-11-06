# bench

What Sloppy's MCP server (`sloppy mcp`, docs/ARCHITECTURE.md § "An assistant outside the app")
does for an agent working in a project, measured against the other ways an agent gets the same
context: nothing, a pointer to the documents, the documents pasted into its prompt.

The suite exists to find out where Sloppy is slower, costlier or worse, so that those places get
a mitigation, an alternative, or a setting a person can change. A result that flatters Sloppy by
construction is worth nothing to that, so every rule below is about keeping the comparison honest,
and the code enforces it rather than this page asking for it.

Everything here is self-contained: its own `package.json`, `zod` as the only dependency, tests on
`node:test`. Nothing imports from `packages/`; the subject's own CLI is run as a program.

```
cd bench
npm install
npm test
node bench.mjs list
```

## The protocol

This section was written before any real run existed, and a change to it is a change to what the
committed results mean. Say so in the commit that makes one.

### Subject and variants

The **subject** is a project folder with a Sloppy container, described by a subject file (see
"Subjects"). The default is the subject `subject.json` names, at a recorded commit. A **variant** is that commit's
tree, prepared outside the repository (see "Variants"):

| variant      | what it holds                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `full`       | the project as it is                                                                                                                                   |
| `nodocs`     | the project with the subject's `docs`, its `container`, its `mcp_file` and every symlink to its `context_links` removed: no documentation and no graph |
| `notes-only` | the same removal, but the container kept: the notes are the only account of the project an agent can reach                                             |

For GitLab that is `doc/development`, `AGENTS.md`, `CLAUDE.md`, `.ai`, `README.md`, `.sloppy/`,
`.mcp.json` and every symlink to `AGENTS.md`.

`bench/` itself is removed from both, so no agent can read a task's answer key.

### Conditions

Nine conditions, identical in everything but how context reaches the agent and whether it may
start subagents: the same model, the same tools, the same task text, a fresh session for each run.

| id            | variant      | what is added                                                                                                                      |
| ------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `nodocs`      | `nodocs`     | nothing                                                                                                                            |
| `notes-only`  | `notes-only` | the `sloppy` MCP server and the line "This project's notes are reachable through the sloppy tools."                                |
| `bare`        | `full`       | nothing                                                                                                                            |
| `pointed`     | `full`       | one line naming the subject's `pointed` documents: "<files> are this project's documents of record; read what you need from them." |
| `dump`        | `full`       | the full text of the subject's `dump` files in the system prompt, in order, each under a heading naming the file                   |
| `mcp`         | `full`       | the `sloppy` MCP server, plus one line: "This project's notes are reachable through the sloppy tools."                             |
| `mcp+pointed` | `full`       | both of the above                                                                                                                  |
| `agents`      | `full`       | nothing, and the agent may start subagents                                                                                         |
| `mcp+agents`  | `full`       | what `mcp` adds, and the agent may start subagents                                                                                 |

They live in `conditions.json`. `subagents` is a condition's own field, false where absent: where it
is true the agent is offered its harness's subagent tool on top of the task's tool set, and a backend
that has none runs without it and records `unsupported: ["subagents"]` (see "Backends"), so such a
run is `bare` or `mcp` under another name and is read as one. Every system prompt opens with the same `base_system` line, and
the user prompt is the task text and nothing else. For GitLab the `pointed` line reads
"AGENTS.md, doc/development/architecture.md and doc/development/cells/_index.md are this project's
documents of record; read what you need from them."

### Task families

| family    | what the agent does                                                                | graded by                                              |
| --------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `why`     | answers a why-question the documents answer                                        | key terms, then the judge                              |
| `locate`  | names the file, symbol and tests that hold a rule                                  | key terms, then the judge                              |
| `drift`   | catches a planted change that contradicts a note                                   | key terms, then the judge                              |
| `change`  | makes a small code change                                                          | a hidden test                                          |
| `brief`   | explains the project to somebody arriving                                          | the judge                                              |
| `place`   | writes notes taken out of the container back in                                    | where they landed                                      |
| `handoff` | leaves a reason for the next person, who is then asked a question that turns on it | key terms on the second agent's answer, then the judge |

### Metrics

Per run: wall time, the time to the first token and first tool call where the backend can tell,
tokens by class (input, cache write, cache read, output, reasoning) and which classes the backend
could not tell, cost, turns, tool calls by name, sloppy calls by act, the prompt size of each model call and so the
context the answer was produced in, subagents started and their calls, files changed, and a score
in [0, 1]. A class the backend could not tell is never priced as zero: the run has no computed
cost, and its reported cost, where it has one, is the one used.

**Findability**, per run, under every condition alike: how many distinct files and how many
distinct notes the agent opened before it answered, its subagents' included. A file is opened
when it is read, when a search returns lines out of it, or when a shell command prints it (`cat`,
`head`, `sed` and their like, or a `grep` whose lines name it); a search that names files without
their lines, or a listing, opens none. A note is opened when a sloppy act returns its text
(`read_note`, `read_around`, and each note `brief` hands back with its text); a search hit or a
neighbour's gist opens none. A commit shown, a log read or a file blamed counts as a place opened
too, since a commit message is where a reason is often left. It is read from the run's transcript, so a run with none has none,
and a backend whose stream does not say what it read records none rather than 0 (see "The
record").

### What counts as better

A condition is compared with another on a task along two lines, each on its own: it is **better
on cost** only where its score is not lower AND its cost is lower, and **better on time** only
where its score is not lower AND its time to answer is lower. It is **better** where it is better
on both, and **mixed** where it wins one and loses the other — cheaper but slower, faster but
costlier — which is reported as mixed and never as a win. Lower cost or time bought with a lower
score is a trade, reported as one, not a win, and so is a higher score bought with a higher cost
or time: both numbers are shown, and neither is called a win. Conditions are compared on each
task's mean across reps, shown with its spread; a difference inside that spread, or one drawn
from fewer than 5 reps per condition, is a tie. Equal on both is a tie and is reported as a tie.
Every figure shows every condition that ran, including the ones where Sloppy loses. **A run that
started and did not finish `ok` — it failed, timed out or ran out of budget mid-run — scores 0
and stays in the cost and time it spent**, because it delivered nothing and the condition is
judged on what it delivered; a run the budget never started is counted and in no mean.

**The overall score** is one number per subject, backend, model tier, setting and condition,
for a reader who wants an all-in-all answer, and it never replaces the comparisons above. It
is the weighted mean of four parts, each in [0, 1], with **equal weights**:

| part      | what it is                                                                                                                   |
| --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `quality` | the mean score over the tasks that are not `handoff`, each task weighed the same                                             |
| `handoff` | the mean score over the `handoff` tasks: how well a reason left by one agent reached the next                                |
| `tokens`  | the leanest condition's mean input tokens (input, cache write and cache read) divided by this condition's; 1 for the leanest |
| `time`    | the fastest condition's mean wall time divided by this condition's; 1 for the fastest                                        |

`tokens` and `time` compare the conditions of one subject, backend, model tier and setting, each
over the tasks every one of them ran, so a condition is never cheaper for having run easier
tasks, and over the runs that finished, so a condition is never lean for failing early; a
handoff run's tokens and time are both of its stages'. A part that cannot be computed —
no handoff run, no task in common, tokens no condition could tell — is **absent, and named**:
the total is then null, and the mean of the parts present is given beside it as a partial total,
marked as one. The parts are always exported beside the total, with the weights used. The
weights are equal unless the export is told otherwise (`--weights`), and a total drawn with
other weights says so. The measurement is the same for every condition: no part reads whether
the condition reaches the sloppy server.

### Revisions

- **2026-11-06.** The subjects before the final test — this repository, syr, the private app,
  TiDB, Crossplane and Vector — are gone, with their packs, their fixtures and every record,
  grade, transcript and rebuilt prompt made on them, records with no `subject.name` among them.
  The six open-source projects of the final test are the subjects; the default is `gitlab`.
  Nothing any remaining task is sent changed.

- **2026-11-03.** Written before any handoff run existed. A seventh family, `handoff` (see
  "Handoff tasks"): one agent makes a small change for a reason that is nowhere in the project
  and leaves the reason where the next person will find it; a second agent, in the same
  condition and with no memory of the first, is asked something that turns on it, and that
  second answer is graded. **Findability** (see "Metrics") is recorded on every run, and read
  back from the transcripts of the runs made before it. **The overall score** (see "What counts
  as better") joins the export, with its four parts always beside it. Nothing any earlier task
  is sent changed; two tool sets, `edit` and `history`, exist for the handoff stages only.

- **2026-11-01.** A sixth family, `place`: notes taken out of the container and handed to the
  agent as text, scored on where it writes them back (see "Place tasks"). Each pack gains two
  such tasks, so a run that names no `--tasks` now runs them too. Nothing any other task is sent
  changed. `sloppy mcp --without <acts>` serves the server with those acts neither offered nor
  answered, so `--configs relate=…,norelate=…::--without=relate` compares the server with and
  without `relate`.
- **2026-10-31, later.** Records keep `sent`, what the run was sent, and each run's raw stream is
  kept as a transcript (see "What a run was sent, and what it did"). Nothing a run is sent
  changed; the prompt builder now reads the dump's files through a reader, which is the variant
  folder as before.
- **2026-10-31.** Two conditions, `agents` and `mcp+agents`, are `bare` and `mcp` with subagents allowed; the seven before them are byte-identical. Records now keep each model call's prompt size (`iterations`) and the context of the last call (`context_final`), so performance can be read against context length; earlier records are read with an approximation (see "The record"). The claude-code backend now reads its tokens from the session's per-model totals, which include subagents, instead of the last result's usage, which does not; on a run without subagents the two were equal on every stream checked, so earlier records mean what they did. It also passes `--include-partial-messages`, which changes nothing the agent sees.
- **2026-10-30, later.** The `pointed` and `mcp+pointed` line is composed from the subject's `pointed` list instead of naming this repository's files under every subject. On `sloppy` it is byte-identical to before, so records on this repository mean what they did; a run on another subject made before this was told to read `AI.md and docs/ARCHITECTURE.md`, whichever of them it held.
- **2026-10-30.** A subject is a file in `subjects/`, so the suite runs against a project other than this one (see "Subjects"). What `nodocs` and `notes-only` remove and what `dump` appends now come from the subject file; `subjects/sloppy.json` holds exactly the lists the code held before, so records on this repository mean what they did. Records carry `subject.name`; one without it was made on `sloppy`. Variant folders are now named `<subject>-<variant>-<sha>`, so variants prepared before this are made again.
- **2026-10-29, later.** A seventh condition, `notes-only`: the documents removed and the container kept, so the notes are the only account of the project the agent can reach. Every earlier batch had no cell in which the notes carried the knowledge on their own: `nodocs` had no notes, and every other condition had AI.md in context through `CLAUDE.md`. Also, the why tasks and the brief gained one rubric item worth one point: whether the answer names where its reason comes from. Earlier judge scores on those four tasks were given against the rubric without that item, so they are not directly comparable to later ones; the records carry their date.

Each revision changes what records made after it mean. A record carries its `subject.sha`, so
the batches on each side of one can be told apart.

- **2026-10-29: the `mcp` line no longer says "look there first".** The `mcp` and `mcp+pointed`
  conditions added "This project's notes are reachable through the sloppy tools; look there
  first." An agent in a project with Sloppy gets the server and its tools' own descriptions and
  no such instruction, and the instruction pushed it to search the notes where the documents
  it already had answered, which is the very behaviour those descriptions now try to change.
  The line is now "This project's notes are reachable through the sloppy tools." The batches at
  f420d155 and cafb15e0 ran under the old wording.
- **2026-10-29: the judge reads past a fence or prose, and is told an item's points are its
  weight, not its scale.** Across the two batches above, five verdicts on `locate-move-rule`
  were refused for a first item with no score in [0, 1], and one on `change-small` whose reply
  opened with a verdict and did not parse whole. The judge's replies were not kept; the rubric
  shows each item's points beside it, so the likeliest reading of the first is a 2-point item
  fully met scored as a 2. The instructions now
  say such an item scores 1, a refused verdict is logged with the item the judge gave, and the
  bar on a score is unchanged. Verdicts given before this were graded under the old
  instructions.

## Subjects

A subject is `subjects/<name>.json`, and `--subject <name>` picks it; `subject.json` names the
default (`gitlab`). `--subject` also takes the path of a subject file elsewhere, named by its base
name, so a copy pointing at another checkout of the same project records under the same name.

| field           | meaning                                                                                              |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| `path`          | the project, absolute or relative to `bench/`                                                        |
| `default_pack`  | the task pack a run takes when `--pack` is absent                                                    |
| `sloppy_cli`    | the built `sloppy.mjs` the `mcp` conditions run, absolute or relative to the project                 |
| `docs`          | the documents: paths inside the project that `nodocs` and `notes-only` remove                        |
| `container`     | the Sloppy container, removed by `nodocs` and kept by `notes-only`; it may not be among `docs`       |
| `mcp_file`      | the project's MCP config, removed by `nodocs` and `notes-only`                                       |
| `context_links` | files every symlink to which `nodocs` and `notes-only` remove, wherever in the project it sits       |
| `pointed`       | the documents of record the `pointed` conditions name, in order; a folder may stand for its pages    |
| `dump`          | the files the `dump` condition appends, in order, listed one by one; a document added later is added |
| `label`         | optional: the subject's name as a page shows it; the file's name where absent                        |
| `private`       | optional: `true` for a project that may not be quoted; see [The export](#the-export)                 |
| `research`      | optional: research kept beside the documents, counted by the export and removed by no variant        |

The subjects are six open-source projects: `gitlab`, `milvus`, `pulsar`, `llvm`, `carbon` and
`dotnet`. None has a Sloppy CLI of its own, so each file's `path` and `sloppy_cli` are absolute
paths on the developer's machine; edit them to yours. Each pack is `tasks/<name>/`, written against
the commit its `README.md` names.

To add a subject, write its file, run `node bench.mjs list` to see it load, and write it a task
pack. **The task pack is per subject**: a key and its `sources` cite that subject's documents, and
a pack run against another subject asks questions its documents do not answer. `tasks/example`
is a pack of one question about this repository; it runs against any subject with the mock, which
proves the plumbing and measures nothing.

### Carrying a project's documents

`carry-docs.mjs` brings a project's own design documents into its container, for a subject whose
notes are carried by a script rather than written (SURVEY.md § "How their documents become notes"):

```
node bench/carry-docs.mjs <project dir> <doc dir or file>... [--cli <sloppy.mjs>]
```

It runs `sloppy init` where the project has no container, then writes through
`sloppy mcp --profile full`. One `.md`, `.markdown` or `.mdx` document is one note: titled by the
H1 it opens with, else its front matter's title, else its file name; `about` its path; its
headings of the shallowest level below the title (level two or above) its sections, deeper ones
kept inside them, and the text before the first of them, with front matter's title, status and
date, an `Opening` section. Every repository file it names by a relative or root-relative path,
in a link, an image, a code span or plain prose, becomes a code link. Each note hangs under a note
for its folder, written first and titled by the folder's path unless a note about that folder is
already there; a folder's note hangs under the project's root note. Every write names `under`,
nothing is tagged, and documents go in path order, so the same input gives the same notes in the
same order. A heading met twice is numbered and a section past the size a write takes is
continued under the same heading. It prints the notes written, the words and links carried and
each file skipped with why.

## Fairness, and what enforces it

| rule                                                | enforced by                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No condition gets wording the others lack           | `lib/prompt.mjs` is the one prompt builder; the task text is the user prompt verbatim under every condition                                                                                                                                                                                      |
| Run order cannot favour a condition                 | `lib/order.mjs` shuffles every task × condition × config × rep from a seed, recorded on every record, so configs run in one batch share its hour                                                                                                                                                 |
| A variant leaks nothing the condition does not give | `lib/subject.mjs` makes each variant a fresh repository with one commit: no history, no remote, no `bench/`, and it refuses a work folder under any folder holding `AI.md`, `CLAUDE.md`, `AGENTS.md`, `.sloppy` or `.mcp.json`                                                                   |
| Every run starts from the same tree                 | the variant is reset to its snapshot before each run, ignored files included                                                                                                                                                                                                                     |
| No quiet retries                                    | none unless `--retries` is given; each attempt is its own record, and the failed one stays                                                                                                                                                                                                       |
| Spending stops where it was told to                 | `--budget-usd` is required; once spent, every run left is recorded with status `budget` and never started. A finished run whose cost cannot be told stops the batch, since the budget could no longer be held; a run killed at its time limit reports none and is charged the dearest run so far |
| The judge cannot favour a condition                 | the runner hands the judge the task and the answer text alone, never the condition, the variant's folder or the run's tool calls                                                                                                                                                                 |
| Results are never edited after the fact             | records are appended to `results/*.jsonl` and never rewritten; later grades are appended beside them, keyed by run id                                                                                                                                                                            |

Known limits, stated rather than hidden:

- An installed agent reads its own user-level settings and memory (for Claude Code,
  `~/.claude/`). They apply equally to every condition, but they are context the suite did not
  choose. The backend for each agent says what it switches off.
- An installed agent may read the project's own agent files as part of the project: in the
  `full` variant Claude Code reads `CLAUDE.md`, a symlink to `AI.md`, under every `full`
  condition. That is how the project meets that agent in practice, and it is why `bare` is not
  the same as `nodocs`.
- `wall_ms` is measured by the runner around the whole run, process start included.

## Running

```
node bench.mjs run --backend <claude-code|codex|api|mock> --budget-usd <usd> [options]
```

| flag           | meaning                                                                                 | default                         |
| -------------- | --------------------------------------------------------------------------------------- | ------------------------------- |
| `--backend`    | which agent runs the tasks                                                              | required                        |
| `--budget-usd` | the most the batch may spend, in USD                                                    | required                        |
| `--model`      | model id; an installed agent uses its own default when absent                           | none                            |
| `--provider`   | `providers.json` id; required for `api`                                                 | the agent's, from `agents.json` |
| `--subject`    | a subject's name in `subjects/`, or the path of a subject file                          | `subject.json` `default`        |
| `--sha`        | the subject commit to make the variants from                                            | `HEAD`                          |
| `--pack`       | the task pack                                                                           | the subject's `default_pack`    |
| `--tasks`      | comma-separated task ids                                                                | every task in the pack          |
| `--conditions` | comma-separated condition ids                                                           | all nine                        |
| `--reps`       | repetitions of each task × condition                                                    | 1                               |
| `--seed`       | the seed the run order is drawn from                                                    | random, and recorded            |
| `--timeout-ms` | how long one run may take                                                               | 600000                          |
| `--retries`    | how many times a failed or timed-out run is tried again                                 | 0                               |
| `--config`     | names the Sloppy configuration the subject is set up with, recorded on every run        | none: as shipped                |
| `--configs`    | several configurations interleaved in one batch, below; replaces `--sha` and `--config` | none                            |
| `--out`        | the folder records are appended to                                                      | `results/`                      |

Each run prints one line to stderr. `node bench.mjs report` prints a quick table of what
`results/` holds; `node bench.mjs list` shows the packs, conditions, backends and providers;
`node bench.mjs clean` removes the prepared variants.

Variants are made under `$SLOPPY_BENCH_WORK`, or `~/.cache/sloppy-bench` when it is unset — never the
system's temporary folder, which macOS empties of files left unread for a few days.
The `mcp` conditions run `node <sloppy_cli> mcp`, the subject file's `sloppy_cli`, so build the
CLI first: `pnpm --filter @sloppy/cli build` in this repository.

### Comparing configurations

Two configurations run in separate batches are not comparable: hours apart, every condition's
cost and time moves with the hour and the state of the provider's prompt cache, including the
conditions that never reach the server. `--configs` runs them in one batch instead:

```
node bench.mjs run --backend claude-code --model sonnet --budget-usd 60 --seed 3 \
  --configs default=<sha>,lean=<sha>:/abs/path/to/lean/packages/ts/cli/dist/sloppy.mjs
```

Each entry is `<name>=<sha>[:<cli>][:--arg...]`: the subject commit its variants are made from,
optionally the absolute path of the built `sloppy.mjs` its `mcp` conditions are served by, the
subject's `sloppy_cli` when absent, and optionally the arguments that server is started with
after `mcp` — the trailing segments that start with `--`. One build serves several
configurations this way, with an empty CLI where it is the subject's own:

```
node bench.mjs run --backend claude-code --model sonnet --budget-usd 60 --seed 4 \
  --configs default=<sha>,lean=<sha>::--profile=lean,terse=<sha>::--answers=terse
```

A server built from `mcp/brief` after the lean default landed starts lean with no arguments, so
a configuration measuring the full server there names `--profile=full`. Every recorded run
named `default` was served full: the builds behind them predate the change.

A server can also be started without some of its acts: `sloppy mcp --without relate` neither
offers `relate` nor answers a call to it, so this compares the server with and without it:

```
node bench.mjs run --backend claude-code --model sonnet --budget-usd 15 --seed 5 \
  --subject milvus --conditions bare,mcp \
  --configs relate=<sha>:/abs/sloppy.mjs,norelate=<sha>:/abs/sloppy.mjs:--without=relate
```

`--without` hides the act only: `write_note` still places a new note with no `under` by the same
ranking where its best candidate scores 0.5 or more, under both configurations.

The batch is every task × condition × config × rep in one seeded order, so the configurations'
runs alternate through the same hour. Each record carries its config's name in `config`, its
commit in `subject.sha` and the server's arguments in `sent.mcp_args`, and `report` gives each
config its own rows.

### The mock

`--backend mock` answers from `fixtures/mock/<task>.json` with fixed tokens and cost and no model,
so the whole runner can be exercised for free:

```
node bench.mjs run --backend mock --conditions bare,mcp --reps 2 --seed 1 --budget-usd 1
```

Its records go to `results/mock-*.jsonl`, which git ignores. Each answer splits the fixture's tokens
over its turns as calls whose prompts grow by one share each, and starts one subagent (the
fixture's `subagents_spawned`) where the condition allows them.
A fixture's `writes`, variant-relative paths to their contents, are written into the variant as the
answer's edits; the place tasks' mock answers write their notes this way.
A fixture's `calls`, each `{ name, input, result }`, go into the transcript, so findability is read
from a mock run as from any other; a sloppy act among them only where the condition offers the
server. A handoff task's stage A answers from `<task>.a.json` and its stage B from `<task>.json`.
`SLOPPY_BENCH_MOCK_FIXTURES` points it at another folder of fixtures. A fixture with no `tokens`
answers as a backend that can tell none, and `tokens_unknown` names the classes it cannot tell.

### An agent installed on this device

`claude-code` and `codex` drive the agent installed here, through your own sign-in. The suite
runs one only after you allow it in `agents.json`:

```json
{
  "allow_installed": ["claude-code"],
  "installed": {
    "claude-code": { "command": "claude", "provider": "anthropic" }
  }
}
```

`command` is a name on your `PATH` or an absolute path; `provider` is which `prices.json` entry
its runs are priced under. Anything not in `allow_installed` is refused before a run starts.

### A model through your own key

`--backend api` runs a minimal tool-using agent against a provider in `providers.json`:

```json
{
  "id": "deepseek",
  "kind": "openai-compatible",
  "base_url": "https://api.deepseek.com/v1",
  "key_env": "DEEPSEEK_API_KEY",
  "models": ["deepseek-chat"]
}
```

`kind` is `anthropic` or `openai-compatible`; any endpoint that speaks the OpenAI chat API is the
second. A new provider or model is an entry here, never code. The key is read from the environment
variable `key_env` names, at run time, and is never written to a record, a log or a file:

```
DEEPSEEK_API_KEY=... node bench.mjs run --backend api --provider deepseek --model deepseek-chat --budget-usd 2
```

## Prices

`prices.json` holds list prices in USD per million tokens, by provider and model, for each token
class, with the date they were read. A run's cost is computed from its tokens at those prices;
where the backend reports its own cost too, both are kept. **A model with no entry, or with a
`null` price, or a run whose backend could not tell a priced token class, gets no computed cost** — OpenAI's and DeepSeek's entries are `null` until somebody
fills them in from the provider's price page, and the batch then stops at its first finished run
unless the backend reports a cost itself, because the budget could not be held.

Each model also carries a `tier`, `small`, `medium` or `large`, which the export and the model-tier
figure read. A run's model is matched to the priced model sharing the most leading name segments
with it (`claude-sonnet-5-5` to `claude-sonnet-5`), else to one whose name holds every segment of it
(an alias `haiku`); a model matching none is `medium`.

## Tasks and grading

A pack is a folder, `tasks/<pack>/`, of one JSON file per task, named by its id. `lib/task.mjs`
is the shape:

| field       | meaning                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------- |
| `id`        | the file's base name                                                                                                |
| `family`    | `why`, `locate`, `drift`, `change`, `brief`, `place` or `handoff`                                                   |
| `prompt`    | the task text the agent receives, the same under every condition; a handoff task has `prompt_a` and `prompt_b`      |
| `tools`     | `read` for a question, `write` for a task that edits files                                                          |
| `key`       | what a right answer holds, for the judge; never shown to the agent                                                  |
| `sources`   | the documents and the sentences in them the key is written from                                                     |
| `grader`    | the objective check, below                                                                                          |
| `rubric`    | the criteria the blind judge scores, each with points                                                               |
| `setup`     | a patch (`patch`, or `patch_file` relative to `bench/`) committed into the variant first, or `remove_notes` (below) |
| `selection` | a place task's rule in words, the subject commit it was applied at and how many it took                             |

Each subject's pack is `tasks/<name>/`, and its `README.md` says how each task was written.
`node bench.mjs place` writes a pack's place tasks (see "Place tasks"); none of the six packs
carries any.

**Objective graders** (`lib/grade.mjs`) run after the agent, on the variant as it left it:

| kind        | score                                                                                                                                                                                                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `facts`     | the fraction of `required` facts (case-insensitive regular expressions) the answer states, less one share per `forbidden` fact it states, floored at 0                                                                                                                                     |
| `files`     | the fraction of `names` (paths and exported names; any of a list counts) the answer gives verbatim                                                                                                                                                                                         |
| `command`   | copies `hidden` files into the variant, runs the command there, 1 on exit 0 and 0 otherwise; the output's tail is kept in the notes, and the files are taken out again                                                                                                                     |
| `contains`  | the fraction of case-insensitive substrings found                                                                                                                                                                                                                                          |
| `placement` | per note taken out: 1 where it was written under the note it was taken from, 0.5 under that note's own parent or a sibling of it, 0 anywhere else or not written; with the share of the notes it named that the written note names averaged in where it named any; the mean over the notes |
| `none`      | no objective score; the judge alone scores the task                                                                                                                                                                                                                                        |

The hidden test of a `command` task lives under `fixtures/`, inside `bench/`, which no variant
holds, so the agent cannot read it.

**The judge** (`judge/`) is a separate step:

```
node bench.mjs judge [--judge-backend claude-code] [--judge-model sonnet] [--provider p] [--budget-usd 5] [--out dir]
```

It grades every run that finished `ok` and carries no judge score yet. Its prompt holds the task
text, the rubric, the key and the answer, and nothing else: not the condition, the backend, the
model, the cost, the tokens or the folder. It runs with no tools, in an empty folder, and must
answer with one JSON verdict, a score from 0 to 1 and one line of reason per rubric item. A fence
or a line of prose around that verdict is read past; a reply with no verdict, two different
ones, a score outside [0, 1] or an item missing is counted as a failure, logged with what the
judge gave, and the run stays ungraded for the next pass. The run's judge score
is the rubric's points-weighted mean, appended as a grade record in `results/grades/` with the
items, and with the judge's own tokens and cost. `--judge-backend mock` gives full marks to any
answer with text and none to an empty one, so the whole pipeline runs without a model.

A run's score is the mean of its objective and judge scores, whichever it has (`lib/report.mjs`
`scoreOf`); a run that started and did not finish `ok` scores 0.

### Place tasks

A place task asks whether an agent puts a note where it belongs. `node bench.mjs place --subject
<name> --sha <sha> [--count 5]` reads the subject's container at that commit and writes the pack's
two place tasks, `<subject>-place-thoughts` and `<subject>-place-root`, and their mock answers.
Each task file carries the rule it was picked by in `selection.rule`, applied in `lib/place.mjs`:

- **The root** is the parentless note the most notes spring out of. A note is eligible with a
  title and between 1 and 12,000 characters of sections, once citations of its parent are taken
  out; past that a note is a document pasted in rather than a note handed over.
- **thoughts** takes notes whose parent is a note other than the root: grouped by parent, the
  groups in order of `sha256("place:" + parent ULID)` and the members of each by
  `sha256("place:" + ULID)`, one from each group in turn, round after round. **root** takes the
  root's children in the same hashed order. Neither takes a note with its own parent or child.

The **setup**, `remove_notes`, deletes those notes' files from the variant and hangs each of
their children from the removed note's own parent, so the tree stays whole; links elsewhere that
name a removed note are left as they are. The result is committed as the variant's only commit,
with no parent and an empty reflog, so the history an agent can read holds no copy of what was
taken out. The previous snapshot stays in the object store for the next reset and no ref names
it; its sha is in `.git/bench-variant.json`, and an agent that went looking there could read the
notes back. The setup's commit is kept as `refs/bench/setup`, which is how the grader tells the
notes the setup left from the ones the agent wrote.

**The prompt** is the same under every condition: where the notes are and which file says how
one is written, the instruction to write each note under the note it springs out of and link it
to the notes it should be linked to, and each note's title and sections. Every citation of a
note's own parent is taken out of its sections — a link keeps its words, a compass slot naming
only the parent goes, and any other line still naming it goes — since it would name the answer.
Every other citation stays, so an agent that keeps the sections as given keeps those links.

**The grader** reads the container after the run. A written note is matched to a taken-out one by
title (case and punctuation aside), else by the closest title sharing at least half its words,
among the notes the setup did not leave; its parent is read from its file. The notes a taken-out
note named are its `links` and every note its sections cite, its parent and the other notes taken
out left out. Under `mcp` the agent can write through `write_note` or by hand; under `bare` it
writes the file from `AGENT.md`.

### Handoff tasks

A handoff task asks whether the reason for a change survives to the next person, and how hard it
is for them to find. It runs in two stages, in the same condition, configuration and variant:

1. **Stage A** is sent `prompt_a`: a small change to make, and the reason for it — a fact found
   nowhere in the project, concrete enough to check ("we cap X at 64 because a customer's proxy
   drops frames above it"). The same closing paragraph is added to every task's `prompt_a`
   (`HANDOFF_CLOSING` in `lib/handoff.mjs`): leave the reason where the next person who works on
   this code will find it, run none of the project's code, and end the answer with the commit
   message after a line `Commit message:`. It names no place to leave the reason: a code comment,
   a document, the commit message or, where the condition offers the sloppy server, a note are
   all open to it. Its tools are the `edit` set: read, search, list, edit and write files, and no
   shell, on every backend.
2. The runner commits the tree A left, every file it changed, with A's commit message (or
   `Change` where A gave none), on top of the variant's snapshot.
3. **Stage B** is a fresh agent on that commit, sent `prompt_b`: a question, or a decision to
   make, that turns on the reason. It never states the reason. Its tools are the `history` set:
   read, search and list files, and read the repository's history (`log`, `show`, `blame`), so
   a reason left in the commit message reaches B as it would reach a person; no shell. B's answer
   is graded by the task's `grader` and the judge, exactly as any other task, the judge seeing
   `prompt_b`, the key, the rubric and B's answer and nothing of A.

A run that stage A did not finish `ok` never starts B and scores 0. The record is B's run; stage
A is kept beside it in `stage_a`, with its own tokens, cost, time, calls, answer, commit message
and files changed, and its transcript as `transcripts/<run_id>.a.jsonl.gz`. Every cost, token and
time total counts both stages, the budget included. B's findability is the run's.

A handoff task file holds `prompt_a` and `prompt_b` in place of `prompt` and no `tools`; `key`,
`grader` and `rubric` are B's. `reason` states the new fact A is given, for a reader of the task;
it is never sent to B or the judge. The facts grader on each is tested against right paraphrases
and wrong answers (`test/handoff-tasks.test.mjs`). Codex cannot be offered file edits without a
shell, so it refuses a handoff run.

## The record

One record per run attempt, the same shape whatever ran it; `lib/record.mjs` documents every
field. Records are appended to `results/<backend>-<model>-<YYYY-MM-DD>.jsonl`. A grade written
after the run goes to `results/grades/*.jsonl` as its own record, keyed by `run_id`, so the run
records are never rewritten.

The fields added on 2026-10-31, each with a default, so every earlier record still reads:

| field               | meaning                                                                                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `iterations`        | the agent's own model calls in order, each `{ at_ms, input, cache_write, cache_read, output }`; a subagent's calls are in `tokens`, not here; empty where the backend cannot tell |
| `context_final`     | the prompt of the last call, `input + cache_write + cache_read`: how full the context was when the answer was produced; absent with no iterations                                 |
| `context_mean`      | the mean prompt size across the calls; absent with no iterations                                                                                                                  |
| `subagents_spawned` | subagents the run started                                                                                                                                                         |
| `subagent_calls`    | the subagents' tool calls by name, sloppy acts as `mcp__sloppy__<act>`; `tool_calls` and `mcp_calls` stay the agent's own                                                         |
| `unsupported`       | what the condition offered that the backend could not, so the run went without it                                                                                                 |

Added on 2026-11-03, optional: `searches_after_sloppy`, § "Searches after Sloppy answered".

`at_ms` is when the call arrived on the stream, counted from the backend's start (0 where it cannot
tell). A record without `iterations` (every record before that date, and every codex run) is read
with `context_final` and `context_mean` approximated as the run's input, cache write and cache read
tokens over its turns. That is a mean per call and understates the last call, by the most on the runs
whose context grew the most; the export marks every cell drawn from one `approx: true`, and the
figures draw those runs hollow.

The fields added on 2026-11-03:

| field         | meaning                                                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `findability` | `{ files, notes, opened }`: distinct files and notes the run opened before answering, and their sum (see "Metrics"); absent where the transcript cannot tell |
| `stage_a`     | a handoff run's first stage: status, timing, tokens, cost, turns, calls, iterations, what it was sent, its answer, `commit_message` and files changed        |

`node bench.mjs findability [--out dir] [--dry-run]` reads every kept transcript of a record
without `findability` and appends `{ run_id, files, notes, opened }` to
`results/findability/<date>.jsonl`, never rewriting a record; `--dry-run` prints what it would
write. The export reads a record's own `findability` first and the appended one after.

### What a run was sent, and what it did

Every run that starts records `sent`, exactly what the runner handed the backend: `system`, the
system prompt from `lib/prompt.mjs` (an installed agent appends it to its own); `prompt`, the task
text; `mcp`, whether the sloppy server was offered; `tools`, the tools the backend was told to offer
by its own names (`Read`, `Grep`, `Glob` for Claude Code; the tool set's name for codex, which names
none); and `model`, the model asked for, `default` where none was. A run the budget never started
has none.

Each run's raw stream is kept beside its record as `results/transcripts/<run_id>.jsonl.gz`, one
`{ ms, event }` to a line in arrival order, `ms` from the start: Claude Code's stream-json events,
codex's JSON events, and for `api` one exchange per request, its new messages and the provider's
reply (the request headers, which carry the key, are never kept). Before it is written, the value
of every environment variable whose name says key, token, secret, password, credential, auth,
cookie or session is replaced with `[redacted]`, and so is any string shaped like a known
credential. A short Claude Code run's transcript is about 10 to 25 KB.

Records made before `sent` was kept have their prompts rebuilt: `node bench.mjs backfill` writes
`results/prompts/<run_id>.json` for every committed record without `sent`, marked
`reconstructed: true`, with `from` naming the results file, the bench commit and the subject sha it
was rebuilt from. The prompt builder is deterministic, so each is rebuilt through it from the
bench at the commit that wrote the record's line (conditions, subject file and task) and the
subject at the record's sha; a superseded batch, set aside in the commit that fixed what it ran
under, is rebuilt from the commit before. Each system prompt is kept once, as
`prompts/systems/<sha256>.txt.gz`, and the file names it in `sent.system_file`, since the dump
condition's runs share a prompt of up to a megabyte. Those runs have no transcript: one exists only
for a run made from 2026-10-31 on.

### Searches after Sloppy answered

`searches_after_sloppy` counts, for a run that called Sloppy, the Grep, Glob and shell searches the
agent made once a Sloppy answer had already named the file the search was pointed at — its path, its
glob, or a path its command names — or the file the agent read next, before its next search. A shell
command is a search where one of the commands it runs starts with `grep`, `rg`, `ag`, `ack`, `find`,
`fd`, `locate`, `git grep` or `git ls-files`; `sed … | grep` reads a file and is not one. A file is
named where an answer spells its path, so a note's anchors, a brief's lines and `find_code`'s places
all count. Only the agent's own calls are read: a subagent never saw the answer. It is counted from
Claude Code transcripts (`lib/after-sloppy.mjs`) and absent for any other backend, for a run that
made no Sloppy call, and for a run with no transcript. The runner records it with each new run;
`node bench.mjs backfill` counts it for runs recorded before, into `results/derived/after-sloppy.jsonl`,
one `{ run_id, searches_after_sloppy }` a line, and leaves the records as they are. The export reads
a record's own count first and the backfill's after it.

`node bench.mjs report --run <run_id>` opens one run: what it was sent, rebuilt or kept, a timeline
of its model and tool calls, its answer and its grades; `--full` prints the whole system prompt.
The notebook's `show_run(run_id)` is the same reading.

## Backends

`lib/backend.mjs` holds the interface and the registry, keyed by `claude-code`, `codex`, `api`
and `mock`. A backend takes one request — the variant folder, the system prompt and the task
prompt, a tool set, the sloppy server where the condition offers it, the model, the timeout and
the budget left — and answers with the text, a status, timings, tokens, any cost it reported,
turns, tool and sloppy calls, and the files it changed. Every backend gets the same three tool
sets:

| set       | what the agent may do                                                                     |
| --------- | ----------------------------------------------------------------------------------------- |
| `read`    | read files, search their text, list them by pattern                                       |
| `write`   | the above, plus edit and write files and run a command                                    |
| `edit`    | `read`, plus edit and write files; no shell: handoff stage A                              |
| `history` | `read`, plus the repository's log, a commit and a file's blame; no shell: handoff stage B |
| `none`    | nothing: the judge's set                                                                  |

`history` is offered by a small MCP server, `tools/history-mcp.mjs`, under the name `history`
(Claude Code), and as `git_log`, `git_show` and `git_blame` (`api`); each runs `git` with its
arguments as a list, never through a shell. Its calls are tool calls, never sloppy calls.

Where the condition offers the sloppy server, it is offered as the repository ships it: every act
`sloppy mcp` advertises, started in the variant, under the name `sloppy`. Its calls are counted
by act in `mcp_calls` and never in `tool_calls`.

**`claude-code`** runs `claude -p <task> --output-format stream-json --verbose
--include-partial-messages`, with the condition's lines appended to Claude Code's own system prompt
through a file, `--tools` and `--allowedTools` naming the set, every other built-in tool (Task,
Agent, WebFetch, WebSearch, NotebookEdit and the rest) denied by name, and `--permission-mode
dontAsk`, so nothing outside the set is approved on the way. Where the condition allows subagents,
`Task` joins the set and neither `Task` nor `Agent` is denied; every other denial stands. `--strict-mcp-config` is always passed, with an empty server
list where the condition offers none, so no server configured on the machine or in the
project's own `.mcp.json` reaches a run. `--setting-sources project,local` keeps the user's own
hooks and plugins out; settings the organisation manages still apply, and so does the user's
own memory file. Sessions are not saved. It reports, from the stream: input, cache write, cache
read and output tokens from the session's per-model totals (`modelUsage`), thinking split out of
output as reasoning; the cost Claude Code computes; API time and time to first token; turns,
summed over every result the run ended in; the model that answered and the version; each of the
agent's own calls, its prompt by class from the message's start and its output from the message's
final delta; and the subagents started (`subagent_stats.spawned`). First tool and answer times are
when those events arrived. A run in which the sloppy server did not connect is an error, never a
run without it.

What Claude Code counts for a subagent, as observed on 2.1.311 with haiku, one run with the subagent
tool and one without on the same two-file folder: Claude Code offers the tool as `Task` and the
call arrives named `Agent`, so `tool_calls` counts it as `Agent`. The subagent's own calls arrive as
`assistant` messages carrying the `Agent` call's id as `parent_tool_use_id`; they are counted in
`subagent_calls`, never in `tool_calls` or `mcp_calls`, and carry no partial messages, so they are not
in `iterations`. The subagent was started in the background, and the stream then held **two**
`result` events: the first when the agent's turn ended while the subagent ran, the second after it
answered from the subagent's report. Each result's `usage` covers only the agent's own calls in its
stretch, and `usage.iterations` holds one entry, that stretch's last call, not one per call. The
session's `modelUsage` and `total_cost_usd`, the same in both results, include the subagent: cache
reads of 43,574 tokens were the agent's 23,128 and the subagent's 20,446, and the reported $0.00343
was `modelUsage`'s cost. So the run's tokens and cost include its subagents, and its context does
not. The agent wrote its cache at the one-hour rate and the subagent at the five-minute rate, so
such a run is priced at the cost Claude Code reports. With the tool not offered, `usage` and
`modelUsage` agreed exactly.

What it cannot report: Claude Code's own system prompt and tool descriptions are in the input
tokens and are not counted apart from the condition's. Claude Code writes the prompt cache at
the one-hour rate, which `prices.json` does not hold, so where it does (and where one run
answered with more than one model) no cost is computed and the reported one is used.

**`codex`** runs `codex exec --json` with `--sandbox read-only` for `read` and `none` and
`workspace-write` for `write`, the condition's lines as `developer_instructions`, and the
sloppy server passed as `-c mcp_servers.sloppy.command=… -c mcp_servers.sloppy.args=…`. It
reads tokens (cached input apart), shell, patch and MCP calls, turns and the final message
from the events. It cannot report a cost, API time, time to first token or its calls one by one, so
its records carry no `iterations`. It offers no subagents and records `unsupported: ["subagents"]`
where the condition allows them. **It has not been run live**: it was built from Codex's
documentation and is tested against a recorded stream.

**`api`** is a tool-use loop of at most 40 turns, written here, against a provider in
`providers.json`. Its tools are `read`, `grep`, `glob`, and for `write` also `bash` (in the
variant, stopped after 60 seconds), `edit` (one exact replacement) and `write`; none of them
reaches outside the variant. Where the condition offers the sloppy server, `lib/mcp-client.mjs`
starts `sloppy mcp` in the variant and every tool it lists is offered as `mcp__sloppy__<act>`.
An `anthropic` provider is called on the Messages API with the system prompt marked for
caching; an `openai-compatible` one on chat completions with function calling. Tokens are read
from each response: cached prompt tokens as cache read, reasoning tokens apart from the
completion; each response is one entry in `iterations`, timed when it arrived. No first-token
time, since it does not stream. The loop has no subagents: under `agents` and `mcp+agents` it runs
as under `bare` and `mcp` and records `unsupported: ["subagents"]`.

To allow an installed agent, add it to `allow_installed` in `agents.json` (see "An agent
installed on this device"); nothing installed runs before that. To add a provider, add an
entry to `providers.json` with its kind, endpoint, the environment variable holding its key and
its models, and its list prices to `prices.json`; no code changes. A provider that speaks
neither dialect is a new entry in `DIALECTS` in `backends/api.mjs`, and a new installed agent
is a new module under `backends/` and a new value in `lib/kinds.mjs`.

## Results and provenance

`results/` holds our own runs, committed. Each batch committed there is described in
`results/README.md`: the machine, the date, the backend and model, the subject commit, and who
ran it. Your own runs append to the same folder.

## Reading the results

`analysis.ipynb` reads `results/` (or the folder `BENCH_RESULTS` names) and its grades, and draws
every condition beside every other, one figure to a cell, each under a note saying what it shows
and what it does not. Every per-condition figure has one panel per subject and agent, and the
verdict table compares within one subject, agent and task, so a folder holding two subjects' runs
is never averaged across them:

- **Provenance**: which subject commit, agent, model, configuration, seeds and files the numbers
  come from.
- **Coverage**: runs per task and condition, and how they ended, budget stops included.
- **Cost** by condition and task, with a 95% bootstrap interval, per agent and model.
- **Tokens** by class, stacked; a class an agent could not tell is left out, never counted as 0.
- **Turns and calls**, sloppy acts included, and which acts were called.
- **Time** to the first tool and to the answer, and a delivery timeline of the mean run.
- **Score** by condition and task, with its interval.
- **Score against cost**, one point per run.
- **Better, worse, mixed or tied**: README § "What counts as better" applied in code to every
  pair of conditions on every task, with the means it was decided from.
- **The configuration axis**: the same by `--config`, where more than one ran.
- **Performance against context length**: each run's score against `context_final` on a log axis,
  with each condition's mean in log-spaced bands of context and its interval.
- **Best and mean** score per condition: the mean with its interval beside the best repetition of
  each task averaged over tasks.
- **Time per query**: wall seconds per model turn, and time to the answer, by condition.
- **Cost against context**, one point per run.
- **Model tier**: where several models ran on one subject, score by condition with one line per
  model.

The verdict table also shows each side's best repetition, which never decides a verdict. The
figures added on 2026-10-31 live in `figures.py`, which the notebook and the export both draw from,
in colours fixed to each condition and always paired with a marker.

A group of one run is drawn without an interval and labelled `n=1`, and the verdict table calls
anything drawn from fewer than 5 runs a side a tie.

```
./notebook.sh          # renders results/ to results/analysis.html
./notebook.sh --test   # runs the notebook over mock records, and over an empty folder
```

`notebook.sh` makes `.venv` and installs `requirements.txt` (pandas, matplotlib, jupyter,
nbconvert, nbformat) the first time. The notebook is committed without outputs, and neither
`.venv` nor the rendered page is committed.

## The export

```
node bench.mjs export [--out results-dir] [--to dir] [--no-figures] [--weights quality=1,handoff=1,tokens=1,time=1]
```

`--seeds 30` (or `21,22`) exports only the runs made with those seeds, so a page can show one batch — the final test — rather than every batch pooled.

writes `results/summary.json` and `results/figures/*.svg`, the figures drawn by `export_figures.py`
through `notebook.sh`'s environment from the same `figures.py` the notebook reads. Both are
committed, and regenerated by this command whenever `results/` changes; nothing else writes them.
`pnpm readme-figures` in `apps/sloppy/landing` redraws the root README's charts (`docs/images/bench-*.svg`) from it.
The JSON is what a page is built from:

| key            | holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generated_at` | when it was written                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `subjects`     | per subject, from its repository at the commit of its latest run: `label`, `sha`, `code_files` and `code_lines` (every tracked file outside its documents, container, MCP config, research and `bench/`, symlinks left out), `docs_files`, `docs_words`, `notes` (files under the container's `notes/`), `commits`, `research_words`; nulls where the repository cannot be read                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `models`       | each backend and model that ran, with its tier                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `conditions`   | each condition's `id`, `colour` and `marker` (a matplotlib code), in figures.json's order: the colours and shapes figures.py draws, for a page to draw with                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `cells`        | per subject, backend, model, config, condition and task: `n` started runs; `score_mean`, `score_best` and the 95% bootstrap interval of the mean (`score_lo`, `score_hi`, null under two runs); means of context, tokens, seconds, cost, turns and calls; `approx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `curves`       | per subject, backend, model, config and condition, one point per started run: its `run_id`, task, rep, `context_tokens`, score, wall seconds, turns, cost, and `approx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `groups`       | per subject, backend, model `tier`, `setting` and condition: the `models` behind it, `n` started and `scored` runs, each task's `n`, `scored`, mean `score`, `input` tokens and `cost`; then the mean over tasks, each task weighed the same, of score, tokens and cost with a 95% bootstrap interval drawn over tasks (`*_lo`, `*_hi`), the lowest and highest task score, mean turns, sloppy calls and subagents, and `runs_with_subagents`; `served`, whether the condition reaches the sloppy server. `setting` is `lean` under the config named lean, `default` under `full`, `default`, `shipped` (no config named) and `merged`, and the config's own name under any other, so a configuration of its own is never filed under either of the page's two; a condition that never reaches the sloppy server counts a run made under lean or default under both, and one made under any other config under that config's own |
| `figures`      | `id`, `title`, `caption` and `file` (relative to the JSON) of each figure drawn; a figure with nothing to draw is left out                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

Every cell and group also carries `findability_n`, the runs whose findability is known, and the
means `files_opened_mean`, `notes_opened_mean` and `opened_mean` over those runs (null where none
is). `overall_weights` holds the weights the overall score was drawn with, and each group's
`overall` holds it: `score` (null where a part is absent), `partial` (the weighted mean of the parts
present), `parts` (`quality`, `handoff`, `tokens`, `time`, each null where absent), `absent` and
`why_absent` naming the absent parts, `weights` and `weights_equal`, `compared_with` (the conditions
`tokens` and `time` were drawn against) and `tasks_compared` (how many tasks they shared). A
handoff run's tokens, cost and time in every cell, curve and group are both of its stages'.

A subject marked `private` keeps its numbers and nothing a page could quote: it is keyed
`private-<n>` under its label, its tasks `private-<n>-<family>-<k>`, with a null `sha` and no
`run_id` on its points, and the figures draw it under its label.

`mcp_calls_mean` counts the sloppy calls of the agent and of its subagents. `searches_after_sloppy_mean`,
in a cell and a group, is the mean over the runs that have a count (§ "Searches after Sloppy
answered"), and a group's `runs_counted_after_sloppy` is how many those are. A run that did not finish
`ok` scores 0 and is in every mean, as in § "What counts as better"; a run the budget never started is
in none. A config left unnamed is `shipped`.
