# Does Sloppy help a coding agent? The benchmark, written up

The research write-up behind the results on sloppy.sh. The site shows the numbers; this says how
they were made, what explains them and what they do not show. Numbers are from the export of
2026-11-04 (`results/summary.json`, generated 13:16 UTC) and from `SURVEY.md`; a later export
moves them, and the site follows the export, not this page. README.md is the protocol of record.

## The question

When a project's reasons are written down, does an agent that reaches them through Sloppy answer
better, or for less, than the same agent reading the repository's own documents? And on what kind
of project?

## Subjects and how they were chosen

| Project           | Lines of code | Words of docs | Doc files | How its documents are named              | Notes carried by  |
| ----------------- | ------------- | ------------- | --------- | ---------------------------------------- | ----------------- |
| syr               | 113k          | 72k           | 66        | a site of pages, one topic each          | agent writers     |
| Sloppy's own repo | 381k          | 113k          | 8         | a few long documents and AI.md           | written alongside |
| The private app   | 410k          | 142k          | 60        | not described                            | agent writers     |
| Pulsar            | 1.3M          | 391k          | 342       | proposals by number, `pip/pip-NNN.md`    | script, verbatim  |
| Milvus            | 3.6M          | 500k          | 220       | design documents by date, `YYYYMMDD-...` | script, verbatim  |
| GitLab            | 15.4M         | 1.1M          | 872       | folders of files named for their subject | script, verbatim  |

The first three were the projects at hand. The last three were chosen by a rule committed before
any candidate was looked at (`SURVEY.md` § "The rule"): reasons written down in the repository, at
least 150k words in 80 files, scattered, at least 100k lines of open-source code, a gradable test
suite, and some decisions written after mid-2025. 35 repositories were measured; seven passed; the
top three by the rule's ranking were run.

The private app's runs are counted in every aggregate, but none of its runs, prompts, transcripts
or documents is published, and nothing from them is quoted here.

## Conditions

All four run Claude Code with the same tools, the same task text and a fresh copy of the project:

- **Docs alone** (`bare`): the code, the documents and the instructions file.
- **Subagents allowed** (`agents`): the same, allowed to start helper agents.
- **With Sloppy** (`mcp`): the same as docs alone, plus the notes through Sloppy's MCP server.
- **Notes only** (`notes-only`): the documents removed; the notes, written from them, instead.

Sloppy is reported as it ships (`lean`). The earlier subjects also ran every document pasted into
the prompt (`dump`), nothing at all (`nodocs`) and documents pointed at (`pointed`); those runs are
published with the rest and not discussed here.

Models: Sonnet on every project; Haiku and Opus on syr, Sloppy's repo and the private app.

## Task families

- **Why**: explain why the code is built as it is; the answer is in a document.
- **Locate**: name the files and functions where a rule lives.
- **Drift**: the code is changed before the run so only the documents still say what it is for;
  notice it.
- **Change**: make a change; a held-back test decides (not on the three survey projects).
- **Brief**: brief a newcomer on one area, saying where each rule is written.
- **Handoff**: one agent makes a change for a reason found nowhere in the project and leaves the
  reason behind; a second agent, with no memory of the first, is asked something that turns on it.

## Scoring

Each answer has automatic checks (facts a right answer must state, exact paths, or the hidden test)
and a blind judge, a Claude model that reads it against a written checklist without knowing the
condition. The score is their mean, 0 to 1; brief tasks are judged alone. Tokens are everything the
model read, re-reads included; cost is at list prices; time is wall-clock over finished runs. Runs
are interleaved in a seeded order. On the site, a score difference under 0.03, or a token, cost or
time difference under 10%, is shown as level.

## Results

Sonnet, Sloppy lean against docs alone, means over tasks:

| Project           | Score, docs | Score, Sloppy | Tokens, docs | Tokens, Sloppy | Cost, docs | Cost, Sloppy | Time, docs | Time, Sloppy |
| ----------------- | ----------- | ------------- | ------------ | -------------- | ---------- | ------------ | ---------- | ------------ |
| syr               | 0.93        | 0.93          | 59k          | 65k            | $0.068     | $0.072       | 21 s       | 17 s         |
| Sloppy's own repo | 0.98        | 0.98          | 79k          | 119k           | $0.084     | $0.128       | 18 s       | 31 s         |
| The private app   | 0.78        | 0.77          | 264k         | 238k           | $0.180     | $0.177       | 49 s       | 45 s         |
| Pulsar            | 0.88        | 0.92          | 65k          | 86k            | $0.084     | $0.094       | 33 s       | 27 s         |
| Milvus            | 0.92        | 0.95          | 128k         | 106k           | $0.157     | $0.130       | 37 s       | 31 s         |
| GitLab            | 0.89        | 0.91          | 53k          | 71k            | $0.073     | $0.083       | 31 s       | 27 s         |

- **Score**: level on five projects, higher on Pulsar, lower nowhere.
- **Tokens**: fewer only on Milvus; more on syr, Sloppy's repo, Pulsar and GitLab; level on the
  private app.
- **Time**: faster on syr, Pulsar, Milvus and GitLab; slower on Sloppy's repo.
- **Subagents** were started in none of the 384 survey runs; that line is the same agent with the
  option open.
- **Other models**: on the private app Opus with Sloppy scored 0.80 against 0.77, and Haiku 0.67
  against 0.73. On syr and Sloppy's repo every model was within 0.02.

## Why Sloppy wins where it wins, and loses where it loses

Read from the Sonnet transcripts (`results/transcripts/`): the tool calls, what each returned and
which document was opened. Open-source subjects only.

**The document's name decides it.** Where the document that answers cannot be found by its name,
Sloppy's first call matches the question's words against the notes and hands back the right one.
On Milvus, whose design documents are named by date, why-questions took 13 turns and 172k tokens on
average with the docs alone, and 5 turns and 95k with Sloppy. On the cache question
(`milvus-why-metacache-by-id`) the docs-alone runs read the streaming-system guides and
`internal/proxy/metacache/meta_cache.go` for 13 to 14 turns and never opened the design document
that gives the reason; with Sloppy, `brief` returned it first and the run ended in 6 turns. Every
Sloppy why-run on Milvus opened the answering note; 9 of 16 docs-alone runs opened a design
document. On Pulsar, whose proposals are numbered, 5 of 16 docs-alone why-runs opened a proposal and
the rest answered from the code; 22 of 24 with Sloppy read the proposal's note.

**Where the name already says it, Sloppy only adds.** GitLab's documents are named for their
subject (`doc/development/database/database_growth_control/data_retention_policy.md`); the
docs-alone agent opened a document in 13 of 16 why-runs. Sloppy's first answer there was 19k to 37k
characters, and it stays in the context for every later turn while the agent searches as it would
have anyway: 71k tokens against 53k. On Sloppy's own repo and on syr the decisions sit in an
instructions file every session reads, or in a small topic-named site, so the notes add a call and
change no answer.

**Briefs lost to excerpts.** On a brief the agent worked from the spread of excerpts Sloppy
returned instead of reading the one document whole. On GitLab's Cells brief the docs-alone agent
read `doc/development/cells/_index.md` whole (33k tokens); with Sloppy it took a 37k-character
first answer, then grepped the same file for headings (93k to 130k tokens). Brief scores, Sonnet
lean: GitLab 0.59 against 0.84, Milvus 0.88 against 0.91, Pulsar 0.73 against 0.73.

**Time follows turns.** Wherever Sloppy was faster it took fewer turns (Milvus 5 against 10, Pulsar
6 against 7, GitLab 5 against 7). On Sloppy's repo it was slower with a similar number of turns;
those runs carry no transcripts, so the reason is not traced.

## Who it is for

**Large codebases.** On the four projects whose reasons outgrow what an agent reads by default — the
private app, Pulsar, Milvus and GitLab, 142k to 1.1M words of design documents — Sloppy comes out
marginally ahead of the usual ways of working, on average across them: answers slightly better, at lower cost, in less
time and with fewer round trips to the model (`bench/results/summary.json`, drawn in
`docs/images/bench-aggregate-*.svg`). The gain is largest where the documents are many and named by
date or number, so a filename search does not find the one that answers.

**Not small, well-documented repositories.** On syr and Sloppy's own repository, whose instructions file
already holds most answers, Sloppy ties on score and reads more, so the loop left them after round two.

## What changed because of it

The losing mechanism was the size of the first answer. A smaller first `brief` hands back the best
matching note's opening section and the sections the question's words reach, with a few other
titles, at about a tenth of the size (`SURVEY.md` § "A smaller first answer"). Measured before
against after, Sonnet, `mcp` only, 120 runs, against criteria written first:

- Where Sloppy had read more than docs alone: 26% fewer tokens (97k to 71k), score unchanged. Held.
- Where Sloppy had won: 8% fewer tokens, score unchanged. Held.
- Brief tasks no lower: wrong. GitLab rose from 0.57 to 0.69, Milvus stayed at 0.88, Pulsar fell
  from 0.71 to 0.56 and the private app from 0.53 to 0.48. A smaller answer hands over fewer of the
  documents a brief ties together.

The change ships; the briefs go into the next round as the known weakness.

## What did not work

- **The code index went unused.** `find_code`, which says where something is in the code, was
  offered in 60 runs and called once. Scores and searches did not move. An agent does not reach for
  a new act because it exists; what changes its choices is what the calls it already makes return.
- **Briefs**, above.
- **The handoff task is saturated.** The second agent recovered the first one's reason 0.76 to 1.00
  of the time under every condition, because the reason is left beside the code it explains. A
  handoff where the reason is needed somewhere else would separate the conditions.
- **The overall score rewards cheap and worse.** With equal weights on quality, handoff, tokens and
  time, notes only wins the total on the private app although its answers were the weakest. The
  parts are reported beside the total for that reason.

## Threats to validity

- **Repetitions**: two runs a task on the survey projects; single tasks moved 0.17 to 0.33 between
  builds that differ in one place. Read project means, not tasks.
- **One author**: the benchmark, the tasks and the earlier projects' notes are ours. The survey
  projects' notes were carried by script, word for word, which adds no knowledge but also means
  their results say nothing about notes written by hand.
- **The judge is a Claude model**, blind to the condition but not to style.
- **Development set**: the smaller brief was measured on the tasks that motivated it. A fresh pack,
  written by somebody who has seen none of the changes, is the result that counts (`SURVEY.md` §
  "The rerun").
- **Older runs** on syr and Sloppy's repo predate transcripts, so their mechanisms are inferred from
  the records, not traced.

## Next

- Run the fresh task pack on every project, the final build against the build the rounds started
  from.
- A brief that hands over enough of several documents without returning to the large first answer.
- A handoff task whose reason is needed away from the change.
- More runs a task on the survey projects, so a task-level difference can be read.
