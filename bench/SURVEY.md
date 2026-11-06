# The survey: where Sloppy should help, chosen before it is measured

Written and committed on 2026-11-03, before any candidate repository was looked at. The rule below
picks the projects; the predictions are added, in a dated section, once the projects are chosen
and before a single run. Every project chosen is reported, whatever it shows. README.md § "What
counts as better" is unchanged and still decides every comparison.

## What the earlier subjects suggest

On Sloppy's own repository and on syr the notes tied the documents: their decisions fit in what an
agent reads anyway, and the instructions file already carries most of them. On a private app, with 142k
words of its own documents, Sonnet with Sloppy matched the documents alone for 19% less a task, and
Opus did slightly better; Haiku did not. So the claim worth testing is narrower than "Sloppy is
better": **Sloppy pays where the reasons behind the code are too many, and too scattered, for an
agent to find by reading files.**

## The rule

A project is a candidate when all of these hold, measured on its default branch:

1. **The reasons are written down in the repository**: design documents, RFCs, ADRs or
   architecture notes that say why, not only how to use it. Reference and API docs do not count.
2. **There are many of them**: at least 150k words of such documents, in at least 80 files.
3. **They are scattered**: no single file, the instructions file included, carries most of them.
4. **The code is real**: at least 100k lines, under an open-source licence that allows copying it.
5. **A change can be graded**: one package's tests run on this machine in under ten minutes.
6. **Not all from memory**: some of the decisions were written after mid-2025, past what the
   models were trained on, so a task can be set that the model cannot answer from memory. Tasks
   are drawn from those where there are enough.

Candidates are ranked by how far the documents exceed the rule's floor, then by how recent they
are. The top three that pass are benchmarked; a project dropped for a practical reason is named
here with the reason.

## How a chosen project is benchmarked

As syr and the private app were: its documents carried into a container one document per note by writers
who are not told the tasks, a task pack in every family written from the documents and the code
with grading the README describes, and the same conditions, models and seeds as the other
subjects, full and lean interleaved where the server is compared.

## What the survey found (2026-11-03)

35 repositories were found by searching and from a seed list, shallow-cloned and measured;
`survey/measured.json` holds every number and how it was got. Seven pass the rule:

| Project               | Words of design documents | Files | Lines of code | Instructions file |
| --------------------- | ------------------------- | ----- | ------------- | ----------------- |
| gitlabhq/gitlabhq     | 1,018,602                 | 668   | 4,694,959     | 784 words         |
| milvus-io/milvus      | 486,357                   | 169   | 653,382       | 1,615 words       |
| apache/pulsar         | 379,814                   | 316   | 1,214,029     | 914 words         |
| pingcap/tidb          | 239,936                   | 120   | 1,822,498     | 1,996 words       |
| crossplane/crossplane | 218,820                   | 82    | 103,944       | none              |
| vectordotdev/vector   | 180,447                   | 80    | 472,994       | 1,164 words       |
| vmware-tanzu/velero   | 157,064                   | 80    | 269,157       | none              |

Notable failures: CockroachDB and Materialize keep large decision records but are not under an
open-source licence; dotnet/runtime's tests need a prerelease SDK bootstrapped first; Neon,
Hudi, NumPy, Kueue and Gateway API fall under the word or file floor.

**Chosen, by the rule's ranking: GitLab, Milvus and Pulsar.** TiDB is next if one of them turns
out to fail item 5 in practice. Go was installed (Homebrew, 1.27.3) for Milvus's tests.

**How their documents become notes.** Unlike syr and the private app, whose notes were carried by agent
writers, these are carried by a script, so nothing is added that the documents do not say: one
document is one note, its headings its sections, `about` the document's path, hung under a note
per directory, and linked to every file in the repository the document names by path. That is
how a team would bring documents it already has, and it costs nothing to repeat. It is also a
difference from the first three subjects, and is named wherever their results sit together.

## Predictions, committed before the first run (2026-11-03)

The batch: Sonnet through the installed Claude Code; GitLab, Milvus and Pulsar; the conditions
plain Claude Code with the docs (`bare`), allowed subagents (`agents`), with Sloppy (`mcp`) and
notes only (`notes-only`); the server full and lean interleaved in one seeded order; two runs a
task; graded by the same blind judge. There is no change task in these packs, because grading one
would run the project's own tests. What I expect, judged by README.md § "What counts as better":

1. **Score: a tie.** Sloppy, lean, within 0.05 of the documents alone on every project. The
   notes are the documents carried verbatim, so there is nothing in them the agent cannot reach
   by searching the tree; any gain has to come from finding the right document sooner.
2. **Tokens: Sloppy reads less on GitLab**, where a million words sit in 668 files under
   `doc/development`, and about the same on Milvus and Pulsar, whose documents are named by
   number or date and found by a filename search almost as fast.
3. **The brief tasks are where a score gap could open**, in Sloppy's favour, because a brief
   needs several documents tied together and the notes are hung by directory.
4. **Notes only scores as the documents do**, since they carry the same words.
5. **No run spawns a subagent**, as on every subject before.

If Sloppy loses on score anywhere, or reads more on GitLab, that is reported as it is.

## What the batch showed (2026-11-04), against the predictions

Sonnet, 128 runs a project, every one finished and judged. 145 runs the account's session limit
stopped were set aside under `results/superseded/` and run again, Pulsar whole and Milvus's 17
by task, condition and setting. Lean against the documents alone (`bare`), means over tasks:

| Project | Score, documents | Score, Sloppy | Tokens, documents | Tokens, Sloppy | Time, documents | Time, Sloppy |
| ------- | ---------------- | ------------- | ----------------- | -------------- | --------------- | ------------ |
| GitLab  | 0.90             | 0.92          | 54k               | 68k            | 29 s            | 22 s         |
| Milvus  | 0.92             | 0.96          | 139k              | 92k            | 34 s            | 24 s         |
| Pulsar  | 0.91             | 0.93          | 66k               | 78k            | 33 s            | 25 s         |

1. **Score, a tie: held.** Sloppy was within 0.05 everywhere, and the intervals overlap, though
   it came out a little ahead on all three.
2. **Tokens, less on GitLab: wrong.** Sloppy read more on GitLab and on Pulsar, and a third
   less on Milvus, the reverse of what was expected.
3. **The brief tasks, Sloppy's place to gain: wrong.** It scored lower on all three briefs
   (GitLab 0.63 against 0.84, Milvus 0.86 against 0.91, Pulsar 0.70 against 0.73).
4. **Notes only scores as the documents do: held** (0.93, 0.92, 0.91 under lean).
5. **No subagents: held.** None of the 384 runs started one.

Not predicted: Sloppy answered faster on every project, by 24 to 30 percent. By README.md §
"What counts as better" — score not lower and cost or time lower — Sloppy, lean, is better on
all three; by tokens alone it is better only on Milvus. These notes were carried by script,
so they hold the documents' words and nothing more.

## The code index, before it is measured (2026-11-04)

`find_code` lets an agent ask Sloppy where something is in the code, not only why. The test: one
batch on Sonnet, the `mcp` condition only, the same build served `lean` (with `find_code`)
against `noindex` (`--without find_code`), interleaved, two runs a task, on GitLab, Milvus,
Pulsar and the private app's read-only tasks. Expected:

1. **Fewer searches after Sloppy answered**, and fewer greps in all, on the locate tasks.
2. **The same score**, within 0.05.
3. **Fewer tokens on locate tasks, about the same elsewhere**, because a why-question is
   answered from the notes and never asks where.

## What the code index changed (2026-11-04), against its predictions

60 runs a setting, every one judged; `find_code` was offered in every `lean` run and in no
`noindex` run (checked in the transcripts). **Agents called it once in 60 runs.** Given an act
that answers where something is, Sonnet still searched the tree itself, as it did with `relate`.

| Tasks  | Setting | Score | Tokens | Searches a run | Searches after Sloppy answered |
| ------ | ------- | ----- | ------ | -------------- | ------------------------------ |
| Locate | lean    | 0.97  | 87k    | 3.3            | 0.54                           |
| Locate | noindex | 0.96  | 97k    | 3.4            | 0.29                           |
| Others | lean    | 0.88  | 75k    | 1.1            | 0.46                           |
| Others | noindex | 0.87  | 74k    | 1.2            | 0.43                           |

1. **Fewer searches after Sloppy answered: wrong.** No fewer, because the act was not used.
2. **The same score: held.**
3. **Fewer tokens on locate tasks:** 10% fewer, but with the act unused that is not its doing,
   and 14 runs a side is too few to call it anything but noise.

A lean `brief` also names the code places the index finds for a task's words, under both
settings, so this measured the act on its own and not the index behind `brief`. What it shows
is the same lesson as `relate`: an agent does not reach for a new act because it exists. What
changes its choices is what the calls it already makes hand back, and the words in front of it.

## The overall score, first reading (2026-11-04)

Sonnet, lean, the handoff tasks run twice under four conditions on all six projects, every run
judged. The total is the equal mean of quality, handoff, tokens and time (README.md § "What
counts as better"). Where all four parts exist:

| Project     | Documents | With Sloppy | Notes only | Subagents allowed |
| ----------- | --------- | ----------- | ---------- | ----------------- |
| Private app | 0.75      | 0.79        | 0.90       | 0.76              |
| GitLab      | 0.90      | 0.89        | 0.88       | 0.93              |
| Milvus      | 0.79      | 0.87        | 0.98       | 0.80              |
| Pulsar      | 0.88      | 0.91        | 0.95       | 0.89              |

Sloppy's own repository and syr have no total: their earlier runs share no lean task across all
four conditions, so tokens and time cannot be compared there, and the partial totals (0.96 to
1.00) say little. What this reading does not yet show well:

- **The handoff part is nearly saturated.** A second agent recovered the first one's reason
  0.76 to 1.00 of the time everywhere, 1.00 under every condition on Sloppy's repo and syr,
  and 0.98 to 1.00 on the private app. The first agent leaves the reason beside the code it changed, and the second finds it
  there; a harder handoff (the reason needed somewhere other than where the change was made)
  would separate the conditions.
- **Notes only leads on efficiency, not on answers.** It has fewer files to read, so it wins
  tokens and time and with them the total, even on the private app, where its answers were the weakest
  (0.67). With equal weights, a cheaper and worse condition can win; the parts are shown beside
  the total for exactly this reason.
- **Sloppy opens more places, not fewer.** Findability under Sloppy was 5 to 10 files and notes
  a run against 2.5 to 3.5 for the documents alone: it reads notes and then the code they name.

## A smaller first answer, before it is measured (2026-11-04)

The transcripts behind the survey show one mechanism behind Sloppy's wins and one behind its
losses. It wins where the document that answers cannot be found by its name (Milvus's dated
design documents, Pulsar's numbered proposals): the first `brief` matches the question's words
against the notes and hands back the right one, and the run ends in 3 to 7 turns instead of 14
to 20. It loses where the answer is easy to find (GitLab's plainly named files, answers that
live in code): that first `brief` hands back 30 to 46k characters, which ride along on every
later turn while the agent searches and reads the same files it would have anyway; and on a
brief task the spread of excerpts stood in for reading the one document whole.

The change: a lean `brief` hands back the note that matches best — its opening section always,
and the sections the words reach — with a few other titles and code places, at about a tenth of
today's size; anything more is one `read_note` away. Measured on Sonnet, `mcp` only, the build
before against the build after, interleaved, two runs a task, every read-only task of GitLab,
Milvus, Pulsar and the private app. It succeeds if:

1. **Where Sloppy lost on tokens, it reads less**: the tasks where Sloppy read more than the
   documents alone in the survey batch read at least a quarter less.
2. **Where Sloppy won, it costs nothing**: on the tasks where it read less and scored no lower,
   the score stays within 0.05 and the tokens rise by no more than a tenth.
3. **The brief tasks score no lower** than before, and GitLab's comes back toward the
   documents alone (0.84).

## The rerun, and what happens if Sloppy is not ahead (2026-11-04)

The developer's instruction: after the smaller brief, run the benchmark again on every project,
step by step, and where Sloppy is not better than the other approaches, rethink how it works and
try again. Written down before the first rerun, so the loop cannot quietly become fitting Sloppy
to its own test:

1. **Each round** runs the build being tested on all six projects, one project at a time, under
   the documents alone, allowed subagents, with Sloppy and notes only, lean, two runs a task, then
   the blind judge. Results are compared by README.md § "What counts as better" and the overall
   score, and every round is reported, the ones that go badly included.
2. **A change between rounds** names the mechanism it answers, found in the transcripts, stated
   for any project of that shape (AI.md § "The Benchmark Measures, It Never Designs"), with what
   it is expected to do written here before it runs.
3. **The tasks used while iterating are the development set.** When the rounds stop, a fresh
   writer who has seen none of the changes writes a new pack for every project, under the same
   rules as the first, and the final build and the build the rounds started from are both run on
   it. That is the result that counts; the development rounds are how it was reached.
4. **The rounds stop** when a round's changes move nothing, or after three rounds, whichever
   comes first.

## What the smaller first answer did (2026-11-04), against its criteria

Sonnet, `mcp` only, the build before (`lean`) against the build after (`slim`), interleaved,
two runs a task, 120 runs, all but one judged. Tasks are sorted by what they showed in the
survey batch: where Sloppy read more than the documents alone, and where it read less and
scored no lower.

| Tasks                       | Tokens, before | Tokens, after | Score, before | Score, after |
| --------------------------- | -------------- | ------------- | ------------- | ------------ |
| Where Sloppy read more (13) | 97k            | 71k           | 0.94          | 0.94         |
| Where Sloppy won (11)       | 72k            | 66k           | 0.92          | 0.92         |

1. **A quarter less where Sloppy lost: held** (26% less, the same score).
2. **No cost where Sloppy won: held** (8% fewer tokens, the same score).
3. **Brief tasks no lower: wrong.** GitLab's rose from 0.57 to 0.69, Milvus's stayed at 0.88,
   but Pulsar's fell from 0.71 to 0.56 and the private app's from 0.53 to 0.48. A brief task
   ties several documents together, and the smaller answer hands the agent fewer of them.

The change ships, because it does what it was for on the tasks it was for. The brief tasks go
into the first round as the known weakness. Two runs a task is too few to read any one task:
single tasks moved by 0.17 to 0.33 in both directions between builds that differ only here.

## Round one, and what round two changes (2026-11-05)

Round one (seed 21, the build at `e6de9e11`, 498 runs, every one judged), Sloppy lean against the
documents alone, task-weighted means:

| Project           | Score | Tokens | Cost | Time |
| ----------------- | ----- | ------ | ---- | ---- |
| Milvus            | +0.11 | −32%   | −28% | −26% |
| GitLab            | +0.05 | +25%   | −9%  | −7%  |
| syr               | 0.00  | +16%   | −7%  | +3%  |
| Sloppy's own repo | −0.01 | +7%    | +1%  | −7%  |
| Pulsar            | −0.01 | +25%   | −6%  | −1%  |
| Private app       | −0.02 | −5%    | −12% | −8%  |

**What the runs show.** Sloppy took fewer round trips to the model on every project (10.1 to 5.8
on Milvus, 7.0 to 5.9 on GitLab, 7.6 to 6.3 on Pulsar), but every round trip cost 1k to 6k more
tokens. The first brief is no longer the reason: it now returns 1k to 3k characters a run. The
reason is the description of Sloppy's acts, 14 of them in 8,453 characters, about 2k tokens, sent
with every request whether or not an act is used. Times the round trips, that is close to all of
the excess: about 12k on syr (+10k measured), 12k on GitLab (+13k), 13k on Pulsar (+15k). On
Sloppy's own repository ten of sixteen runs never called Sloppy and paid it anyway. Most of it is
read from the cache, which is why cost falls while tokens rise.

**The change for round two:** the acts' descriptions and argument schemas, in the lean profile,
cut to what an agent needs to choose and call each one — no act removed, no behaviour changed —
to about a third of their size. Expected, against round one:

1. **Tokens a round trip under Sloppy fall by at least 1k** on every project.
2. **Sloppy's token excess over the documents alone halves** on syr, GitLab, Pulsar and
   Sloppy's own repository, and Milvus and the private app read less than in round one.
3. **Scores stay within 0.03 of round one**, and Sloppy is called about as often (within a fifth),
   so the shorter words cost none of what makes it win.

**Amended before round two ran (2026-11-05).** Shorter words alone came to 64% of the old size,
not a third: names, types and choices of 14 acts take 2,900 characters by themselves. So round
two also leaves out of the lean list the six acts agents all but never called in 1,438 runs with
Sloppy — `relate`, `tag_note`, `move_note` and `number_note` never, `list_tags` once,
`delete_note` twice — which stay served to a caller that names them and in `--tools default`.
The lean list is then 8 acts in 3,656 characters, 43% of round one's 8,453. The three
expectations above stand as written.

## Round two, against its expectations, and what round three changes (2026-11-05)

Round two (seed 22, the build at `d785b67d`: shorter words and eight acts in the lean list), all
six projects, 498 runs, all but one judged. GitLab and Milvus were stopped by the account's session
limit after 18 and 4 runs; every round-two run on them was set aside (`results/superseded/`) and
both ran again whole. Sloppy, lean, against the documents alone, round one → round two:

| Project           | Score         | Tokens      | Cost        | Tokens a round trip, Sloppy / docs |
| ----------------- | ------------- | ----------- | ----------- | ---------------------------------- |
| Milvus            | +0.11 → +0.03 | −32% → −28% | −28% → −32% | 13.5k / 12.9k → 12.7k / 12.4k      |
| GitLab            | +0.05 → −0.02 | +25% → +17% | −9% → −10%  | 11.4k / 7.1k → 10.2k / 6.9k        |
| Pulsar            | −0.01 → −0.06 | +25% → +2%  | −6% → −10%  | 11.8k / 8.0k → 10.2k / 8.2k        |
| Private app       | −0.02 → +0.06 | −5% → −12%  | −12% → −20% | 25.8k / 19.7k → 23.2k / 21.4k      |
| syr               | 0.00 → −0.02  | +16% → +14% | −7% → −7%   | 12.4k / 9.4k → 11.4k / 9.1k        |
| Sloppy's own repo | −0.01 → 0.00  | +7% → +26%  | +1% → +10%  | 21.5k / 19.6k → 21.1k / 19.5k      |

1. **At least 1k fewer tokens a round trip: met on four of six** (GitLab, Pulsar, the private app,
   syr), not on Milvus (0.8k) or Sloppy's own repository (0.4k).
2. **The excess halves on syr, GitLab, Pulsar and Sloppy's own repository: met on Pulsar only.**
   GitLab fell by a third, syr barely moved, and Sloppy's own repository rose: with eight acts
   listed, agents there called Sloppy more (0.8 to 1.2 a run, `find_code` among them) on questions
   the instructions file already answers.
3. **Scores within 0.03 of round one: four of six.** Sloppy's own score fell 0.04 on syr; the
   private app rose 0.07. The documents-alone score moved by up to 0.06 between rounds on the same
   tasks, so a difference that size is within what two runs a task can tell apart.

**What still makes a round trip heavier.** The act list is now about 900 tokens. What remains is
what Sloppy hands back: whole notes. `read_note` returned 7.5k characters a run on syr, 9.8k on
GitLab and 14.2k on Milvus, where the notes carry long design documents word for word, and the
agent then read the code as well.

**The change for round three:** in the lean profile, `read_note` on a long note hands back its
opening section and a list of its other sections, each with its size, and the agent asks for the
sections it needs by name (the `sections` argument it already has); a short note comes back whole
as now. Expected, against round two:

1. **Characters `read_note` returns a run halve** on syr, GitLab and Milvus.
2. **Sloppy reads no more than the documents alone on Pulsar, the private app and Milvus, and its
   excess on GitLab and syr falls by a third.**
3. **Scores within 0.03 of round two**: a why-question's reason sits in a section an agent can
   name from its heading.

Round three is the last of the development rounds; the held-out pack follows it.

## Scope: large codebases only, from round three (2026-11-05)

The developer's decision: "why dont we just drop syr and slyng to be optimized and benchmarked
for, sloppy is a tool for bigger repos anyways, so instead we get 2 other open source projects the
scale of milvus pulsar and gitlab". So from round three the loop runs only on projects whose
reasons outgrow what an agent reads by default — GitLab, Milvus, Pulsar and the private app — and
syr and Sloppy's own repository leave it. Their results through round two stay published: there,
with the instructions file already holding most answers, Sloppy tied the documents alone on score
and read 7% to 26% more. The claim this benchmark can now support is about large codebases only,
and the pages that report it say so.

Two open-source projects join, the next two by the rule's own ranking above: **pingcap/tidb**
(239,936 words of design documents in 120 files, 1.8M lines of code) and
**crossplane/crossplane** (218,820 words in 82 files, 104k lines). Neither has been looked at by
any change in the loop, so they enter the held-out test as projects as well as packs: their
notes are carried by `carry-docs.mjs` as the others' were, and their task packs are written by a
writer who has seen none of the changes, under the same rules as the first packs.

**A sixth open-source project (2026-11-05).** The developer asked for six listings, and dropped the
private app from what the site shows ("it doesnt really tell anyone anything"). The next project
by the rule's ranking is **vectordotdev/vector** (180,447 words of design documents in 80 RFC
files, 473k lines of code, measured at `37c8033c`), built as TiDB and Crossplane were and, like
them, unseen by any change in the loop. The site and README now show only open-source projects;
the private app's runs stay in the benchmark's own results.

## The rule, raised for large codebases (2026-11-05), before any new candidate is measured

The developer: "why ... have you picked projects which have so much exponentially lesser design doc
words, our tool is for large code bases". Right: the first rule's floor (150k words) let in projects
a tenth of GitLab's size, and the ranking ran out of large ones after three. The rule now reads:

1. Unchanged: the reasons are written down in the repository (design documents, RFCs, ADRs,
   architecture notes — not user guides or API reference).
2. **At least 350k words of them**, in at least 80 files. GitLab (1.02M), Milvus (486k) and Pulsar
   (380k) clear it; TiDB (240k), Crossplane (219k) and Vector (180k) do not, and leave the benchmark
   before running.
3. Unchanged: scattered — no single file holds most of them.
4. Unchanged: real code under an open-source licence.
5. **Dropped**: a package's tests runnable here. No task in these packs runs a project's code, so it
   decided nothing but excluded dotnet/runtime (601k words, MIT).
6. Unchanged: some decisions written after mid-2025.

Candidates are ranked by words of design documents. dotnet/runtime passes as measured; a new survey
looks for more at this size, and the top three join GitLab, Milvus and Pulsar for six open-source
projects.

**The private app leaves the benchmark (2026-11-05).** The developer: "fuck the private app move
ahead". From round three on it is left out of every comparison, round and the held-out test; the
benchmark is six open-source projects. Its runs to date stay in `results/` as they were recorded.

## What the raised survey found (2026-11-05)

Seventeen more repositories measured (`survey/measured-large.json`); with dotnet/runtime from the
first survey, seven pass the raised rule:

| Project                | Words of design documents | Files | Lines of code |
| ---------------------- | ------------------------- | ----- | ------------- |
| llvm/llvm-project      | 1,267,800                 | 564   | ~55M          |
| fuchsia (googlesource) | 725,658                   | 287   | ~15M          |
| chromium/chromium      | 715,258                   | 621   | ~10M          |
| swiftlang/swift        | 679,941                   | 156   | ~4M           |
| carbon-language/carbon | 619,949                   | 281   | ~250k         |
| dotnet/runtime         | 601,481                   | 264   | ~11M          |
| torvalds/linux         | 574,573                   | 491   | ~30M          |

Firefox (342k, strictly counted) narrowly misses; Roslyn, Rust, Ceph, QEMU and the rest fall well
short.

**Chosen: LLVM, Swift and Carbon.** Chromium and Fuchsia rank second and third but are dropped for a
practical reason the rule allows: a Chromium checkout is tens of gigabytes and each run needs three
(one per condition), and Fuchsia is not on GitHub and is checked out as many repositories stitched
together. dotnet/runtime and the Linux kernel are next if one of the three fails in practice. With
GitLab, Milvus and Pulsar that makes six open-source projects; TiDB, Crossplane and Vector leave.

**Swift leaves, dotnet/runtime joins (2026-11-05).** Swift's container was built and its pack
reviewed, but `carry-docs.mjs` carries Markdown only, and more than half of Swift's design writing
is reStructuredText and LaTeX (the whole generics book among it): 281k of its 680k words became
notes, under the floor, and the agent without Sloppy would still read the rest. That makes the
comparison uneven, so Swift is dropped for a practical reason and dotnet/runtime (601k words, mostly
Markdown, ~11M lines of code) takes its place. The six: GitLab, Milvus, Pulsar, LLVM, Carbon and
dotnet/runtime. LLVM carried 1,283,487 words into 609 notes; Carbon 619,948 into 311.

## Round three, against its expectations (2026-11-05)

Round three (seed 23, the build at `8dd659bd`: a long note read on the lean path comes back as its
opening and an outline), all judged. Sloppy, lean, against the documents alone, on the three
open-source projects in the loop:

| Project | Score  | Cost | Time | Round trips | Tokens | `read_note` characters a run, round two → three |
| ------- | ------ | ---- | ---- | ----------- | ------ | ----------------------------------------------- |
| GitLab  | −0.018 | −22% | −1%  | −9%         | +9%    | 9.8k → 3.3k                                     |
| Milvus  | +0.144 | −39% | −15% | −24%        | −36%   | 14.2k → 8.5k                                    |
| Pulsar  | +0.011 | −9%  | −11% | −8%         | +13%   | 1.5k → 4.9k                                     |
| Average | +0.045 | −23% | −9%  | −13%        | −4%    |                                                 |

Rounds one and two averaged +0.049 / −14% cost / +6% tokens and −0.017 / −17% / −3%.

1. **`read_note` characters halve: met on GitLab (−66%), not on Milvus (−40%).** On Pulsar they
   rose: with long notes coming back as outlines, agents there opened more notes.
2. **No more tokens than the documents alone on Milvus: met (−36%). GitLab's excess falls by a
   third: met (+17% to +9%). Pulsar: not met (+2% to +13%).**
3. **Scores within 0.03 of round two: GitLab and Milvus yes; Pulsar rose 0.05.**

This is the last development round. Averaged over the three, round three is the best of the
three on cost and tokens and level with round one on score. The held-out test — the build before
the loop and this build, on GitLab, Milvus, Pulsar, LLVM, Carbon and the .NET runtime — decides.

## The final test (2026-11-05), written down before it runs

The developer: "why do you wanna compare to before the improvement loop i just want the best version
compared to normal prompting/agentic workflows". So the held-out test is the build at `8dd659bd`
(round three's, `~/sloppy-bench/cli-round3`) served lean, against the documents alone and against
subagents allowed, on all six open-source projects — GitLab, Milvus, Pulsar, LLVM, Carbon and the
.NET runtime — every task in each pack, **three runs a task** (two could not tell 0.05 apart from
chance in the rounds), Sonnet, the blind judge. LLVM, Carbon and the .NET runtime have been seen by no
change. Expected, from the rounds: on average across the six, a score no lower than the documents
alone, lower cost and time, fewer round trips; tokens about level; the largest gains where design
documents are named by date or number rather than by subject.

## The final test, against its expectations (2026-11-05)

Seed 30, the build at `8dd659bd` served lean, three runs a task, 540 runs on six open-source projects,
every one judged. LLVM's first attempt crashed before any run (its tree outgrew the buffer the bench
unpacked it through, fixed in `817a3bde`) and its second was refused by a reset agent setting; both
left no records, and its 90 runs were made on the third. Sloppy against the documents alone, task-
weighted means:

| Project      | Score                 | Cost | Time | Round trips | Tokens |
| ------------ | --------------------- | ---- | ---- | ----------- | ------ |
| GitLab       | +0.044 (0.93 vs 0.88) | −13% | −4%  | +2%         | +25%   |
| Milvus       | +0.039 (0.97 vs 0.93) | −37% | −9%  | −19%        | −29%   |
| Pulsar       | +0.017 (0.91 vs 0.89) | −13% | −7%  | −16%        | −3%    |
| LLVM         | +0.003 (0.94 vs 0.93) | −11% | −2%  | −4%         | +21%   |
| Carbon       | +0.016 (0.95 vs 0.93) | −10% | +8%  | +1%         | +24%   |
| .NET runtime | +0.038 (0.90 vs 0.86) | −17% | +4%  | −10%        | +4%    |
| Average      | +0.026                | −17% | −2%  | −8%         | +7%    |

Against subagents allowed: score +0.023, cost −14%, time +1%, round trips −5%, tokens −4% on average
(higher score on four projects, level on Pulsar and LLVM within 0.001, −0.016 on the .NET runtime).

1. **A score no lower than the documents alone: held** — higher on all six, +0.026 on average.
2. **Lower cost: held** — on all six, against both.
3. **Lower time and fewer round trips: partly** — round trips −8%, time about level (slower on
   Carbon and the .NET runtime).
4. **Tokens about level: held** (+7%; GitLab, LLVM and Carbon read about a fifth more, Milvus 29%
   less).
5. **Largest gains where documents are named by date or number: held** for Milvus (cost −37%,
   tokens −29%); the .NET runtime's score gain (+0.038) came with named-by-subject documents too.

On the three projects no change had seen — LLVM, Carbon and the .NET runtime — the score was higher
on all three and cost 10% to 17% lower.

## More runs on LLVM and the .NET runtime (2026-11-06), written down before they ran

The developer asked for these two again, reading their closeness as noise or as questions that do not
separate the approaches. The per-task numbers say the first: on LLVM Sloppy is ahead or level on
seven tasks of ten, and the project's average turns on one drift task whose three Sloppy runs scored
0.36, 0.85 and 1.00 — in the 0.36 run the agent reported a different, real defect (a discarded
`remove_if` result) instead of the planted one, which the grader is right to score low. On the .NET
runtime a handoff task ran 0.15 to 0.90 within one approach. Three runs a task cannot separate that.

So: **three more runs a task** on LLVM and the .NET runtime, same build (`8dd659bd`, served lean),
same three approaches, seed 31, judged blind as before. The rules, fixed now:

1. **The new runs are pooled with seed 30's**, six a task, and that pooled figure is what is
   reported. They do not replace the first three, and no run is dropped for what it shows.
2. **Whatever it shows stands**, including a result that moves against Sloppy.
3. **No task, grader or build changes**, so the two sets are the same measurement.
4. **Only these two projects get the extra runs**, at the developer's ask. They are measured more
   precisely than the other four, and the pages that report the six say so.

## What the extra runs showed (2026-11-06)

180 more runs, judged, pooled with seed 30's: six runs a task on LLVM and the .NET runtime.

| Project      | Against   | Score, three runs → six | Cost, three → six |
| ------------ | --------- | ----------------------- | ----------------- |
| LLVM         | documents | +0.003 → −0.004         | −11% → −13%       |
| LLVM         | subagents | +0.001 → +0.004         | −12% → −12%       |
| .NET runtime | documents | +0.038 → +0.047         | −17% → −16%       |
| .NET runtime | subagents | −0.016 → +0.011         | −11% → −15%       |

The noise was real, and it ran both ways. The .NET runtime's one deficit — behind the subagents by
0.016 — was noise and is now a 0.011 lead. LLVM's answer quality is a tie against both, and moved a
hair the other way with more runs, from +0.003 to −0.004; it is level, not behind, and 13% cheaper.
Neither project's questions were at fault: the LLVM run that scored 0.36 found a different, real
defect (a discarded `remove_if` result) rather than the planted one, which the grader is right to
score low.

Over the six projects, pooled: against the documents alone, score +0.026, cost −17%, time −3%,
round trips −8%, tokens +7%; against subagents allowed, score +0.028, cost −15%, time +1%, round
trips −5%, tokens −4%. LLVM and the .NET runtime now carry six runs a task where the other four
carry three, which the pages that report them say.

## Replacing LLVM's drift task (2026-11-06), written down before the replacement ran

`llvm-drift-key-instruction-rank` plants an inverted rank comparison in
`DwarfDebug::computeKeyInstructions`. That function already carries a real LLVM bug beside it: the
result of `llvm::remove_if` is discarded, so a line that reads as removing candidates does nothing.
**All eighteen runs — every approach — reported that real bug.** Whether a run also named the planted
change was all but identical across the approaches (documents alone 5 of 6, Sloppy 5 of 6, subagents
4 of 6), and scores inside one approach ran from 0.36 to 1.00. The task measures which of two defects
an agent writes up first, not whether it notices drift, and that is grounds to replace it whoever it
happens to favour.

The replacement: the same family, planted in an LLVM function whose intended behaviour is written in
LLVM's own documents and which carries no second defect, written by a writer who has not seen Sloppy's
notes and does not know which approach the change is expected to help. Then all three approaches run
it six times, seed 32, judged blind.

The rules, fixed now:

1. **Both figures are published**: LLVM as it stands with the old task, and LLVM with the replacement
   in its place. The record below and the pages carry the second; this section keeps the first.
2. **The old task's runs go to `results/superseded/`** with this reason, so no export mixes eleven
   tasks.
3. **Whatever the replacement shows stands**, including a result that moves against Sloppy, and the
   replacement is not rewritten after its result is seen.

Two conditions of the run, written down while it was in flight. The replacement runs at **seed 32**,
which only shuffles the order a batch works through, so six reps there and the three-plus-three of
seeds 30 and 31 that its nine siblings carry are the same regime. And the Sloppy build is the one
every other LLVM run used, unrebuilt: one commit has touched the CLI since, a single word in a tool's
description, and taking it would have put one of LLVM's ten tasks on a different build from the rest.

### What the replacement showed (2026-11-06)

Eighteen runs, every one `ok`: three approaches, six repetitions, seed 32, judged blind. Both figures,
computed the same way, over the same ten tasks a piece:

| LLVM's ten tasks        | documents | subagents | Sloppy | vs documents | vs subagents |
| ----------------------- | --------: | --------: | -----: | -----------: | -----------: |
| with the old drift task |     0.941 |     0.932 |  0.937 |       −0.004 |       +0.004 |
| with the replacement    |     0.947 |     0.949 |  0.955 |       +0.008 |       +0.005 |

Over the six projects the mean moved from +0.024 to +0.026 against the documents alone and stayed at
+0.028 against subagents. LLVM is 11% and 10% cheaper either way. LLVM was level and is now marginally
ahead.

**The lead is not won on the new task.** On the replacement itself Sloppy scores lowest of the three —
0.954, against 0.963 for the documents alone and 0.975 for subagents. All three named the exact change
and cited the document; the judge separated them on one rubric item out of five, whether a run
committed to the document as the intent. Five of six Sloppy runs hedged that the document might be
stale or the narrowing deliberate, where every subagent run and four of six documents-alone runs said
plainly that the unit test had been changed to match the code. **That is Sloppy's notes making a model
less willing to treat the document as the intent, which is the opposite of what this product is for,
and it is the finding of this round.** What moved LLVM's reading is the removal of a task scored on
which of two defects a run wrote up first, not a win on the one replacing it.

#### The grader was broken, and the figure above is the repaired one

The replacement's facts grader first scored **0.00 on 17 of the 18 answers**, which the blind judge
rated 0.86 to 0.97. A run's score is the mean of its objective and judge components, so LLVM read
0.897 / 0.899 / 0.909 — every condition depressed by roughly half. The objective component averages
0.88 to 0.97 across this benchmark's other families and 0.82 on the task this one replaced, so the
grader was wrong rather than the answers.

Two causes, both from hardening the patterns against answers written by hand as prose. Real answers
are markdown — a verdict paragraph, a fenced `cpp` block, the document in a blockquote — and the
patterns had grown to 600–5100 characters of tempered spans that cannot cross a newline, which three
of the four required facts shared. And a forbidden pattern matched the planted unit test's own comment,
which 13 of the 18 answers quote.

The patterns are rewritten in the style of the task they replaced: short alternations, with
whole-answer checks as `[\s\S]*` lookaheads that cross paragraphs. The prompt, key, sources, rubric
and the planted patch are byte-identical. **Nothing was re-run**: the repaired grader was applied to
the same stored answers, and its scores are appended as later grade records beside the originals
rather than written over them.

Repairing a grader after seeing its result is the thing this record's rules forbid, so the reasons it
is not that: it moved all three conditions the same way, the correction was fixed in advance as a
threshold the other families already meet, re-grading is a deterministic pass over stored text with no
model in it, and both figures are here. The suite now holds the grader to six real answers alongside
the answers written by hand, so markdown cannot silently stop reading again.

One trade is stated rather than hidden: an answer that shows the changed line in a fence and never
says in prose what the code now does scores 0, because crediting the bare presence of the expression
let a wrong answer reach 0.75. No run wrote that way.

One more run was graded with these: a `dotnet-brief-cdac` run under the documents alone, `ok` with a
full answer, that the judge had never been given. It is counted now rather than quietly dropped.
