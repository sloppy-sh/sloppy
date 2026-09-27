// `.sloppy/AGENT.md`, written wherever a project's notes are reached — the file
// an agent working in somebody's project finds where it already looks.
// docs/ARCHITECTURE.md § "Tooling and the review".

import {
  COMPASS_DIRECTIONS,
  COMPASS_KINDS,
  compassMethod,
  DEFAULT_COMPASS_KIND,
  NOTE_TEMPLATES,
  type TemplateSection,
} from "@sloppy/types";

/** What it is called inside the container. */
export const AGENT_FILE = "AGENT.md";

function opened(section: TemplateSection): string {
  if (section.opens === "drawing") return " (a drawing)";
  return section.opens === "compass" ? " (a compass)" : "";
}

/** Each method a compass can be read in, in the words the app asks its slots
 *  for, so this file and the app cannot come to teach different ones. */
const METHODS = COMPASS_KINDS.map((kind) => {
  const method = compassMethod(kind);
  const says = kind === DEFAULT_COMPASS_KIND ? "no `kind`" : `\`${kind}\``;
  const slots = COMPASS_DIRECTIONS.map((direction) => {
    const { word, asks } = method.slots[direction];
    return `  - ${direction} is **${word}** — ${asks}`;
  }).join("\n");
  return `- **${method.name}**, written with ${says}:\n${slots}`;
}).join("\n");

/** The shapes the app starts a note from, as their headings in order. */
const SHAPES = NOTE_TEMPLATES.map(
  (shape) =>
    `- **${shape.name}** — ${shape.sections
      .map((section) => `${section.heading}${opened(section)}`)
      .join("; ")}`,
).join("\n");

/** The file's whole text, ending in a newline. */
export const AGENT_MD = `# Writing notes in this project

The notes in this folder are a Sloppy graph kept beside the code it is about. They are
ordinary markdown files: anything can read them, and what follows is what it takes to
write one that the app, the other people here and the next agent all read the same way.

**Everything a person can write in a note, you can write, and everything you write, a
person can read and change.** There is no shape here that is yours and not theirs, and
none that is theirs and not yours — which is why what follows is the whole format rather
than a subset of it. What separates you from them is not what you may write but what is
yours to say, and "Changing a note somebody already wrote" and "Never write" below are
that line.

## One note is one file

\`notes/<ULID>.md\`, opening with front matter fenced by \`---\`:

    ---
    ref: did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE/01JQ7X3K9M2N4P5R6S7T8V9W0X
    parent: did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE/01JQ7X3K9M2N4P5R6S7T8V9W1Y
    title: What the markdown reader does
    tags:
      - parsing
    links:
      - did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE/01JQ7X3K9M2N4P5R6S7T8V9W2Z
    created: 2026-09-18T10:00:00.000Z
    updated: 2026-09-18T10:00:00.000Z
    checked: 9f1c0f2e4b6a8d0c2e4f6a8b0d2c4e6f8a0b2c4d
    ---

\`ref\` is the note, and the only thing that identifies it: it is what every link holds
and what a reader elsewhere resolves. \`parent\` is what the note sprang out of — leave it
off on a note that starts a line of thought of its own. \`title\` is the one line a mark on
the canvas is read by. \`links\` are lines somebody drew between this note and another by
hand; naming a note in the writing already draws one, so a \`links\` entry is for a
connection the writing does not make.

There is no \`address\` above, and you never write one: a number like \`1a1\` is the label its
author cites the note by, theirs to give and theirs to change. A note may carry other
fields — whose writing it carries, the numbers it has been at, who may write in it, how
its author asked the mark and its lines to be drawn. Those are the app's to write and the
author's to change: leave every one of them exactly as you found it. Drawing a line between
two notes is yours to do — that is what \`links\` above is — and saying what the line MEANS
is not: a label like "grew out of", an arrowhead, a stroke are somebody's own reading of the
connection, so an \`edges\` entry stays exactly as you found it too. An \`authors\` line is
the one to be most careful with: where it is missing the note carries its own author's
writing and nobody else's, so dropping one that names two people takes somebody's name
off writing they did.

## A note is a stack of sections

\`<!-- block <ULID> -->\` opens a section; everything under it until the next opener is
that section's writing, in markdown. A section is one somebody added on purpose, so a
new thought is a new section and a new sentence is not: write the paragraphs, the lists
and the code of one thought into one section.

## What a section can hold

Ordinary markdown, read strictly. Headings \`## \` through \`###### \`, paragraphs, \`***\` for
a rule, \`> \` for a quotation, \`- \` and \`1. \` for lists, \`- [ ] \` and \`- [x] \` for a list of
things to do, and a fence for code:

    ## What it does

    It reads a file and hands back the sections, in order.

    - [x] the reader
    - [ ] the writer

    \`\`\`ts
    const note = fromMarkdown(text, sidecars);
    \`\`\`

Inside a line: \`**bold**\`, \`_italic_\`, \`~~struck~~\`, \`code\`, \`[a link](https://example.com)\`,
\`$e^{i\\pi}$\` for arithmetic and a \`$$\` fence for a line of it on its own, and \`:wave:\` for
an emoji this graph already knows — \`::wave::\`, doubled, is the same one drawn large. A
\`mermaid\` fence is a diagram and is drawn as one.

A backslash at the end of a line breaks the line without ending the paragraph. A comment
reading \`<!-- sloppy:node … -->\` or \`<!-- sloppy:span … -->\` is something markdown has no
syntax for, written as its own JSON: leave those exactly as they are, whether or not you
recognise what is in them.

## Naming another note

\`[what it is called](sloppy:<ref>)\` inside a sentence. That is a citation: the canvas
draws a line for it, and the note at the other end is reachable from this one. A link to
anywhere else on the web is an ordinary markdown link and stays one.

## Write it once

Before you write anything down, look for it. These notes are one graph, and a fact it
already carries is **cited** — \`[what it is called](sloppy:<ref>)\` — never written a second
time. Two notes saying the same thing come apart as the code moves, and the next reader is
left guessing which of them is still true.

Keeping them true as the code changes is the same work, and it stops at the same line.
Neither of these goes as an offer — where a note hangs and which tags it carries are its
author's — so both are for a note you wrote where there was none, and on anybody else's you
write down what you found and leave the change to them.

- **Take a tag off where it has stopped being true of the note.** A tag that names a system
  the note is no longer about picks out the wrong set for everyone who selects it.
- **Move a note that carries no number, where what it sprang out of turns out to be
  something else.** That is its \`parent\`, and everything that sprang from the note goes
  with it. **A note that carries one is not yours to move.** The number it would take next
  is worked out from the run it joins, and the number it leaves has to go on reaching it —
  neither of which happens in a file somebody edits by hand. Write down what you found and
  leave that move to its author.

## Pointing at code

A link whose target starts \`code:\` points into this project, by a path from the project
root:

    [the markdown reader](code:packages/ts/vault/src/markdown.ts)
    [how a section is read](code:packages/ts/vault/src/markdown.ts#L120-L180)
    [fromMarkdown](code:packages/ts/vault/src/markdown.ts#fromMarkdown)

A name after \`#\` is found by searching that file for it; a run of lines is \`#L12\` or
\`#L12-L20\`; nothing after the path is the whole file.

## The compass

Four slots inside a section, written as a line per direction, each naming notes by ref.
Write it in a section of its own or under the writing it belongs to — it is an element
like a list or a picture, and a section can hold one along with everything else:

    north: [[did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE/01JQ8B4D5F6G7H8J9K0M1N2P3Q]]
    south: [[did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE/01JQ8B4D5F6G7H8J9K0M1N2P4R]] [[did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE/01JQ8B4D5F6G7H8J9K0M1N2P5S]]
    east: [[did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE/01JQ8B4D5F6G7H8J9K0M1N2P6T]]
    west: [[did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE/01JQ8B4D5F6G7H8J9K0M1N2P7V]]

A direction with nothing in it is left out altogether. Filling one is citing the note it
names, exactly as naming that note in a sentence is. What the four directions ASK is the
method the note is read in, and there are three of them.

## The three methods

The four tokens are the same in all three, and \`kind\` is what says which:

${METHODS}

A compass in a method other than the idea compass cannot be written as lines — a \`kind:\`
line would cut it in two for a reader that does not expect one — so it goes as its JSON:

    <!-- sloppy:node {"type":"compass","attrs":{"north":[{"note":"did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE/01JQ8B4D5F6G7H8J9K0M1N2P3Q"}],"south":[],"east":[],"west":[],"kind":"inquiry"}} -->

Which method a note is read by is its author's choice. Where one already says, keep it;
where none does, write the lines.

## Tags

A plain word on the note, lowercased, and nothing declares one first: \`parsing\`,
\`protocol\`, \`question\`. They classify across the whole graph rather than down it, so
reach for the words this graph already carries before adding one nobody here uses. A tag
is somebody's own vocabulary, and a note carries as many as it needs.

**A tag names what the note is ABOUT** — the system, the layer, the scope — which is what
makes selecting one pick out everything about that system however far apart those notes
sit. That is the whole use of the axis, and naming the systems you find as you read them
is work only somebody reading the code can do. **A tag that records how the note came to
be written is the opposite of one**, and never goes on: see below.

## Saying a note has been read against the code

\`checked\` names the commit a note's reasoning was last read against. **Absent means
nobody has read it yet**, which is never the same as out of date — the app asks about a
note whose code has moved SINCE it was read, and says nothing about one nobody has got to.
It is a person saying they read it, so it is not yours to write: see below.

## The shapes a note can start from

The app offers these when somebody starts a note. A shape is its headings, with an empty
drawing or an empty compass under the ones marked below — no marker, no tag, nothing
stored anywhere that says a note is in one. A note already in one of them keeps its
headings, and a note you write is welcome to any of them where the shape fits what you
found:

${SHAPES}

A **Decision** is the one shape the app reads back: a compass and a section headed "Why"
together are what make a note one. So never write that pair — see below.

## Pictures and drawings

\`![what it shows](media/<id>.png)\` is a picture somebody added, and
\`![what it shows](.sloppy/ink/<name>.svg)\` is something they drew by hand; the drawing
itself is a file beside the note. Both are theirs. Move one within a note if the writing
around it moves, and otherwise leave the line, the file and the folder alone: a redrawn
path is a drawing thrown away, and nothing gives it back.

## Changing a note somebody already wrote

Don't write over it. \`sloppy draft\` writes straight onto a note only where the note
carries nobody's writing but its own; on any note a person has written in — alone or
beside it — it writes your version as an offer, and the note's author takes it in or does
not. A note you write where there was none is yours to write outright.

**Where the app asked you for this rather than a person at a terminal, write no file at
all**: hand your writing back to whatever asked for it, and that rule is applied on that
side. A tool that writes into \`notes/\` itself is held to none of this, and what it lands
on is somebody's writing nothing can give back.

## Never write

- **A "west", and never a "Why".** What was decided against, and the reason for it, are
  the author's own thinking, and an agent that supplies one puts words in their mouth.
  Write what you found as candidates, under a "Candidates" heading in the note's own
  writing, and leave the compass to a person.
- **\`checked\`.** It says a person has read the note against the code. Writing it would
  silence the one question the app asks them.
- **A tag about the note rather than about the code** — that a tool wrote it, when, or in
  what pass. What wrote a note leaves no trace of itself in it; the note is read for what
  it says, and a tag naming the system it is about is wanted for exactly that reason.
- **A second note about a file that already has one.** Offer a change to the note that
  is there instead.
- **Anything in the code.** Sloppy reads this project and never writes in it; the only
  files to write are the ones in this folder.
- **A \`ref\` twice, or a new one on a note that has one.** A ref is the note for as long
  as it exists, and somebody's link elsewhere is holding it.

## Commands

    sloppy init [dir]      start the notes in a project, and write what the tree can tell
    sloppy draft [paths…]  a note in detail per file named, never over somebody's writing
    sloppy draft --tag a,b [paths…]  the same, tagging each note it writes
    sloppy review          what the code has left behind
    sloppy check           read every note and say what doesn't hold

Each takes \`--json\` and answers in JSON instead of lines.

\`draft\` reads a TypeScript or JavaScript file by the line for what it imports and what
it hands out, and anchors each name it finds. A file in any other language gets an anchor
to the file and none inside it, so the names in it are yours to write.

\`--tag\` puts those tags on every note that run writes, beside the ones each already
carries; it takes none off. Name the system the files are part of, so one run tags one
scope.
`;
