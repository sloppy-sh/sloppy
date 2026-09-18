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
    ref: did:syr:z6Mk.../01JABCDEF0123456789ABCDEF
    parent: did:syr:z6Mk.../01JZZZZZZZZZZZZZZZZZZZZZZZ
    address: 1a1
    title: What the markdown reader does
    tags:
      - walkthrough
    links:
      - did:syr:z6Mk.../01JYYYYYYYYYYYYYYYYYYYYYYY
    created: 2026-09-18T10:00:00.000Z
    updated: 2026-09-18T10:00:00.000Z
    checked: 9f1c0f2e4b6a8d0c2e4f6a8b0d2c4e6f8a0b2c4d
    ---

\`ref\` is the note, and the only thing that identifies it: it is what every link holds
and what a reader elsewhere resolves. \`parent\` is what the note sprang out of — leave it
off on a note that starts a line of thought of its own. \`address\` is a label a person
cites the note by, and a note is allowed to have none: write one only where you are
starting the numbering off a parent that has one, and never change the numbers on notes
around it. \`checked\` names the commit the note's reasoning was last read against, and is
written by the person who read it.

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

A section of its own, one line per direction, each naming notes by ref:

    north: [[did:syr:z6Mk.../01JAAAAAAAAAAAAAAAAAAAAAAA]]
    south: [[did:syr:z6Mk.../01JBBBBBBBBBBBBBBBBBBBBBBB]] [[did:syr:z6Mk.../01JCCCCCCCCCCCCCCCCCCCCCCC]]
    east: [[did:syr:z6Mk.../01JDDDDDDDDDDDDDDDDDDDDDDD]]
    west: [[did:syr:z6Mk.../01JEEEEEEEEEEEEEEEEEEEEEEE]]

North is the larger thing this is part of, south what it is made of, east what it is
like, west what was chosen instead. A direction with nothing in it is left out
altogether. Filling one is citing the note it names, exactly as naming that note in a
sentence is.

## Changing a note somebody already wrote

Don't write over it. \`sloppy draft\` writes your version as an offer, and whoever keeps
the note takes it in or does not. A note you write where there was none is yours to
write outright.

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
    sloppy draft [paths…]  a note in detail per file named, written as an offer
    sloppy review          what the code has left behind
    sloppy check           read every note and say what doesn't hold

Each takes \`--json\` and answers in JSON instead of lines.
`;
