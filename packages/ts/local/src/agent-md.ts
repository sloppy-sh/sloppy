// `.sloppy/AGENT.md`, written wherever a project's notes are reached — the file
// an agent working in somebody's project finds where it already looks.
// docs/ARCHITECTURE.md § "Tooling".

import { decodeText, encodeText } from "@sloppy/vault";
import type { Files } from "./files.js";
import {
  type ChatPlace,
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

The notes in this folder are a Sloppy graph kept beside the code it is about: one account
of what this project is meant to be and why it is the way it is, held by the people here
and by whatever they set to work beside them. They are ordinary markdown files: anything can read them, and what
follows is what it takes to write one that the app, the other people here and the next
agent all read the same way.

**What goes down here is a decision and the reason for it**, under what it sprang out of,
tagged with the system it is about, and pointing at the code it explains — a graph somebody
moves around in, not a pile of summaries. Asked why something is the way it is, look here
before answering; told why, write it down here. Asked whether a piece of the code is doing
what it was written to do, read the note for what the thing is FOR and the code for what it
does, and put what agrees and what does not into the note, where the next reader finds it.

**A note may come before the code it is about, and often should.** What is written here is
the intent the code is answerable to, not a record filed once the work is done — so
something decided and not yet built belongs here now, said exactly enough to build from.
Asked to build, look first for the note saying what the thing is for and build from that.
Where no note says it, ask for one, or write down what you were told and cite who told you.
A note whose code does not exist yet is not an unfinished note.

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
    address: 1a1
    title: What the markdown reader does
    tags:
      - parsing
    links:
      - did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE/01JQ7X3K9M2N4P5R6S7T8V9W2Z
    edges:
      - to: did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE/01JQ7X3K9M2N4P5R6S7T8V9W2Z
        label: grew out of
        direction: to
        stroke: dashed
    appearance:
      ring_weight: heavy
      ring_style: dashed
      mark_radius: large
    created: 2026-09-18T10:00:00.000Z
    updated: 2026-09-18T10:00:00.000Z
    checked: 9f1c0f2e4b6a8d0c2e4f6a8b0d2c4e6f8a0b2c4d
    read_against:
      - path: src/markdown/reader.ts
        digest: sha256:2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae
    ---

\`ref\` is the note, and the only thing that identifies it: it is what every link holds
and what a reader elsewhere resolves. \`parent\` is what the note sprang out of — leave it
off on a note that starts a line of thought of its own. \`title\` is the one line a mark on
the canvas is read by. \`links\` are lines somebody drew between this note and another by
hand; naming a note in the writing already draws one, so a \`links\` entry is for a
connection the writing does not make.

\`address\` is the number a person cites the note by. **Write one on a note you write**: it
springs from the number of the note above it, takes the next letter or number free in the
run it joins, and no other note in this graph may be at it — leave it off where the note
above carries none. **A number on a note already there is not yours to change**: the one it
gives up has to go on leading to it, which does not happen in a file edited by hand. Write
down what you found and leave that to its author.

\`edges\` says what a line MEANS — the words on it, which end the arrowhead sits at, how
broken it is drawn — and \`appearance\` says how the mark itself is drawn. Both are yours on
a note you wrote and stay exactly as you found them on anybody else's. A look draws on a
line that is already there and nothing where there is none, so an \`edges\` entry names a
note this one is already joined to.

A note may carry other fields — whose writing it carries, the numbers it has been at, who
may write in it. Those are the app's to write and the author's to change: leave every one
of them exactly as you found it. An \`authors\` line is the one to be most careful with:
where it is missing the note carries its own author's writing and nobody else's, so
dropping one that names two people takes somebody's name off writing they did.

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

**Read as an idea, west is what was decided against, and it goes down only from a source
you name in the note** — what somebody said here, a commit message, a comment, a document in this project.
Cite it in the note's writing, so the next reader can go and read it. Where you find none,
the slot stays empty and what you could not settle goes under a "Candidates" heading in the
note's own writing: an open question is worth keeping, and a reason nobody gave is not.

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

## How a mark is drawn

Most of a mark is the canvas's own and nobody's to set: how deep the note sits, whose
graph it is in, where it stands and how far it stands from what it sprang out of.
\`appearance\` is the part its author says, it draws inside the mark, and it moves nothing.

**Colour is not among the things it says.** A look carries none at any level, and nothing
you write puts colour on the canvas: colour arrives when the reader selects tags and means
the notes that carry them. So a tag has no look to give it — it is a plain word — and
**putting the right words on the right notes is the whole of what you can do for that
channel**. Tag every note with the system it is about, and a reader selecting that system
lights every note about it, however far apart they sit.

Three channels are left, and each says one thing:

- **\`ring_weight\`** — the ring the mark wears inside its own edge: \`none\`, \`hairline\`,
  \`regular\`, \`heavy\`. \`none\` is what a note nobody styled draws, and is not itself a look.
- **\`ring_style\`** — how much of that ring is missing: \`solid\` is whole, \`open\` has a gap,
  \`notched\` a few, \`dashed\` is ticked all the way round. **A broken ring reads as a draft**,
  and a style says nothing at all on a mark wearing no ring.
- **\`mark_radius\`** — \`small\`, \`regular\`, \`large\`, \`huge\`, \`giant\`. A mark is already as
  big as the thought folded under it and this multiplies that, so it is how an author says
  **this one matters**.

A look is read against the marks carrying none, and it is the first thing the canvas drops
as marks get small. A ring on every note therefore says what a ring on none says, and a
graph nobody drew at all leaves the reader nowhere to start. Spend them, and spend them on
few notes.

**A convention for documenting runs.** What those three channels MEAN is above and is
Sloppy's. What a run over somebody's code should SPEND them on is written nowhere else, so
it is written here, so that one run's graph reads like the next one's:

- **Size is how much of the project a note answers for.** \`large\` on the note a whole
  system hangs under — the notes about its parts spring out of it, and a fold's size and
  its author's multiply, so that is the mark somebody finds from across the field.
  \`regular\`, which is nothing written at all, on the ordinary note about one part.
  \`small\` on a detail nobody reads until they are already inside. Leave \`huge\` and
  \`giant\` to a person: every mark a run grows is one they did not.
- **A ring is for a note you could not finish reading.** Most get none. Where something is
  open — a path you could not follow, a name you guessed at, a "Candidates" list still
  standing — wear one, and how broken it is says how much: \`open\` for one thing, \`notched\`
  for several, \`dashed\` for a note that is still a stub. The weight is how loudly: \`heavy\`
  where nobody should build on the note before reading it again, \`hairline\` for one loose
  end.
- **Every note a run writes carries the system it is about.** A note with no tags is in no
  set, so it is a mark the reader's question can never reach, whatever else is drawn on it.

## Saying a note has been read against the code

Two fields say it, and both mean the same thing: somebody sat down with this note and
the code it points at, and found that it still held. \`checked\` names the commit they
read it at. \`read_against\` says the same thing one file at a time — each place the note
points at, and what that file said when they read it — so a folder that is not kept in a
history can answer the question too. Where a note carries \`read_against\`, that is what
the app reads; where it carries only \`checked\`, that is.

**Absent means nobody has read it yet**, which is never the same as out of date: the app
asks about a note whose code has moved SINCE it was read, and says nothing at all about
one nobody has got to. Both are a person saying they read it, so neither is yours to
write: see below.

## The shapes a note can start from

The app offers these when somebody starts a note. A shape is its headings, with an empty
drawing or an empty compass under the ones marked below — no marker, no tag, nothing
stored anywhere that says a note is in one. A note already in one of them keeps its
headings, and a note you write is welcome to any of them where the shape fits what you
found:

${SHAPES}

A **Decision** is the one shape the app reads back: a compass and a section headed "Why"
together are what make a note one. That pair is where a project's reasoning goes, so write
it wherever you have a source for it and never where you do not — see below.

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

- **A "west" or a "Why" you cannot name a source for.** What was decided against, and the
  reason for it, is somebody's thinking, and one you supply out of your own reading puts
  words in their mouth that no reader can tell from theirs. Write it from what you can
  name in the note — what somebody said here, a commit message, a comment, a document in
  this project — and cite that there. Where you found none, write what you found as
  candidates under a "Candidates" heading and leave the slot empty.
- **\`checked\`, and \`read_against\`.** Both say a person has read the note against the
  code. Writing either would silence the app's line about code that has moved under them,
  and neither is true of a file you read for them. Read a note against the code as often
  as you are asked to, and write what agrees and what does not into the note — saying it
  still holds is theirs.
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
    sloppy check           read every note and say what doesn't hold

Each takes \`--json\` and answers in JSON instead of lines.

\`draft\` reads a TypeScript or JavaScript file by the line for what it imports and what
it hands out, and anchors each name it finds. A file in any other language gets an anchor
to the file and none inside it, so the names in it are yours to write.

\`--tag\` puts those tags on every note that run writes, beside the ones each already
carries; it takes none off. Name the system the files are part of, so one run tags one
scope.
`;

/** What Sloppy signs the file with, so that next time it can tell its own copy
 *  from one somebody has made theirs. */
const SIGNED = "<!-- sloppy:agent ";

/**
 * A fingerprint of the text. It guards against nobody and is not meant to: it
 * answers one question, whether this file is still the one Sloppy wrote, and a
 * person who edits the file and puts the line back has said to leave it alone.
 */
function fingerprint(said: string): string {
  let hash = 0x811c9dc5;
  for (let at = 0; at < said.length; at++) {
    hash ^= said.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** `said` signed as Sloppy's own, which is what {@link agentFileIsOurs} reads
 *  back. The two are a pair: neither means anything without the other. */
export function signedAsOurs(said: string): string {
  return `${said}${SIGNED}${fingerprint(said)} -->\n`;
}

/** The file as Sloppy writes it today. */
export function agentFile(): string {
  return signedAsOurs(AGENT_MD);
}

/** Whether `held` is a copy Sloppy wrote and nobody has changed since. */
export function agentFileIsOurs(held: string): boolean {
  const lines = held.split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const signature = lines.pop();
  if (signature === undefined || !signature.startsWith(SIGNED)) return false;
  const said = signature.slice(SIGNED.length, -" -->".length);
  return said === fingerprint(`${lines.join("\n")}\n`);
}

/**
 * Keep the file Sloppy tells an agent to read before anything else current.
 *
 * **It is rewritten whenever Sloppy's own rules move**, because the file is the
 * whole of what an agent editing the notes by hand is held to: one frozen at
 * the version a container happened to be made at teaches rules this build no
 * longer keeps, and nothing else would ever correct it. A copy somebody has
 * changed is theirs and is left exactly as it is — the same bargain
 * {@link keepOut} keeps with a `.gitignore` somebody wrote.
 */
export async function keepAgentFile(container: Files): Promise<void> {
  const bytes = await container.read(AGENT_FILE);
  const held = bytes ? decodeText(bytes) : undefined;
  if (held !== undefined && !agentFileIsOurs(held)) return;
  const said = agentFile();
  if (held === said) return;
  await container.write(AGENT_FILE, encodeText(said));
}

/**
 * What the agent driving a chat is told before it hears anything from the
 * person — `--append-system-prompt`'s text.
 *
 * **Without it the agent does not know it is in Sloppy at all.** It answers in
 * prose, offers to write files it can never write, and leaves what it found in
 * a conversation nobody can cite. This says where it is, what its answer is
 * FOR, and what it cannot do; the format and the rules are {@link AGENT_MD},
 * which it reads rather than being handed, because that file is also what an
 * agent at a terminal reads and there is one copy of it.
 *
 * `places` are the other folders the thread may read. They are named here by
 * NAME and never by path, because the name is what a reading act takes.
 */
export function chatBrief(places: readonly ChatPlace[] = []): string {
  const named = places.map((place) => place.name).join(", ");
  return [
    "You are answering inside Sloppy, a knowledge graph. The notes for this project are a Sloppy graph in the .sloppy folder beside the code: the record of why this project is the way it is, read by the people here and by you.",
    "Asked why something is the way it is, look in the notes before you answer. Told why, write it down there — with what said so named in the note, and the open question written down instead where nothing did.",
    `Read .sloppy/${AGENT_FILE} before you write anything: it is the format the notes are written in and the rules you are held to here.`,
    "You have Sloppy's own acts for reading and writing those notes. **What you find belongs in a note, written with them** — not in a message. A message is for talking to the person; a note is what they and the next reader can cite, tag, place and come back to. Asked for something written down, write it down.",
    "Look before you write. Search the notes for what you are about to say: a fact this graph already carries is cited, never written a second time.",
    "You cannot write or change any file in this project, and you have no tool that could. Sloppy reads the project and never writes in it. Do not offer to, and do not ask for permission you cannot be given — the notes are where your writing goes.",
    "An act that writes lands on a draft of the notes; the person reads the whole draft and merges it once. So make the write, and never ask in prose whether you may.",
    ...(named === ""
      ? []
      : [
          `You may also read these places: ${named}. Their notes are reached by naming the place; nothing of yours is written there.`,
        ]),
  ].join("\n\n");
}
