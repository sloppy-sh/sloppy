# Sloppy

**A second brain you can see the shape of.** Notes that know what they came out of, drawn
on a canvas — and, pointed at a codebase, the one account of a project that the people on
it and the AI working beside them both read from.

MIT licensed. Your notes are markdown files on your disk.

![The graph reading: a project's notes beside its code, with an assistant working in the same graph](docs/images/reading-the-graph.jpg)

## Where it came from

This started with reading. I kept notes on books and papers for years and they were close
to useless — not wrong, useless. A folder of summaries tells you what you thought about one
text on one day. It tells you nothing about what connects to what, and that is the only
part worth keeping. What I wanted was to **see** them: which notes belong together, which
grew out of which, and where three things I read in three different years turn out to be
the same argument.

So Sloppy is a Zettelkasten — [Niklas Luhmann's slip box](https://niklas-luhmann-archiv.de/),
90,000 notes that he credited with most of what he wrote — with the tedious part automated
and a canvas over the top. A note carries an address like `1a1` that says what it follows,
so a line of reading is a line you can walk and cite. Tags cut across that: the same note
can sit in three sets at once. And then you can actually look at it — three readings of the
same notes, each answering a different question.
([Introduction to the Zettelkasten Method](https://zettelkasten.de/introduction/) is the
best short explanation of why this works.)

|             |                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| **Graph**   | _"How did this come to be?"_ Every note placed by what it sprang from, so a line of thinking has a shape. |
| **Outline** | _"Let me work."_ The same tree as rows, interiors opening in place.                                       |
| **Sets**    | _"What belongs together?"_ Tags as overlapping places, each note standing where it belongs.               |

![The sets reading: tags drawn as overlapping places with the notes standing in them](docs/images/reading-the-sets.jpg)

**The structure is the knowledge.** A pile of notes answers _"what did I say about this?"_.
A shaped one answers what a pile cannot: what did this come out of, what got built on top
of it, what else is about the same thing though it was written years later, what was
considered and rejected. You can judge weight before reading a word — a note with twenty
descendants is load-bearing, one with none was a thought nobody used.

## Where it went

Then the same problem turned up at work, in a worse form. On a software project the
reasoning behind a system lives in people's heads, in a chat thread nobody can find, or in
a document that stopped being true a year ago — and now there is an assistant in the loop
too, working from whatever context somebody typed from memory, leaving no record of what it
was told.

Point Sloppy at a repository and the graph becomes that project's account of itself: the
decisions, under what they came out of, each pointing at the code it explains, as markdown
files committed beside that code. Both kinds of reader work from it.

- **Context drift stops being inevitable.** An assistant asks the graph instead of
  re-deriving the project from its syntax — and gets what somebody _said_ was related,
  rather than what merely reads alike.
- **Everything stays documented, because documenting is the work.** A note points at code;
  the app says when that code has moved since the note was last read against it.
- **One persistent source of truth for how something came to be**, held in the notes and in
  the repository's own history, which Sloppy reads: standing on an earlier version is a real
  checkout you can write from, and handing back a correction is a line somebody reviews.
- **Everyone is on the same page, literally the same one.** Not a prompt in a side channel —
  a graph both can open, cite and argue about.

![The outline reading: a note's compass and what it proposes](docs/images/reading-the-outline.jpg)

## Documentation-driven development

Which is the point of the whole thing: **write down what you want, exactly enough to build
from, and let the code grow out of it.** A note is not a record filed after the fact — it is
the intent the code is answerable to, so the check runs both ways.

That makes it a practical ethic for AI-accelerated development rather than a slogan. If a
machine is going to write a large share of your code, the honest question is not whether it
wrote good code, but **what it was told, what it wrote, and whether the result matches what
the note said the thing was for** — four things a person should be able to point at
afterwards. Sloppy's answer is to keep all four in the open: context is a set of notes you
chose, writes come back as a change you review, and the agent is held to the same rules as
the people — cite what the graph already says, give a reason only from a source you name,
and where nothing says why, write the open question down instead of inventing one.

**Build for me** is that taken to its end: pick the notes saying what a piece of the project
is for, and Sloppy runs the work — a session that reads them first and **disputes what is
missing**, questions you answer by writing, implementers on a line of their own, a review
against the notes, and the merges shown to you at the end. Nothing lands on a timer.

## What else is in it

Custom emoji, a signed history, five axes of appearance (571 colour schemes, faces with
ligatures, screen effects you can turn up or off) and a look you can export as one file and
hand to somebody. Notes carry their authors, versions are signed, and who a project takes a
signature from is a list the repository itself carries — so "is this really from them?" is
answerable offline by anyone with a copy.

## Try it

It runs from a clone. [`CONTRIBUTING.md`](CONTRIBUTING.md) has the setup, the tree and the
conventions.

- The graph of this project, written in Sloppy: [`.sloppy/`](.sloppy) — and the note format
  anything can write to, [`.sloppy/AGENT.md`](.sloppy/AGENT.md)
- Product direction: [`PRODUCT.md`](PRODUCT.md) · Visual system: [`DESIGN.md`](DESIGN.md)
- Architecture and the data model: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- The rules every change is held to: [`AI.md`](AI.md)

## Licence

MIT — see [`LICENSE`](LICENSE).
