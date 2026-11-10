# Where Sloppy helps, and how to shape a project for it

A guide for a team bringing Sloppy to a large codebase: what kind of project gains most, and what
to do with your notes so yours does. The numbers behind it are in [§ Evidence](#evidence), from
[`bench/SURVEY.md`](SURVEY.md) and [`bench/REPORT.md`](REPORT.md).

## The short version

Sloppy pays when **an agent working without it would not find the document that holds the
reason**. With Sloppy, the agent's first look at the notes named the right note in 75% to 100%
of runs on every project where that could be checked. What differs between projects is how often the
agent finds that document anyway. Where it usually does, Sloppy adds a little. Where it often
doesn't, the agent with Sloppy answers better, in fewer steps, for much less.

A project gains most when:

1. **The reasons live in documents, not in the code.** Nothing in the code points to them, so
   searching the code leads to the code and stops there.
2. **File names don't say what a document decides.** Dated or numbered files, many to a folder.
3. **The instructions file sends the agent somewhere else.** It lists required reading that
   doesn't hold the answer, or never mentions where the design documents are.
4. **The documents are long.** Each one is several thousand words, with the answer to a given
   question in one section.

It gains least when one search of file names already finds the answer, when the answer is in the
code, or when the instructions file already holds most of the reasons.

## The worked example: Milvus

Milvus keeps 486k words of design documents in 169 files. 117 of the 125 files in
`docs/design-docs/design_docs/` are named by date, for example
`20260716-proxy-metacache-id-inverted-index.md`. Inside, the document says exactly what it
decides:

```markdown
# Proxy MetaCache: id-primary store with lazily-validated hints

- Scope: `internal/proxy/meta_cache.go`, `internal/proxy/version_cache.go`, …
```

It goes on in sections headed `Problem`, `Design`, `Concurrency` and `Alternatives rejected`.

Nothing an agent reads first leads to that file. None of the code it explains mentions it: 10 of the 4,477 Go
files under `internal/` and `pkg/` mention a design document at all. The instructions file, `CLAUDE.md` (1,615
words), sets out a "Mandatory reading procedure" through the subsystem guides in
`docs/agent_guides/`. It mentions `docs/design-docs` only as the place to put a new feature's
design document.

Asked why the cache is keyed the way it is, Claude Code without Sloppy followed those
instructions. In all three runs it read the streaming-system guides, then the cache code, and
answered from the code after 14 to 16 turns. It never opened the design document. With Sloppy,
the first look at the notes returned that document's note by its title, the agent read the
sections it needed, and every run finished in 5 or 6 turns.

Across all of Milvus's why-questions in the final test, the agent without Sloppy opened the
answering document in 6 of 12 runs and averaged 11.8 turns and 189k tokens. With Sloppy, it
opened the answering note in 12 of 12 runs, in 6.3 turns and 78k tokens. Code-file reads per run
fell from 4.5 to 0.6. Milvus is the only open-source project where Sloppy read fewer tokens than
the docs alone in every round.

## Shaping your notes

Each step serves one thing Sloppy does. Most also make the documents better for people.

**1. Title every note with what it decides, in the words someone would ask in.** Sloppy matches a
question's words against each note's title and tags together with its best-matching section. A file name
like `20260716-….md` costs nothing as long as the heading reads "Proxy MetaCache: id-primary
store with lazily-validated hints". A heading of "Design" or "Notes" does cost you. When you bring
in existing documents, the note's title comes from the first `#` heading, then from the
front-matter `title`, then from the file name. Give every document one of the first two.

**2. Put the decision and its reason in the opening section.** On a long note, Sloppy shows the
agent the opening and a list of section headings with their sizes. The agent then asks for
sections by heading. An opening that states the decision often answers the question without any
more reading. Headings that name what a section answers ("Alternatives rejected", "Why not a
global lock") let the agent pick the one it needs instead of reading the whole note.

**3. Keep one decision per note.** The first answer returns the best-matching note, and one title
can only name one decision. A note that settles five things will match all five questions
weakly. Split it where the sections stop depending on each other, and link the parts.
_Evidence is thin here:_ the measured notes were whole documents carried as they were, and
Milvus did best with the longest documents.

**4. Point every note at the code it explains.** Use a `[text](code:path#L10-L40)` link, a
quoted run of lines, or, in a document you bring in, a line naming the files like Milvus's
`Scope:`. Every repository path a document names becomes a link from its note. This lets the
agent go from the reason straight to the right lines instead of searching for them, and it is
what `sloppy check` reads to tell you a note has fallen behind its code.

**5. Keep the instructions file for what every task needs.** That means build, test, style and
the rules every change follows, plus one line saying the reasons are in the notes and should be
read before answering why or changing behaviour. Don't route the agent through a mandatory
reading list: it will read that list instead of the note that answers. When the instructions
file already holds most of the reasons, the agent has them before it asks, and Sloppy adds
little (see below).

**6. Tag notes with the system they are about.** One word per system, using the graph's existing
words before adding new ones. Tags let a person select a system and see every note about it,
and they count beside the title when a question's words are matched. _Not measured for agents:_
the benchmark's notes carried no tags, and in 1,438 runs agents almost never asked for one.

**7. Keep notes true with `sloppy check`.** It reads every note and lists the ones whose quoted
code has moved, changed or gone. Run it in CI or before a release, and fix the notes it lists.
Only a person marks a note as read against the code; Sloppy and agents never do. A note that
contradicts the code misleads an agent that trusts it. _Not measured directly:_ the benchmark's
drift tasks test whether an agent notices that the code and the documents disagree, not whether
`sloppy check` was run.

**To start from existing documents,** carry them in one document per note
(`bench/carry-docs.mjs`, described in [`bench/README.md`](README.md) § "Carrying a
project's documents"). That is how every large project in the benchmark was set up, word for
word. Then apply steps 1, 2 and 4 to the documents your team is asked about most.

## What doesn't help, or isn't proven

- **Small or well-summarised repositories.** On Sloppy's own repository and on syr, the
  instructions file already holds most of the reasons. There Sloppy tied on score and read more
  tokens (7% to 26% more in the development rounds).
- **Plainly named documents.** On GitLab (`…/data_retention_policy.md`) and LLVM
  (`llvm/docs/LFI.md`), one file-name search finds the answer. There Sloppy read a fifth to a
  quarter more tokens, though it still cost 11% to 13% less and scored no lower.
- **Answers that live in code.** Where a configuration flag or a comment explains the decision,
  the agent answers from the code either way.
- **Overviews that tie many documents together.** Briefing tasks scored lower with Sloppy on four
  of six projects (GitLab 0.82 → 0.65). The agent works from excerpts of several notes instead of
  reading one document whole.
- **New ways to search.** A tool that answers "where in the code is this?" was offered in 60 runs
  and used once. Agents rely on what their first call returns, not on extra tools.
- **Rewritten notes.** Every note on the large projects was a document carried word for word. The
  steps above follow from how Sloppy finds and reads a note, but none was tested as a writing
  practice. Try them on the questions your team asks most and compare.

## The index is the exception, and it is the lesson

Pulsar is the one project whose documents are named worse than Milvus's — `pip-1.md` to
`pip-486.md` says less than a date does — and it is where Sloppy spared the least. The reason is
one committed file. `pip/000-INDEX.md` is a table of every proposal's number and title, and the
transcripts show the documents-alone runs reading it and then going straight to what matters:
across four runs, `pip-462.md` was touched 67 times and `pip-460.md` 27, against 14 for the index
itself. Milvus has no such file — its `docs/design-docs/README.md` says the directory "contains
Design Docs" and lists none, and no file in the repository references those documents by name — so
its runs spread instead, the most-touched document reaching 9 mentions and the rest trailing off
across `truncate_collection`, `shard_split`, `online-schema-evolution` and others that answered
nothing.

Counting what each run opened, Milvus falls from 11.1 files and notes to 6.5 with Sloppy, the
largest drop of the six; Pulsar goes from 8.9 to 9.2, opening one note on top of the files it
was going to read anyway.

**So Sloppy's gain is the searching a project has not already done for its readers.** An index, or
a file name that says what is inside, is a project paying that cost itself, and where it has, there
is little left to win. The practices above are worth following for the documents' own sake; none of
them is a reason to take your index away.

## Evidence

All Sonnet through Claude Code, judged blind. Sloppy compared with the same agent using the docs
alone. Full method in [`bench/REPORT.md`](REPORT.md); every round in
[`bench/SURVEY.md`](SURVEY.md).

**Milvus, every round** (score difference; tokens, cost and time against the docs alone):

| Round                        | Score  | Tokens            | Cost | Time |
| ---------------------------- | ------ | ----------------- | ---- | ---- |
| Survey batch                 | +0.04  | −34% (139k → 92k) | —    | −29% |
| Round one                    | +0.11  | −32%              | −28% | −26% |
| Round two                    | +0.03  | −28%              | −32% | —    |
| Round three                  | +0.144 | −36%              | −39% | −15% |
| Final test (three runs/task) | +0.039 | −29%              | −37% | −9%  |

**How often the agent opened the answering document** on why-questions in the final test (12
runs a side). The docs-alone column tracks Sloppy's gain, with one exception below:

| Project      | How its documents are named      | Docs alone found it | Sloppy's first look found it¹ | Sloppy, cost |
| ------------ | -------------------------------- | ------------------- | ----------------------------- | ------------ |
| Milvus       | by date, `YYYYMMDD-…`            | 6 / 12              | 9 / 12                        | −37%         |
| Pulsar       | by number, `pip-NNN.md`, indexed | 6 / 12              | 9 / 12                        | −13%         |
| Carbon       | number and subject, `pNNNNNN-…`  | 9 / 12              | 12 / 12                       | −10%         |
| GitLab       | by subject                       | 10 / 12             | —                             | −13%         |
| LLVM         | by subject                       | 12 / 12             | 12 / 12                       | −11%         |
| .NET runtime | by subject                       | 12 / 12             | 12 / 12                       | −17%         |

¹ Whether the first call's result named the answering document's note by its title. GitLab's
documents have no `#` title, so this couldn't be checked there. The cost column covers all of
the project's tasks.

The exception is the .NET runtime: its documents are named by subject and found every time, yet
Sloppy cost 17% less, and its why-questions took 5.4 turns against 8.1. Those runs haven't been
traced, so that gain is unexplained.

**Milvus, mechanics in the final test** (30 runs a side, all tasks): turns 8.9 → 6.7; tokens per
run 123k → 81k; file reads per run 3.7 → 1.5; the answering document opened in 11 of 24 runs
that have one without Sloppy, 20 of 24 with it. Runs that read the subsystem guides the
instructions file requires: 10 of 30 without Sloppy, 0 of 30 with it.

**Where the evidence is thin.** Three runs per task; a single task moved by 0.17 to 0.33 between
builds that differed in one place, so read project means, not single tasks. Six projects is too few to
weigh the four conditions in "The short version" against each other. Milvus has all four at
once, and the benchmark can't separate them. The judge is a Claude model.
