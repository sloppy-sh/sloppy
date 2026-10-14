# Sloppy

**A second brain for a project, and the one place the people working on it and the
assistants working beside them keep the same account of what it is for.**

Sloppy is a note-taking app whose notes are a graph: every note knows what it sprang out
of, carries an address you can cite, and wears the tags that put it in a set. Point a
graph at a codebase and it becomes something more particular — the record of _why that
project is the way it is_, written where a person and a machine can both read it, placed
by what each decision came out of rather than filed in a folder somebody invented.

![The graph reading, a project's notes beside its code, with an assistant working in the same graph](docs/images/reading-the-graph.jpg)

## The problem

Large projects fail at the same two seams.

**Between people.** The reasoning behind a system lives in the heads of whoever built it,
in a chat thread nobody can find, or in a document that stopped being true a year ago.
When those people leave, what arrives in their place is a codebase and no account of it.

**Between people and their assistants.** An agent asked to change something either gets a
prompt somebody typed from memory, or it reads the whole repository and burns its context
discovering what two sentences would have told it. Nobody can see what it was given, so
nobody can check what it did against what it was told.

Sloppy's answer to both is the same: **one graph, shared, that the code is answerable
to.** A note says what a thing is for; the code is what somebody built to do it; either
can be checked against the other, and the answer goes back in the note where the next
reader finds it. The notes are ordinary markdown files in the repository, so they are
reviewed, branched and merged with the code they are about.

## Who it is for

- **People leading a project who want to be answerable for the AI in it.** Not "did the
  model do well" — _what was it told, what did it write, and does the result match what
  the note said the thing was for._ Sloppy makes each of those a thing a person can point
  at, after the fact, without having been in the room.
- **Projects that change hands.** A new lead, a new team, an audit, a handover. The graph
  is what you read instead of interviewing people who have gone: the decisions, under what
  they came out of, each pointing at the code it explains — and a way to propose an edit
  the same afternoon you found the problem.
- **Anyone who wants a second brain.** Without a codebase attached it is a note-taking
  app: a graph of your own thinking, with addresses, tags and a canvas. MIT licensed, and
  your notes are files on your disk.

## What it does

### The notes are files, beside the code

A project's graph is a `.sloppy/` folder in the repository: one markdown file per note,
front matter carrying what it sprang from, its address and its tags. Nothing is locked in
a database somewhere — `grep` works, `git log` works, a pull request shows a decision
changing. `.sloppy/AGENT.md` is the format written out for whatever assistant you set to
work, so an agent with no Sloppy installed still writes notes the app and the next person
read the same way.

A note points at the code it explains, and the app says when that code has moved since its
author last read it — the mark on the canvas carries a dot, and the note is the place to
write down whether it still holds.

### Context-aware chat, one per project

![The outline reading, a note's compass and what it proposes](docs/images/reading-the-outline.jpg)

The assistant works **inside the graph it is talking about**. Each project keeps its own
threads; each thread keeps its own draft and its own context, and the dock tells you how
full that context is and what it has cost as you go. You choose the notes a thread reads
rather than pasting them, and what the assistant writes comes back as notes you review
before they land — in a working copy of your folder, merged when you say so, never written
over your files behind your back.

So the chat is not a side channel. What went in is a set of notes anybody can open, and
what came out is a change anybody can read — which is the difference between using AI on a
project and being able to account for it afterwards.

### What an agent is actually given

A chat or a build hands the assistant a small endpoint of Sloppy's own — MCP, on the
loopback, named `sloppy` — and the acts it serves are in the vocabulary of the graph
rather than of the filesystem. That is the whole trick: an agent that can only see files
has to rediscover what the project means every time, while one that can ask the graph gets
the answer somebody already wrote.

**Three acts for reading**, and they are what a session spends its first context on:

| Act            | What it answers                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `list_notes`   | Every note this project has: its ref, title, address, tags, what it springs out of, **and the places in the code it is about**. |
| `search_notes` | The notes carrying some words, with the writing around what matched.                                                            |
| `read_note`    | One note whole — its sections as markdown, its tags, the code it points at.                                                     |

**Both directions are open, which is the point.** A note carries `code:` anchors — a path,
and a run of lines or the name of a symbol inside it — so the same index answers _"what is
this file for?"_ with the note that says so, and _"where does this decision live?"_ with the
lines. An agent arriving at an unfamiliar system reads the intent in English and then goes
straight to the code it is about, instead of inferring a project's purpose from its syntax.
A person does the same from the other end: the note on the canvas carries the file, and the
file's note is one search away.

**Eight more for writing**, and the agent is held to the same rules a person is:
`write_note`, `move_note`, `tag_note`, `number_note`, `link_notes`, `style_edge`,
`style_note`, `delete_note`. The rules ride in the tools' own descriptions, so an agent
reads them before it can call anything:

- **Search before you write.** Where the graph already says a thing, it is cited —
  `[what it is called](sloppy:<ref>)` — not written a second time. This is what stops a
  graph degenerating into forty summaries of the same decision.
- **A reason goes down only from a source you name** — the person's words, a commit, a
  comment, a document in the repository. Where nothing says _why_, the open question goes
  down instead of a guess. An assistant inventing a plausible rationale is the failure mode
  this rule exists for.
- **A relation between two notes goes on the line between them**, not into prose about it,
  and what a line means is written on the line.
- **Answers are bounded.** A long listing says how much of itself it left; a long note says
  how many sections it left. A note is never too long to read, only too long to hand over
  whole — so one act cannot swallow a session's context.

A build adds four more — `plan_build`, `raise_need`, `hand_off`, `review_build` — and
**which acts a session may call is decided by its role**: the one that reads the notes and
plans cannot write code, no role may start sub-agents of its own, and none of them can
reach outside the copy they are working in. Sloppy is the orchestrator, which
is what keeps every context small and every step something you can look at.

The endpoint speaks plain MCP, so an agent you drive yourself can use the same acts.

### Build for me

On a graph pointed at a codebase, pick the notes that say what a piece of the project is
for and press **Build this**. Sloppy then runs the work itself rather than handing one
agent a prompt and hoping:

1. **It reads first, and says what is missing.** A session reads the notes you chose and
   answers with a plan — the tasks, the exact notes each one needs, and the **questions**:
   what the notes do not say that the work has to know, and where two notes disagree with
   each other or with the code. **The agent is expected to dispute the documentation**, and
   the questions stand in front of you as a card.
2. **You answer by writing.** An answer is a note in your own words, under the feature
   where it belongs. The intent gets better because somebody asked a precise question
   about it, and the answer stays after the build is over.
3. **It builds on a line of its own.** One fresh session per task, each given the smallest
   context that can do the work — its notes whole, nothing else of the graph — so no
   session runs degraded and none of them touches your folder. A session that fills up
   hands off to a fresh one instead of quietly getting worse.
4. **It reviews what it wrote**, against the notes rather than against taste, and a
   blocking finding goes back to a fresh session.
5. **You are shown the result and the merges.** What was built, which files, what the
   checks said, what notes were written, what was left undone — and the one question that
   is yours: bring it in, or not. Work on that version first if you want to run it.

Nothing lands on a timer. A task the review cannot settle is marked contested and waits
for you, and the line the build worked on is a real branch you can check out, run, or
throw away.

### Three readings, and when each one earns its keep

![The sets reading, tags drawn as overlapping places with the notes standing in them](docs/images/reading-the-sets.jpg)

The same notes, three ways. Nothing is hidden in any of them, and the one you want depends
on the question you arrived with.

- **Graph — _"how did this come to be?"_** Every note placed by what it sprang out of, so a
  line of thinking is a shape rather than a list. This is the one to open when you are new
  to a project or coming back to it cold: the trunk is what the system is, the long branches
  are where the thinking went deep, and a proposal hanging off a decision is visibly a
  child of it. A subtree folds into one mark and opens on a tap, so a thousand notes is
  still something you can take in. It is also where you see what nothing hangs off —
  an orphan is a decision nobody has built on yet.
- **Outline — _"let me work."_** The same tree as rows, with a note's interior opening in
  place. Reach for it when you already know roughly where you are going: reading several
  notes in order, writing a run of them, checking the shape of a branch. It is the faster
  surface for keyboard work and the one that reads best on a narrow screen.
- **Sets — _"what belongs together?"_** The tags drawn as overlapping places, each note
  standing where it belongs. Open it when the question cuts across the lineage rather than
  down it. A note's lineage says where it came from; its tags say what it is _about_, and
  the two rarely agree — work on one concern is scattered across a dozen branches, and a
  single branch touches several concerns. This is the reading that makes that visible: a
  whole concern at a glance however far apart its notes were written, what two concerns
  have in common sitting in the overlap between them, and the notes carrying no tag at all
  standing outside everything — findable by no question anybody asks. Tagging is physical
  here too: drag a mark into a place and it carries that tag.

Across all three, **a mark wears a band per set it is in** — so which tags a note carries
is readable from the mark itself, before you have asked anything, and the rail beside the
canvas is the legend. Selecting tags highlights what carries them and dims the rest, so
the shape of the graph survives the question instead of being filtered away.

Every note also carries a **compass** — _part of, made of, like, instead of_ — the four
questions that place an idea against the ideas around it. "Instead of" is where a
rejected option goes, which is the half of a decision most projects lose.

**The structure is the knowledge, and both kinds of reader get the same one.** A pile of
notes answers _"what did we say about this?"_. A shaped one answers the questions a pile
cannot: what did this come out of, what got built on top of it — so what breaks if it turns
out to be wrong — what else is about the same concern though it was written a year later by
somebody else, and what was weighed and rejected on the way.

For a person that is how you judge weight before reading a word: a note with twenty
descendants is load-bearing, one with none was a thought nobody used, and a concern whose
notes are scattered across every branch is one the project has never looked at whole.

For an assistant it is retrieval that does not rest on a guess. Similarity search returns
what _reads_ alike; a graph returns what somebody _said_ was related — the parent, the run
of siblings, the set — which is a different and better answer exactly where the words differ
but the subject does not. It is also a context you can hand over whole and point at
afterwards: "this note, what it sprang from, and the four it cites" is something a person
can check, where "the twenty passages that scored highest" is not.

And because it is one structure rather than two, a person and an assistant arguing about a
decision are arguing about the decision — not about what each of them happened to be
looking at.

### Versions, lines and proposing an edit

A graph pointed at a codebase keeps that repository's own history, read in the column
beside the notes. Standing on an earlier version is a real checkout you can write from, not
a read-only view: open the project as it was a release ago, write what you found, and that
becomes a line. Bringing a line in is a merge — notes settled note by note, a conflict in
the code refused with words rather than guessed at.

This is the path for somebody who has just inherited a system: read the graph, find the
decision that no longer holds, write the correction where you are standing, and hand back a
line somebody can review.

### Who wrote it, and who vouched for it

A graph is only worth trusting if you can tell where a claim came from. Three things carry
that, and none of them needs a company in the middle:

- **Every note names its authors** — everyone whose writing it carries, in the order they
  first wrote into it. A note may also have an **owner**, and then somebody else's writing
  does not simply land: it is _offered_, and the owner takes it in whole or turns it down.
  That is the same rule for a person and for an assistant.
- **Versions are signed on the way in**, with SSH or OpenPGP, by the key the app keeps for
  you or one you already use. Who a project accepts signatures from is a list in the
  repository itself (`.sloppy/allowed_signers`), so the answer to _"is this really from
  them?"_ travels with the project and can be checked on any machine, offline, by anything
  that speaks git.
- **An identity is yours and portable.** Working on a folder, the keys are on your machine
  and never leave it. Hosted, Sloppy holds no private key at all: it verifies a chain back
  to a key that lives on your own devices, so the service is never the authority on who you
  are, and your profile and your writing move with you if you leave. (The identity layer is
  **syr**, which is its own open thing rather than a login to this app —
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) has the detail.)

**Decentralised and still accountable are not opposites.** The usual trade is: either a
company holds the accounts and can tell you who approved something, or nobody does and
anyone can claim anything. Signatures are the way out of that. Nothing central decides who
counts — the project carries its own list of whose word it takes, and a reader with a copy
can verify every entry in it without asking a server's permission. Ownership stops being a
row in somebody's database and becomes a fact about the writing itself.

**Where this is going**, and said plainly because it is not built yet: on a large project
the account of _why_ needs experienced eyes on it, so a note's reviewer will be able to
sign the note the way a version is signed today. The note then carries who approved it and
when, verifiable by anyone with the repository and nobody's say-so — which is what lets a
team hand its context to the next team and have that mean something.

### An address you can cite

A note's address — `1`, `1a`, `1a1`, `1b` — is the label a person cites it by, the way a
page number works inside a book. The Folgezettel rule offers one when you write a note
under another, so numbering is not work you do; it is yours to change or leave off, and an
address a note has ever carried keeps leading to it, so a citation somebody wrote down a
year ago still lands.

The same rule carries between people: because the shape is derived rather than drawn, a
subtree published from one graph is pulled into somebody else's and lands there looking the
way its author saw it, addresses intact.

**Where the method comes from.** The sociologist Niklas Luhmann kept a paper slip box of
about 90,000 notes between 1951 and 1996, each carrying a branching number that said what it
continued rather than what folder it lived in — a note written to follow `1` is `1a`, one
following that `1a1`, one written alongside `1b`. He called it _Folgezettel_, the note that
follows, and credited the box with most of what he published. The whole archive has been
digitised and is worth half an hour of anybody's time:

- [The Niklas Luhmann Archive](https://niklas-luhmann-archiv.de/) — his actual Zettelkasten,
  scanned, numbered and searchable.
- [Introduction to the Zettelkasten Method](https://zettelkasten.de/introduction/) — the
  clearest plain-English account of how and why it works.
- [The Money Is in the Hubs](https://zettelkasten.de/posts/zettelkasten-hubs/) — Johannes
  Schmidt, who worked on the archive, on what the structure actually did for Luhmann.
- Luhmann's own 1981 essay _Kommunikation mit Zettelkästen_ ("Communicating with Slip
  Boxes"), and Sönke Ahrens' _How to Take Smart Notes_ (2017) for the modern treatment.

Sloppy is that scheme with the tedious parts automated — the number is offered rather than
counted out by hand — and with the two things paper could not do: a canvas that draws the
branching, and a way for two people's boxes to be read by each other.

### Make it yours

A tool you look at all day should look the way you want. Sloppy's appearance is five
separate axes, and only one of them decides any colour:

- **The look** is every colour there is — the paper, the ink, the accent, and the graph's
  eight hue slots. Five of Sloppy's own, plus the whole [Tinted Theming](https://github.com/tinted-theming/schemes)
  collection vendored in: **571 schemes**, 361 base16 and 210 base24, 431 dark and 140
  light. Each one's graph hues are shaded on the fly until they clear Sloppy's contrast
  floors against every surface it draws on, so picking a pretty scheme never quietly costs
  you a readable canvas.
- **Faces** — Inter, Atkinson Hyperlegible, OpenDyslexic, your device's own, and four
  monospaced faces with ligatures (Fira Code, Cascadia Code, Victor Mono, Iosevka), set
  per role: the app, headings, and code and addresses. Or name any family installed on the
  machine.
- **Style** — how surfaces are drawn, never what colour they are: `default`, `hardline`,
  `bevel`, `terminal`, `pixel`.
- **Density** — comfortable or compact, or whatever the device is.
- **Screens** — grain, dots, hatch, glow and a CRT sweep, as many at once as you like, each
  with its own strength and scale, and a switch for whether they reach the whole page or
  gather at the edges. Entirely cosmetic, entirely optional, and off by default.

**A look is a file.** Everything above, plus a stylesheet of your own, exports as one JSON
document you can hand to somebody — and the CSS inside it cannot reach the network, so a
look from a stranger is a look and not a tracker.

**Emoji are yours too.** Each identity keeps its own catalog: upload your own, copy one you
liked from somebody else's, and they work in notes and reactions. A profile — name,
picture, the rest — comes from your identity rather than from a Sloppy account, so it is
the same you wherever your writing is read.

### Also at the command line

```bash
sloppy init     # start a graph beside this code
sloppy draft    # write a note from the terminal
sloppy check    # read the notes against the code and say what disagrees
```

## Why not Obsidian, Logseq or Notion

They are good tools, and if what you want is a personal wiki you should use one. Sloppy
exists because three things we needed are structural, not features anybody can bolt on.

**A graph everyone reads the same way.** Obsidian's graph view is decorative, and honestly
so: a mesh of backlinks has no agreed shape, so your graph and mine mean different things
and neither can be handed to the other. In Sloppy what a note sprang out of, and its order
among its siblings, are the protocol — every copy derives the same positions from them, so
a subtree published from one graph lands in somebody else's in the shape its author saw.
Notion solves this by imposing a tree, which means deciding the structure before the
thought exists. The genealogy is the third position: not containment, but _the direction a
thought grew in_.

**An address a decision can be cited by.** `1a1` is a label you can put in a commit
message, a ticket or an argument, and it still resolves after the note has been renamed and
moved. A wiki link that depends on a title breaks the day somebody improves the title.

**Notes that know about code, and an agent that knows about notes.** None of the three
carries an anchor into a file that tells you the code has moved since the note was written,
and none serves an assistant in the vocabulary of notes and refs rather than file paths.
What you can do instead is point an agent at a vault of markdown and hope it reads the
right file; what you get back is summaries written over each other,
no citations, and no way to tell afterwards what it had been given. The acts above are the
answer to that, and they are why the rest of the design holds: a graph only stays worth
reading if what writes into it is held to the same rules as the people who do.

Two smaller choices that follow from the same place:

- **A block is a section somebody added deliberately**, and Enter makes a paragraph inside
  it, never a new block. Logseq's outliner makes every line a node, which is a fine way to
  think and a poor way to read a decision six months later — a reorder handle means
  something when it moves sections, and nothing when it moves sentences.
- **Your notes are files you own.** Markdown with front matter, in the repository, under
  the same review as the code. No database holds them, no account is required to read them,
  and everything comes back out as one file whenever you ask.

## Where each part runs

|                                            | Desktop & mobile app                  | Web                  |
| ------------------------------------------ | ------------------------------------- | -------------------- |
| Notes, the three readings, tags, addresses | yes                                   | yes                  |
| A folder on your device as the graph       | yes                                   | opened, not uploaded |
| Version history, lines, merges             | yes                                   | —                    |
| Chat and **Build for me**                  | yes, with an assistant installed here | —                    |

The assistant wired end to end today is **Claude Code**, through Sloppy's own endpoint;
the contract is by role and tool set rather than by vendor, so another program agent is a
row in a table. Sloppy holds no key of yours, and a build never touches your own line or
your folder until you bring it in.

## Try it

It runs from a clone — `pnpm dev` brings up the whole stack in Docker, and the desktop
shell runs beside it. [`CONTRIBUTING.md`](CONTRIBUTING.md) is the setup, the tree and the
conventions; there is a seed command there that fills a graph with a few thousand notes,
because most of what the canvas does only shows at scale.

## Reading further

- Running it, what is in the tree, how to change it: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Product direction: [`PRODUCT.md`](PRODUCT.md) · Visual system: [`DESIGN.md`](DESIGN.md)
- Architecture, the syr split, the data model: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- The rules every change is held to: [`AI.md`](AI.md)
- The note format an assistant writes to: [`.sloppy/AGENT.md`](.sloppy/AGENT.md)

## Licence

MIT — see [`LICENSE`](LICENSE). The notes you write are markdown files on your disk; there
is nothing to export and nothing holding them.
