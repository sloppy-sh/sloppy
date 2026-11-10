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

### Charting the text that is new, not the text re-read (2026-11-06)

The token charts counted every input class, including the conversation re-read on each turn, which
made Sloppy look like it took in more while costing less — a contradiction that needed a paragraph to
explain away. The export now carries `fresh_mean` beside `input_mean`: the same input less what was
re-read. `input_mean` is unchanged, so every figure recorded above still means what it said.

Charted that way the direction is one way on every project. New text read, Sloppy against the
documents alone: Pulsar −9%, LLVM −11%, Carbon −14%, GitLab −19%, .NET runtime −20%, Milvus −43%;
pooled −19% against the documents and −17% against subagents, beside cost −17% and −15%. The pages
mark the number with an asterisk and say in a line what it leaves out, rather than arguing with their
own charts.

### The carry was incomplete on three subjects, and it cost no task its answer (2026-11-08)

Counting the documents under each subject's configured doc folders against the notes that carry a
`code:` link to them:

| Subject      | Documents | Carried | Skipped | Carried | Words not carried |
| ------------ | --------: | ------: | ------: | ------: | ----------------: |
| Milvus       |       174 |     173 |       1 |   99.4% |             1,616 |
| Pulsar       |       321 |     317 |       4 |   98.8% |             6,562 |
| Carbon       |       286 |     282 |       4 |   98.6% |             1,941 |
| GitLab       |       747 |     669 |      78 |   89.6% |            83,523 |
| .NET runtime |       265 |     236 |      29 |   89.1% |            63,177 |
| LLVM         |       758 |     564 |     194 |   74.4% |           723,427 |

Milvus's one skip is `CLAUDE.md`, which is the instructions file and no note's business. LLVM is
missing a quarter of its documents and 36% of its words, with whole folders at zero —
`llvm/docs/CommandGuide` 0 of 63, `lldb/docs/use` 0 of 18, `llvm/docs/tutorial` 0 of 26,
`mlir/docs/Tutorials` 0 of 22 — and 33 scattered singles beside carried siblings.

**It is not the documents and not the carrier's rules.** Three of the skipped files
(`CommandGuide/FileCheck.md`, `CodingStandards.md`, `tutorial/BuildingAJIT1.md`) were put in a
scratch repository with a carried file as control and run through `carry-docs.mjs`: four notes
written, nothing skipped. Nor is it size — the skipped files' median is 7.7 KB against 9.4 KB for the
carried, which reach 280 KB. The skips are interleaved rather than a tail, so an unfinished run is
the likeliest cause. The carrier prints each skip with its reason and that output was not kept.

**No task lost its answer.** Every task in the three packs whose `sources` name a document has that
document in the notes; the handoff tasks name none, working from a commit message. So the gap cannot
explain LLVM's small margin, and re-running against a complete carry has nothing measurable to
change. The defect is recorded, not corrected into the figures.

**Note shape does not track the results either.** Words per note, by subject: Milvus median 397,
Pulsar 374, GitLab 350, LLVM 588, Carbon 745, .NET runtime 824. LLVM does hold the largest notes —
14 over 5,000 words, one of 30,654 — but Carbon and the .NET runtime carry larger notes at the median
and both beat LLVM on score. What an agent actually reads is a section, and section sizes are alike
everywhere: medians 38 to 119 words, 90th centiles 236 to 642. Folder notes carrying nothing but a
link are 14% to 19% of every subject's notes, LLVM's 15% among them.

## The two trees, written down before any of it ran (2026-11-08)

> Added 2026-11-09: the sections below call these two trees "Arm A" and "Arm B". That was my
> scaffolding for running them, not a thing the benchmark reports, and it is left here unedited
> because these paragraphs were written before the runs. What is reported is the three bars in
> README.md § "The comparison that is reported": the documents as a project keeps them, the same
> documents with subagents, and Sloppy under the recommended workflow, which includes the shaping.
> Later subjects name the two trees `asis` and `shaped`.

Everything above is one measurement: documents carried **verbatim**, so both sides read the same
words and any gain has to come from finding the right document sooner. It is a floor — what Sloppy
does with documents nobody shaped for it. It says nothing about a project written for Sloppy from
the start, and the practices the site now publishes were reasoned from how a note is found and read
rather than measured.

Arm B measures that second thing, and it is a **separate figure, never a correction to Arm A**.

**The fork it has to avoid.** Improving only the notes would hand the Sloppy condition content the
documents-alone condition cannot reach anywhere, and the number would stop meaning "Sloppy finds
things" and start meaning "we wrote better documents for one side". So the shaping happens **in the
tree**: every condition reads the shaped documents, and the notes are carried from them afterwards
by the same script.

**What "shaped" means.** Applied to every Markdown document under the subject's configured doc
folders, in path order, by a writer that has not seen the task pack:

1. The title states what the document decides, in the words somebody would ask in, and stays the
   document's `#` heading.
2. An opening paragraph under the title states the decision and its reason.
3. A section heading says what its section answers, where the existing one does not.
4. A `Covers:` line names the repository paths the document is about.
5. One index per doc folder maps each document's title to its path.

**Hard gates, fixed now.**

- **Every quoted passage the graders cite must still resolve verbatim.** Pulsar's pack cites 75;
  LLVM's 75. Checked automatically before a single run, and a failure stops the arm rather than
  being written around.
- No sentence of the original is deleted or reworded. Shaping is additive, plus titles and headings.
- The writer never reads `bench/tasks/`, so no document is shaped towards a question.
- Arm A stays reproducible at its pinned SHA; Arm B runs on its own branch and its own SHA, recorded
  on every run.
- Both arms are published, side by side, the way the two LLVM drift figures are.
- **Whatever Arm B shows stands**, including a result that moves against Sloppy, and the shaping is
  not revised after its result is seen.

**The pilot is Pulsar**, and the reason is not cost alone. Pulsar is an underperformer (+0.017) whose
documents already carry the one thing that solves findability — `pip/000-INDEX.md`, a table of every
proposal's number and title, which its documents-alone runs read before going straight to the files
that matter. Findability is therefore already paid for there, so whatever Arm B moves on Pulsar is
attributable to the shape of the writing rather than to routing. It is also the smallest of the six
by words of documents (388k against LLVM's 2.0M), so the pilot's cost is known before LLVM's turn.
If the pilot moves nothing, that is the answer for the other underperformers too, and it is reported.

**What the pilot can and cannot test, read off Pulsar's documents before shaping them.** Its
proposals already satisfy two of the five: the title states the decision in askable words
(`# PIP-462: Remove Etcd metadata store backend`) and the folder is indexed. What they do not have is
a decision-first opening — `## Motivation` opens on context and reaches the decision at the end —
headings that say what a section answers rather than naming a template slot (`Motivation`, `Goals`,
`In Scope`), or a line naming the code. So the pilot tests practices 2, 3 and 4 on documents where 1
and 5 are already paid for, which is a narrow and clean question: does a decision-first opening with
answer-shaped headings and code pointers move anything by itself?

It follows that a null result on Pulsar does **not** settle LLVM, and the sentence above claiming it
would is withdrawn before any run. LLVM's headroom is different in kind: 67 of its documents open
with no `#` heading at all, its titles are topic names, and the folder notes carry nothing but a
link. LLVM gets its own shaping on all five, and its cost is 2.0M words against Pulsar's 388k.

### Pulsar under the recommended workflow (2026-11-09)

One batch, 182 runs, every one `ok`: both trees under their own config name, three conditions, three
repetitions, interleaved from seed 41 across three lanes, judged blind. Sharing one batch is what
makes the arms comparable; an earlier unpaired Arm B run of 90 is in `results/superseded/`.

**Pulsar, the three bars** (README.md § "The comparison that is reported"):

| Pulsar          | documents alone | subagents | Sloppy |
| --------------- | --------------: | --------: | -----: |
| answer quality  |           0.905 |     0.911 |  0.919 |
| Sloppy's margin |          +0.014 |    +0.010 |      — |
| new text read   |            −21% |       −7% |      — |
| cost            |            −16% |       −8% |      — |

**For attribution only, never a bar:** the shaped documents read _without_ the sloppy server score
0.918, against 0.905 for the documents as they stand. So on this project most of the gain is in the
writing, and Sloppy is what gets the writing done that way and then reads it. Sloppy's own score is
0.922 unshaped and 0.919 shaped, so it was already taking what the unshaped documents held.

Read that way: most of what Sloppy delivers on this project is reachable by writing the documents
differently, and Sloppy is what gets a team to write them that way and then reads them. Sloppy's own
score is the same on either tree, 0.922 and 0.919, so it was already taking what the unshaped
documents held.

**Every score difference here is inside its own noise, which is the honest headline.** The spread of
the per-task difference is entirely run-to-run rather than task-to-task, and at three repetitions the
standard error on a subject mean is 0.018. So +0.014, +0.010 and the −0.003 between the arms all
carry intervals containing zero. What is firm is the token and cost direction, and that +0.017 against
the documents alone reproduced to three decimals across two independent batches of the unshaped tree.

### Arm B on LLVM, and the prediction is the opposite of Pulsar's result (2026-11-09)

Written before the shaping starts. Lining the six up by how often the documents-alone agent already
finds the answering document explains Pulsar's outcome and says LLVM should go the other way:

| Subject      | Words of docs | Sloppy vs documents | Docs alone found it | How documents are named |
| ------------ | ------------: | ------------------: | ------------------: | ----------------------- |
| LLVM         |     2,007,751 |              +0.008 |             12 / 12 | by subject              |
| Carbon       |       624,433 |              +0.016 |              9 / 12 | number and subject      |
| Pulsar       |       385,509 |     +0.017 → +0.001 |              6 / 12 | by number, indexed      |
| .NET runtime |       602,190 |              +0.034 |             12 / 12 | by subject              |
| Milvus       |       495,839 |              +0.039 |              6 / 12 | by date                 |
| GitLab       |     1,103,487 |              +0.044 |             10 / 12 | by subject              |

**Why Pulsar closed.** Its documents-alone agent found the answering document in only 6 of 12 runs, so
there was a large finding gap, and shaping filled it: `bare` rose 0.905 → 0.918 while Sloppy stayed
where it was. The shaping did the work Sloppy had been doing.

**Why LLVM should not.** Its documents-alone agent already finds the answering document **12 of 12**.
There is no finding gap for shaping to close, so `bare` cannot rise the way Pulsar's did. What LLVM
has instead is a matching problem on Sloppy's side: 67 of its documents open with no `#` heading at
all and the rest are titled by topic, and a question is matched against titles and headings. Give
those documents titles that state the decision and Sloppy's first answer should land where today it
guesses.

**So the prediction: on LLVM, shaping lifts Sloppy more than it lifts the documents alone, and the
margin widens from +0.008.** If it closes the way Pulsar's did, the finding-gap account above is
wrong and the honest reading becomes that shaped documents simply suit any reader and Sloppy adds
little either way — which is reported as it stands. The same reasoning puts the .NET runtime with LLVM
and Milvus with Pulsar, and those are the next two tests of it.

The gates are the ones Arm B already runs under: shaping lands in the tree so every condition reads
it, no sentence is reworded, `quote-gate.mjs` must still resolve every passage the graders cite, the
writer never reads the task pack, and both trees run in one interleaved batch under their own config
names so neither the hour nor the export can mix them.

### LLVM under the recommended workflow: the margin widened, as predicted (2026-11-09)

One batch, seed 42, both trees under their own config name, three conditions, three repetitions,
interleaved across three lanes, judged blind. 179 runs finished of 189 attempted; the ten that failed
were retried and 59 of the 60 task-cells hold three good runs, the last holding two.

**LLVM, the three bars:**

| LLVM            |         documents alone |                subagents | Sloppy |
| --------------- | ----------------------: | -----------------------: | -----: |
| answer quality  |                   0.944 |                    0.944 |  0.959 |
| Sloppy's margin | +0.016 (0.002 to 0.029) | +0.016 (−0.004 to 0.035) |      — |
| new text read   |                    −31% |                     −23% |      — |
| cost            |                    −27% |                     −19% |      — |

**That lower bound is the first in this record to sit above zero.** Against subagents the margin is
the same +0.016 and its interval still contains zero.

**For attribution only, never a bar:** the shaped documents without the sloppy server score 0.948
against 0.944 as they stand — barely moved. So here the shaping helped Sloppy rather than the plain
reader, which is the whole of why the margin widened.

**The prediction held and the mechanism with it.** LLVM's documents-alone agent already finds the
answering document 12 times in 12, so shaping had no finding gap to hand it: `bare` moved 0.944 to
0.948 where Pulsar's moved 0.905 to 0.918. What the shaping fixed was on Sloppy's side of the
comparison — 571 of 758 titles named a topic and now state what the document decides — so the margin
widened instead of closing. Pulsar and LLVM are therefore the two ends of one rule rather than two
contradictory results: shaping lifts whichever reader the project was failing, and on a project whose
file names already answer the finding question, that reader is Sloppy.

Two things recorded rather than tidied away:

**Arm A here is not the published LLVM figure.** The container measured all year held 564 of LLVM's
758 documents, from a carry that did not finish; this Arm A re-carries the same documents completely,
because an arm whose documents are shaped must not also be the only arm with a complete corpus. With
the full corpus the unshaped margin reads +0.004 where the published figure reads +0.008 — more
documents to sift through, and no task's answer was ever missing either way.

**Ten runs failed as "Claude Code exited with 0: no output", and none of them was an `mcp` run** —
three each in the two `bare` cells, two each in the two `agents` cells, where chance would put about
three in `mcp`. Every one reports zero turns, so the run never began answering, and they are spread
across tasks rather than gathered on the hard ones; it reads as a start-up flake on the largest
subject rather than anything about a condition. It is named here because a retried failure is a
filtered sample, and only one side was filtered.

### Carbon falsifies the rule, and the shaping made its documents worse (2026-11-10)

180 runs, seed 43, all `ok`, 30 a cell, no failures. The rule said Carbon's margin should land between
Pulsar's and LLVM's, since its documents-alone agent finds the answering document 9 times in 12
against their 6 and 12. It did not.

| Carbon, within seed 43 | documents | subagents | Sloppy | margin |
| ---------------------- | --------: | --------: | -----: | -----: |
| documents as kept      |     0.928 |     0.906 |  0.925 | −0.003 |
| shaped                 |     0.904 |     0.899 |  0.898 | −0.005 |

**Sloppy is level with the documents on either tree, and the shaping lowered all three conditions by
0.02 to 0.03.** Reported as the three bars — the documents as the project keeps them against Sloppy
under the recommended workflow — Carbon reads **−0.029 against the documents and −0.008 against
subagents**, the only subject where Sloppy is behind. The six-project average falls from +0.027 to
**+0.019** against the documents alone, with cost unchanged at −20%.

**The shaping is not broken; it is unhelpful here.** Its titles read sensibly — "Proposals" became
"Where accepted proposals live and how they are named", "Generics goals" became "Adopt a high-level
goals document for generics" — and 80,071 non-heading lines came through untouched with all 75 grader
quotes resolving. What Carbon did not have was headroom: its `Covers:` links rose 8% where Pulsar's
and LLVM's nearly doubled, because its documents already named their code, and its titles were
already short and indicative. One hypothesis for the drop, untested: a title that states a decision in
a full sentence carries more words, so a question's own words are a smaller share of it, and matching
gets worse rather than better. That is a guess about a mechanism and is written here as one.

**So the practices are not free, and the record should stop implying they are.** On three projects the
shaping helped two readers, one reader, and no reader respectively: Pulsar's plain agent gained most,
LLVM's Sloppy gained, Carbon's everyone lost. The finding-rate account predicted the first two and
failed on the third, so it is a partial rule at best and is withdrawn as a predictor. What survives
all three is narrower and duller: **shaping changes who finds what, and whether it helps depends on
what the documents already did.** Measuring it per project is the only way to know, which is an
argument against publishing the practices as general advice and for publishing them as what was
measured, project by project.

### Where the gain is, by what the task asks (2026-11-10)

Sloppy under the reported comparison against the documents alone, per task family, over the six
projects as the pages draw them (three shaped, three as kept), from `results/summary.json`:

| family  |   n | Sloppy vs documents |
| ------- | --: | ------------------: |
| why     |  24 |              +0.046 |
| handoff |  12 |              +0.037 |
| locate  |  12 |              +0.004 |
| drift   |   6 |              −0.029 |
| brief   |   6 |              −0.042 |

It pays where the ask is _why_ something was decided and where a reason must survive from one
agent to another with no shared memory. It pays nothing on _where is this code_, which a file-name
search already answers. It loses on briefings, where the agent works from excerpts of several notes
where reading one document whole would have served — the family a window composed to a budget would
serve first. `WHERE-SLOPPY-HELPS.md` § "What doesn't help" has the mechanism: a tool answering "where
in the code is this?" was offered in 60 runs and used once; agents rely on what their first call
returns.

## The fourth bar, written down before it runs (2026-11-10)

The three bars measure Sloppy as served today: an agent that fishes for notes through the sloppy
server. The fourth, the `harness` condition, measures `sloppy run`: Sloppy composes a window for the
task to a budget — the note that best answers it whole, the chain it sprang from, the notes beside it
in its tags, the lines of code its anchors point at — puts it in front of the model, and then applies
Sloppy's own acts for it turn after turn. It reads the same shaped documents as the third bar, under
the same task packs and the same blind judge, and it is reported as a fourth row of
the same setting.

**Where it runs first: Milvus and GitLab**, where finding was the binding constraint and the margins
were largest. If composing a window does not move a subject where finding is what decides the score,
it will not move one where it is not.

**The prediction.** The fourth bar moves _brief_ above the third's −0.042 against the documents
alone. _Brief_ is the family that loses because the agent works from excerpts of several notes where
one document whole would have served, and a window that puts the best note in whole, and cuts it
last, is built for exactly that. If _brief_ does not move, the window is not doing what it was
written to do.

**What would show it wrong.**

- The fourth bar at or below the third on _brief_ and on _why_: composing is no better than fishing,
  and the loop earns nothing on its own.
- The fourth bar ahead only on cost: the window saves tokens without changing what the model gets
  right. That is worth having, and it is not what a harness claims.

**Four differences from the third bar besides who composes the window**, stated now so they are not
discovered in the result. Any of them can move the number on its own, and none is corrected for.

- Its model is driven through the provider's API rather than through Claude Code.
- It is offered Sloppy's acts and nothing else — no file reading, searching or shell — so code
  reaches it only as the lines in its window and what `find_code` answers. It leaves handoff tasks
  out, since it cannot change a file.
- It is served the `full` setting — every act, answers in full, no landing on code — where the third
  bar's server starts `lean` unless its config names otherwise. Each record says which under
  `sent.harness` and `sent.mcp_args`.
- It runs in a batch of its own, so it does not share the third bar's hour or run order.

**The result stands whichever way it goes**, as every result in this file does. It is written here
beside this prediction, not in place of it.

## A seventh project, written down before its pack is finished (2026-11-10)

The developer asked for the MetaState prototype — Web 3 Data Spaces, a personal eVault with
platforms as interchangeable frontends — to be documented in Sloppy and measured. It is written
down here before the task pack exists, so that nothing about the setup is decided after a result.

**It is under the floor.** 104 Markdown documents, 95,079 words, 264,637 lines of code. The six
projects on the pages were chosen by a rule of at least 350,000 words of design documents; this one
has a quarter of that. It is measured because the developer asked for it, and it is reported **as a
seventh project, outside the six-project average**, until the developer says otherwise.

**How its documents are named.** A Docusaurus site at `docs/docs/<Topic>/<name>.md` — W3DS Basics,
W3DS Protocol, Infrastructure, Services, GitW3, Post Platform Guide — plus the agent skill's
`skills/w3ds/reference/*.md` and the README under each system folder. Named by topic, so a file-name
search finds most of them; the finding-rate rule that would have predicted a small margin from that
was withdrawn on Carbon, so **no direction is predicted here**. What is predicted is the shape of the
setup's own effect: the carry made 48 code links from documents as kept and 79 from the shaped ones,
the smallest headroom of any subject so far, because these documents rarely name a repository path.

**The two trees.** Documents as kept, with a container of 197 notes tagged by system: `sloppy/notes`
at `3849c07a`. Shaped the way the practices set out — 91 of 93 titles rewritten, 10,181 lines preserved,
88 `Covers:` paths all resolving — with its own container of 197 notes: `sloppy/shaped` at
`533f327b`. Both run in one interleaved batch under the config names `asis` and `shaped`, three
conditions, three repetitions, three lanes; the three bars read the documents and subagents from
`asis` and Sloppy from `shaped`, as README.md § "The comparison that is reported" says.

**What the container holds that the others did not.** Every note is tagged with the system it is about
and the documentation's topic, read off the paths; the 41 notes a system hangs under are drawn large;
the graph's face is the project's own `w3dslogo.svg`, kept in `media/`; and each platform's icon from
`packages/platform-icons` is **offered** onto that platform's note rather than written there, because
those notes were started by `sloppy init` as the device's writing and a tool's writing on a note it
did not start is an offer. The first shaped carry was itself held out as 93 offers for the same reason
and was redone as the carrier's own notes; the lesson is recorded in `carry-docs.mjs`'s README section.

**The pack** is being written by a writer who has not seen either container, to the shape of the
other six; its quotes are gated against both trees before anything runs. Whatever it shows stands.

## The seventh project, measured (2026-11-10)

The pack came back blind — ten tasks, 57 quoted passages resolving word for word in both trees —
and ran as preregistered: one batch, seed 44, both trees under `asis` and `shaped`, three conditions,
three repetitions, three lanes, 180 runs planned. Three things happened on the way that are written
down here before the numbers, because each moved them.

**A DNS outage, and what a provider's failure counts as.** For about five minutes around run 139 the
API could not be resolved. Eleven records failed: four at a stage A's start (`turns` 0, unscored as
always) and seven mid-answer, after one to four turns of real work. Five cells spent their one retry
inside the outage and were run again afterwards, one `run --reps 1 --seed 44` each, so every cell has
its three finished runs (191 records, 180 `ok`). Under the rule as it stood — a run that started and did
not finish scores 0 and sits in every mean — the seven mid-answer records counted as answers worth zero,
two of them in the subagents' `why-rate-limit-ceiling` cell and one in Sloppy's `why-company-board`,
and their 180 to 275 seconds of DNS retries sat in the time means. That rule exists so a condition is
judged on what it delivered; an outage is not something a condition delivered. The runner already
treated a rate limit as the provider's failure and ran the run again without spending its retries;
the API being unreachable is the same class, so `providerFailed` (`lib/record.mjs`) now names both,
read from the failure alone, and the runner, `scoreOf` and the export all leave such a run unscored
and out of every mean (README.md § "What counts as better"). Across every batch kept here, the
seven records of this one are the only failed runs with turns the rule touches: LLVM's ten were never
started and were unscored already.

**The drift grader met the real answers.** Nine of the eighteen drift answers stated the planted
change correctly and scored 0, for saying "a score of 99 from any engine passes" where the gate wanted
"it accepts any engine", or stating the rule as the denial it calls for. Widened to those phrasings
before judging, all eighteen score 1 and the suite's wrong answers score as before; the re-grades are
appended, and the phrasings are in the fixture (`tasks/metastate/README.md` § "The drift task").

**The subject file called the code documents.** `metastate.json` listed the four system folders among
`docs` so the carry would read the READMEs under them, and the export, which counts every file under
`docs` as a document, put the project at 1.5 million words — above the floor it was preregistered as
under. The list now names the 93 documents the carry read: `docs/docs`, `skills/w3ds/reference`, the
two root files, and the 32 READMEs and guides under the system folders, one by one. The export counts
100 files and 89,534 words of documents and 683,689 lines of everything else; the
preregistration's 104 and 95,079 were counted by hand with a different rule, and the export's count
is the figure of record. Under the floor either way, and reported outside the average.

**The three bars.** Documents as kept 0.925 [0.865, 0.976],
subagents 0.921, Sloppy on the shaped documents 0.946
[0.909, 0.976]: **+0.021** over the documents and
+0.024 over subagents, 30 runs a bar, inside the noise one project carries. Had the rules stood
as written, the three would have read 0.925, 0.892 and 0.922; with the grader as written and the outage
runs unscored, 0.925, 0.888 and 0.929. New text read 10,221 tokens against
15,304 (**−33%**), cost $0.066 against $0.090
(**−27%**), 7.0 round trips against 7.5, and 33.3 seconds a task against
32.0: slower, by the pattern Carbon showed, a note read in pieces where a search opens the document
whole. Sloppy's runs opened 8.1 files and notes a task against 10.7 files.

| task                      | documents | subagents | Sloppy | Sloppy − documents |
| ------------------------- | --------- | --------- | ------ | ------------------ |
| `brief-platform-data`     | 0.93      | 0.93      | 0.82   | -0.10              |
| `drift-reputation-engine` | 0.99      | 1.00      | 1.00   | +0.01              |
| `handoff-handshake-ttl`   | 1.00      | 1.00      | 1.00   | +0.00              |
| `handoff-jwks-timeout`    | 1.00      | 0.93      | 1.00   | +0.00              |
| `locate-awareness-path`   | 0.99      | 0.99      | 0.90   | -0.09              |
| `locate-file-uris`        | 0.99      | 0.98      | 0.98   | -0.00              |
| `why-company-board`       | 0.73      | 0.84      | 0.95   | +0.22              |
| `why-handshake-evidence`  | 0.80      | 0.83      | 0.94   | +0.14              |
| `why-on-behalf-of`        | 0.97      | 0.97      | 0.90   | -0.07              |
| `why-rate-limit-ceiling`  | 0.86      | 0.74      | 0.96   | +0.10              |

The why-questions are where it gained, three of four: the documents-alone agent answered them from
the code's comments, which repeat the reasons in part — `history.ts` for the company board,
`chain.ts` for the handshake, `global-rate-limiter.ts` for the ceiling — and never named the document,
which is half of what the judge asks for. It lost the briefing, as it has on most projects, working
from the skill's reference pages instead of the protocol page, and it lost one where-question for a
reason worth keeping: `Awareness-Protocol.md` says "matching subscriptions" and never names
`SubscriptionMatcher`; a code search named the class, and Sloppy's three runs described the step from
the note and never opened it.

**Attribution, for this file and never for a page.** The shaped documents without the server scored
0.950, +0.025 over the documents as kept: the shaping lifted the plain agent, as it did
on Pulsar. The documents as kept with the server scored 0.959, the highest reading of the six
and +0.013 over the reported Sloppy bar. So on this project the server is what moved the
score and the shaping added nothing on top of it; all four readings are within one project's noise of
each other, and the reported comparison stays the one README.md § "The comparison that is reported"
defines.

**What it says about the floor.** A project a quarter the size the six were chosen at, with
topic-named documents a file-name search finds, still read +0.021, at a third less text. One
project, inside noise; it stays a seventh, outside the average, and the floor stays a rule about what
the average is made of rather than a prediction of where Sloppy helps.

## A review of the three measures (2026-11-10)

The developer asked whether the cost, time and new-text figures are computed correctly, before taking
them as the gains a project gets from structuring its documents for Sloppy. Each was read back from the
code and checked against the runs' own records.

**Cost is Claude Code's own figure, and it is right.** Every published run's cost is `cost_usd.reported`,
Claude Code's `total_cost_usd`; `prices.json` holds no `claude-sonnet-5-5` row, and could not price these
runs anyway, because Claude Code writes the prompt cache at the one-hour rate, which the table does not
hold. A least-squares fit of Claude Code's own per-model `costUSD` on its per-model usage over 401 runs
recovers $2.00 input, $4.00 cache write, $0.100 cache read and $10.00 output a million tokens with
R² = 1.00000 — Anthropic's published Sonnet 5.5 prices with the one-hour cache write (the cache read was
cut from $0.20 to $0.10 on 2026-10-07, and Claude Code 2.1.311 bills the new price). Every cache write in
the sample is at the one-hour rate; subagents' usage is in `modelUsage` and so in the cost. Most of what
Sloppy saves is cache writes, which carry the premium, so the saving reads larger at this rate than at
five minutes: over the six projects, **−19.6% as billed against −18.0% at the five-minute rate**
(GitLab −13.5/−11.8, Milvus −37.5/−35.4, Pulsar −16.2/−14.9, LLVM −26.0/−24.3, Carbon −9.2/−7.6, .NET
−15.6/−14.2; MetaState −26.5/−24.2). The pages say which basis they use.

**Time is the wall clock around the agent's process, variant reset excluded.** `runOnce` resets the
variant and applies the task's setup, then `started = performance.now()` brackets `runBackend` alone, so
a run's time is Claude Code's start-up, its model calls and its tool calls — the Sloppy server's own
start-up included, since Claude Code spawns it. A handoff's two stages are summed. The pages read
`wall_ok`, over finished runs only. The first-token gap between Sloppy and the documents alone is within
±0.6 s on six projects (GitLab +0.1, Milvus +0.3, Pulsar −0.3, LLVM −0.6, Carbon −0.4, .NET +0.6) and
+2.9 s on MetaState, which is the whole of its 4% — so the server's start-up is not a general cost, and
MetaState's page now says that rather than guessing at long notes.

**New text read is `input + cache_write`: the tokens a model priced as new.** Uncached input is a few
tokens a run; nearly everything new is a cache write, and the conversation re-read each turn is
`cache_read`, three to five times larger and billed at a twentieth. Two things to know when reading it.
The system prompt and tool list are cache-read even on a run's first turn, because the previous run in
the batch wrote them, which is the same for every condition. And total input processed is close to equal
— on MetaState 59k with the documents, 60k with Sloppy, 73k with subagents — so what Sloppy changes is
the mix: a third less written, somewhat more re-read, and 14% fewer output tokens. That mix is where the
money is, and the asterisk on the pages says so.

**One correction from the review.** A run that never began answering (a Claude Code start-up failure,
ten on LLVM) was already out of the token and cost means — its tokens are marked unknown, not zero — but
its `turns: 0` and its seconds of failed start-up were in the turns and `wall_s` means. `measured`
(`lib/record.mjs`) now leaves such a run out of every mean, beside a budget-stopped run and a provider's
failure. LLVM's documents-alone turns move from 6.25 to 6.90 and its subagents' from 6.22 to 6.63; the
six-project round-trips figure reads 6% fewer where it read 4%; no score, token or cost figure moves.

**What the numbers mean.** The quality gain is small — +0.019 over six projects, inside one project's
noise on each, ahead on five of seven and behind on Carbon — and the cost and new-text savings are the
robust part: lower on every project, by 9% to 38% as billed. They are not free. The carry is a script,
but the shaping is work that a project does once and keeps doing, and on Carbon it lowered every reader;
the notes' upkeep (`sloppy check`) is a cost these runs do not pay. What a project adopting Sloppy from
the start gets, by these runs, is a reading agent that finds the reason in the document rather than
rebuilding it from the code, at a fifth less spend — with answers that are about as good, not better.

## Carbon again: shaped as a maintainer would, written down before it runs (2026-11-10)

The developer read the Carbon result and ruled on it: the drop was the shaper's fault, not the
practices'. A model rewrote 223 of Carbon's 286 titles into nine-word sentences (3.8 words a title to
9.4), restated openings that already held an abstract, and linked documents to documents — none of
which a maintainer following the practices would do to a project whose titles were already short and
whose proposals already open with an abstract. Measured, the same shaper trebled LLVM's and
MetaState's title lengths too, and on neither did Sloppy gain from it: LLVM's gain came with it, but
MetaState's Sloppy scored higher on the unshaped tree (0.959 against 0.946). What distinguishes
Carbon is that its documents already did what the titles-and-openings practices ask, so the rewrite
could only take away.

The transcripts say where it took from. On the trailing-comments drift, two of three Sloppy runs on
the documents as kept searched the notes, hit **"Trailing comments"**, read its Details and found the
`//@` rule; on the shaped tree none of three searched the notes at all — `find_code` on
`Lexer::LexComment` attached the notes "C++ idioms…" and "toolchain", never the proposal, because
the proposal did not point at `toolchain/lex/`, and the runs went into the code and took the
function's own comment as the intent. Carbon's documents name a code file in 14 of 286 cases.

**The rule, stated generally.** A maintainer's shaping touches two things and leaves the rest:

1. **Each document points at the component it governs** — practice 4 — by one `Covers:` line naming
   the directories whose vocabulary the document uses, the vocabulary taken from the project's own
   component documents (`toolchain/docs/*.md`), at least three mentions, at most three directories,
   none for a document that names none (governance and process). Titles, openings and headings are
   not touched; every original line stays.
2. **Each note is tagged with its area**, read off the document's path and its anchors — practice 1's
   "title and tags together" — one word each.
   The tool is `anchor-docs.mjs` and `tag-notes.mjs`, deterministic, with the subject's vocabulary in a
   data file and no model in the loop; `bench/README.md` carries them. The same tool is what the three
   projects not yet shaped (GitLab, .NET runtime, Milvus) will get, so it is not tuned to Carbon.

**Predictions.** The documents as kept differ from the shaped tree by one line in the anchored
documents and nothing else, so the documents-alone and subagents bars should land within noise of
their seed-43 readings (0.928 and 0.906). Sloppy on the anchored tree should land **at or above its
as-kept reading of 0.925**, between 0.925 and 0.950, with the trailing-comments drift recovering
toward its as-kept 0.90 because `find_code` now attaches the proposal to the lexer. New text read
should stay near the as-kept −21%. If Sloppy lands below 0.925, the anchors did not help and the
practices' fourth step is weaker than claimed; that goes on the record the same way.

One batch, seed 45, `asis=b474eb8c` and `maintainer=6baf95b2` (branch `sloppy/shaped-maintainer`: 48 of 286 documents anchored, 83 anchors — lex 25, check 17, parse 17, sem_ir 9, lower 5, driver 4, diagnostics 3, codegen, format and base one each; 167 of 192 proposals untouched; 303 notes, 284 tagged; one rule tightened before the run, the bare word "token" dropped from the lexer's vocabulary because the language documents use it for grammar tokens in general), three
conditions, three repetitions, three lanes; both figures — this and seed 43 — stay in this file, and
the pages carry whichever the reported-comparison rule gives once the run is judged.

## What the maintainer's shaping showed, against its predictions (2026-11-10)

180 runs, seed 45, all `ok`, 30 a cell. The predictions held in every part.

| Carbon, within seed 45 | documents | subagents | Sloppy | margin |
| ---------------------- | --------: | --------: | -----: | -----: |
| documents as kept      |     0.928 |     0.916 |  0.945 | +0.017 |
| anchored and tagged    |     0.919 |     0.890 |  0.957 | +0.038 |

**The plain readers did not move** — documents alone 0.928 as kept against 0.919 anchored,
subagents 0.916 against 0.890, inside noise both — as one added line per anchored document
predicts. **Sloppy on the anchored tree scored 0.957** [0.925, 0.979], above its as-kept reading
within the same batch (0.945) and inside the predicted 0.925–0.950 only at its upper edge: it cleared it. Reported as the three
bars — the documents as kept against Sloppy under the recommended workflow, both from this batch —
Carbon reads **+0.029 against the documents and +0.041 against subagents**, new text read
−11%, cost −10%, 4% slower. The six-project average against the documents alone moves from +0.019
to **+0.029**; cost and text are unchanged at −20% and −24%.

| task                          | documents | subagents | Sloppy | Sloppy − documents |
| ----------------------------- | --------- | --------- | ------ | ------------------ |
| `brief-safety`                | 0.80      | 0.87      | 0.84   | +0.05              |
| `drift-trailing-directives`   | 0.90      | 0.97      | 0.97   | +0.07              |
| `handoff-bracket-region`      | 1.00      | 1.00      | 0.99   | -0.01              |
| `handoff-locked-cache-age`    | 1.00      | 1.00      | 1.00   | +0.00              |
| `locate-bracket-recovery`     | 0.99      | 0.96      | 0.97   | -0.02              |
| `locate-diagnostic-rendering` | 0.99      | 0.85      | 0.97   | -0.02              |
| `why-charliteral-difference`  | 0.94      | 0.94      | 0.96   | +0.01              |
| `why-clang-irgen`             | 0.99      | 0.98      | 0.98   | -0.01              |
| `why-diagnostic-sorting`      | 0.74      | 0.70      | 0.98   | +0.24              |
| `why-orphan-scopes`           | 0.93      | 0.89      | 0.91   | -0.01              |

The trailing-comments drift recovered as predicted and by the mechanism predicted: every Sloppy run
on the anchored tree opened the proposal's note (`find_code` on `Lexer::LexComment` reaches it through
`toolchain/lex/`), where none did on the sentence-titled tree. The largest single gain is
`why-diagnostic-sorting`, 0.74 to 0.98: the proposal is anchored to `toolchain/diagnostics/`, and the
agent was handed it from the code it asked about.

**What is reported, and what is kept.** The developer ruled, before this batch ran, that seed 43's
drop was the shaper's fault and not the workflow's; the predictions written down with that ruling
held; so Carbon's reported comparison is this batch, and the export reads seeds 30, 31, 32, 41, 42,
44 and 45 — seed 43 stays in `results/` and in this file as the record of what a model's rewrite of
titles and openings does to documents that already did the work. Nothing from seed 43 is averaged
with anything from seed 45: the two `asis` batches are the same commit, but the reported bars come
from one hour. The practices page says it in one sentence now: a model's rewrite made every reader
worse; the maintainer's shaping did not.

**What it says about the practices.** Of the four, the one that moved Carbon is the fourth — point
each document at the code it governs — applied without touching the first two, and the tool that
applies it is deterministic. The first two practices (title with the decision, decision in the
opening) stand where a project's titles do not say what they decide; where they already do, the
measured advice is to leave them. GitLab, .NET runtime and Milvus are next for the same tool.

## MetaState with substance, written down before it runs (2026-11-10)

The developer opened MetaState's graph and ruled that it was not a container at all: a note per folder
with nothing in it, documents hung by path, lines where a README happened to name a path. "If a human
was making it, they would put something in it." The ruling goes further than this project — every
container measured so far was a carry, documents copied one per note and linked, and the developer
names that as the reason the margins have been small: the agent was handed a file search's worth of
structure and nothing a maintainer knows. That is recorded as a standing correction; the six earlier
containers are to be redone the same way once this one has been reviewed.

**What the container now holds** (branch `sloppy/mine`, under the developer's own identity): an
ownership map read from the code — six layers, a _shared records_ section under the protocol, a
_shared components_ section under infrastructure, every document under the component it documents,
Registry and Ontology moved to infrastructure, 536 labelled lines (uses, used by, reads and writes,
specified by, implemented by, duplicates); and, being written now by seven workers reading the code, a
maintainer's page per component — what it is, what it does, how it is built, what it talks to, the
records it maps, its quirks and open questions — 63 components, every claim with a file path, plus a
page per layer and section. The empty sub-folder shells init made are binned.

**Predictions.** The documents as kept (`3849c07a`) are unchanged, so documents alone and subagents
should land within noise of seed 44 (0.925 and 0.922). Sloppy, reading this container, should land
**above its shaped reading of 0.946 and above the documents**; the gain should sit in the
why-questions and the briefing, which are the questions a maintainer's page answers, and the drift and
locate tasks should hold. New text read should fall further than seed 44's −33%, because a component's
page answers what a search of its folder answered before. If Sloppy lands at or below 0.946, the
substance did not reach the agent — the brief's excerpts, the matching, or the pages themselves — and
that is the next thing to look at, not the numbers.

One batch, seed 46, `asis=3849c07a` and `substance=e5a96d87` (branch `sloppy/mine`: 180 notes, 89 of them a written page, 132,700 words against the carry's 95,000; 81 pages from seven workers, eleven lines corrected to what the code does, 47 empty shells binned),
three conditions, three repetitions, three lanes; judged blind; reported beside seed 44, with the
developer reviewing MetaState before the other six are touched.

## What the substantive container showed, against its predictions (2026-11-10)

180 runs, seed 46, all `ok`, 30 a cell, judged blind.

| MetaState, within seed 46                                           | documents | subagents |    Sloppy |     margin |
| ------------------------------------------------------------------- | --------: | --------: | --------: | ---------: |
| reported: documents as kept, Sloppy on the substantive container    |     0.917 |     0.900 | **0.955** | **+0.037** |
| Sloppy on the thin container, same batch (attribution, never a bar) |           |           |     0.964 |     +0.046 |

**Two predictions held, two did not.** Sloppy landed above its shaped reading (0.946) and above the
documents, at 0.955 [0.930, 0.977] — **+0.037 over the documents and +0.055 over
subagents**, the widest margin of any project, with the interval clear of the documents' mean. The gain
sat in the why-questions as predicted (the judge's half: 0.834 for the documents to 0.912). The briefing
did not gain (0.93 to 0.91), and new text read fell less, not more: −13% against the thin container's −33%,
because a component's page is long and the agent reads it in pieces. Cost −10%, time −2%.

| task                      | documents | subagents | Sloppy, substantive | Sloppy, thin |
| ------------------------- | --------- | --------- | ------------------- | ------------ |
| `brief-platform-data`     | 0.93      | 0.95      | 0.91                | 0.89         |
| `drift-reputation-engine` | 0.90      | 0.83      | 0.99                | 1.00         |
| `handoff-handshake-ttl`   | 1.00      | 1.00      | 1.00                | 1.00         |
| `handoff-jwks-timeout`    | 1.00      | 1.00      | 1.00                | 1.00         |
| `locate-awareness-path`   | 0.98      | 0.86      | 0.90                | 0.90         |
| `locate-file-uris`        | 0.99      | 0.99      | 0.96                | 0.98         |
| `why-company-board`       | 0.80      | 0.69      | 0.90                | 0.98         |
| `why-handshake-evidence`  | 0.82      | 0.88      | 0.95                | 0.95         |
| `why-on-behalf-of`        | 0.93      | 0.98      | 0.96                | 0.96         |
| `why-rate-limit-ceiling`  | 0.83      | 0.80      | 0.96                | 0.98         |

**What the pages did not do is beat the thin container.** Sloppy reading the bare carry, in the same
batch, scored 0.964. On the facts graders the two are level (0.981 against 0.993); on the judge's
half the thin container is ahead (0.947 against 0.935), and the items that separate them are the ones
that ask _where the reason is written_: on `why-company-board` and `why-rate-limit-ceiling` the judge
gave the substantive runs 0.60 and 0.73 for naming a source against 0.92 and 0.93 for the thin ones.
Reading the answers, the substantive runs cite the component's page — "the eVault note says…" — where
the thin runs cite `Company-Delegation.md` or `eVault.md`, which is what the judge's key names. The
page is a secondary source and the judge is right to mark it down; and on `why-company-board` the
substantive runs also said more that the key could not verify (0.53 against 0.70 on "nothing false"),
some of it the page's own findings about the code. So the pages changed what the agent cites, from the
document to the maintainer's account of it, and this task pack rewards the document.

**What the pack cannot see.** Every question in it was written from the documents, so a container
that carries the documents answers it, and a page that says what the documents do not — that the
Registry signs a token for any name, that the adapter never syncs deletes, that profile edits never
reach the eVault on five platforms — is not asked about. Those are the questions a maintainer actually
has, and they are what the pages are for. A pack that asks them is the next thing to write, and it
should be written from the code, not from the documents, so that the documents-alone agent is not
handed its answers either.

**What is reported.** MetaState's reported comparison is this batch (`substance=e5a96d87`), under the
developer's ruling that a maintained container is the workflow being measured; seed 44 stays in
`results/` and in this file as the record of the thin carry. The export reads seeds 30, 31, 32, 41,
42, 45 and 46. MetaState stays the seventh project, outside the six-project average.
