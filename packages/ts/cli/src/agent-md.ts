// `.sloppy/AGENT.md`, as `sloppy init` writes it — the file an agent working in
// somebody's project finds where it already looks. docs/ARCHITECTURE.md
// § "Tooling and the review".

/** The file's whole text, ending in a newline. */
export const AGENT_MD = `# Writing notes in this project

The notes in this folder are a Sloppy graph kept beside the code it is about. They are
ordinary markdown files: anything can read them, and what follows is what it takes to
write one that the app, the other people here and the next agent all read the same way.

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
off on a note that starts a line of thought of its own. \`checked\` names the commit the
note's reasoning was last read against, and is written by the person who read it.

There is no \`address\` above, and you never write one: a number like \`1a1\` is the label its
author cites the note by, theirs to give and theirs to change.

## A note is a stack of sections

\`<!-- block <ULID> -->\` opens a section; everything under it until the next opener is
that section's writing, in markdown. A section is one somebody added on purpose, so a
new thought is a new section and a new sentence is not: write the paragraphs, the lists
and the code of one thought into one section.

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

North is the larger thing this is part of, south what it is made of, east what it is
like, west what was chosen instead. A direction with nothing in it is left out
altogether. Filling one is citing the note it names, exactly as naming that note in a
sentence is.

## Changing a note somebody already wrote

Don't write over it. \`sloppy draft\` writes straight onto a note only where the note
carries nobody's writing but its own; on any note a person has written in — alone or
beside it — it writes your version as an offer, and the note's author takes it in or does
not. A note you write where there was none is yours to write outright.

## Never write

- **A "west", and never a "Why".** What was decided against, and the reason for it, are
  the author's own thinking, and an agent that supplies one puts words in their mouth.
  Write what you found as candidates, under a "Candidates" heading in the note's own
  writing, and leave the compass to a person.
- **A second note about a file that already has one.** Offer a change to the note that
  is there instead.
- **Anything in the code.** Sloppy reads this project and never writes in it; the only
  files to write are the ones in this folder.
- **A \`ref\` twice, or a new one on a note that has one.** A ref is the note for as long
  as it exists, and somebody's link elsewhere is holding it.

## Commands

    sloppy init [dir]      start the notes in a project, and write what the tree can tell
    sloppy draft [paths…]  a note in detail per file named, never over somebody's writing
    sloppy review          what the code has left behind
    sloppy check           read every note and say what doesn't hold

Each takes \`--json\` and answers in JSON instead of lines.

\`draft\` reads a TypeScript or JavaScript file by the line for what it imports and what
it hands out, and anchors each name it finds. A file in any other language gets an anchor
to the file and none inside it, so the names in it are yours to write.
`;
