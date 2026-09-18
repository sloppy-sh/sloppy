# Product

## Register

product

## Users

One person thinking, the people they let read over their shoulder, and the ones they let write beside them.

- **The thinker** — someone accumulating a body of thought over years: a researcher, a
  student, a writer, an engineer keeping a design journal. They want to put a half-formed
  idea down _now_, in the place it actually sprang from, without first deciding which
  folder it belongs in. They come back a year later and need the graph to have kept its
  shape. They keep a graph per body of thought where the bodies are genuinely separate —
  the thesis, the garden, the company — and each one numbers its own thinking from `1`.
  They may never publish a single node. A graph they keep on this device is theirs to keep
  on GitHub or GitLab as well, so what they have written is on more than one disk and moves
  between the machines they think on.
- **The peer** — someone who follows a thinker's DID and pulls a published subtree into
  their own graph as a foreign, read-only region. They read, they comment, they branch
  their own thinking off what they found. The pulled region keeps its original addresses
  and the graph they belong to, so they can cite one back and the author knows exactly
  which node they meant.
- **The contributor** — someone writing in a graph that is not theirs: a folder a colleague
  shared, a notebook two people keep together. They want to add a thought where it belongs
  and have the graph say it was theirs, without taking anything away from whoever keeps it.
  Where a note is open they write straight into it and join its authors. Where its owner has
  reserved it, their change is offered instead, and the owner takes it in or does not — so
  nobody has to choose between letting somebody write and keeping a note their own.
- **The annotator** — the same two people on a tablet with a pencil. They ink over the
  canvas to think spatially, and ink inside a node when a diagram is the note.
- **The maintainer** — someone keeping a codebase, writing down why it is the way it is next
  to the code itself: the notes live in the project, they point at the files and the names
  they are about, and they are saved in the same commit as the change that prompted them.
  They want to be told when the code under a piece of reasoning has moved since they last
  read it, and never to be nagged about the ones they have not got to. Their colleagues read
  the same notes out of the same repository, and a colleague who disagrees offers a change
  the way any contributor does. A note of theirs says what it is part of, what it is made
  of, what it is like and what was chosen instead, and what the code has left behind is
  something they ask the graph rather than something it tells them.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the hosted, self-hosted and
fully-local modes that serve all five.

## Product Purpose

Sloppy helps a person grow a body of thought whose **shape survives being read by
somebody else**. Every node's address derives from where the thought came from, by rules
that are the same on every peer, so a subtree collapses identically on your screen and
mine and a citation still resolves in ten years. An address is a label read inside one
graph, the way a page number is read inside a book — so it is short enough to say out
loud, and it says which graph it came from when it travels.

Success is when someone puts down a messy thought in four seconds and finds it two years
later by following the trail it grew out of — and when a stranger pulls that trail in and
it lands in a shape they can read.

It is a thinking tool that happens to be social, not a social network that happens to
hold notes.

## Brand Personality

Quiet, exacting, and unbothered. Ink on good paper. The name is the promise: **the input
is allowed to be sloppy, because the structure is what is rigorous.** Sloppy never asks
you to tidy up before you are allowed to write, and never congratulates you for writing.
It speaks plainly, shows the address, and gets out of the way. Dry rather than warm;
precise rather than clever. A good notebook does not have opinions about your handwriting.

## Anti-references

- **Notion-shaped page trees** — a hierarchy you must commit to before the thought
  exists, and a database schema decided by whoever made the template.
- **Obsidian's graph view as decoration** — a pretty hairball that means nothing to
  anyone but its owner, because no two people's graphs share a shape.
- **"Second brain" productivity-guru PKM** — systems sold as discipline, note-taking as
  self-improvement, the implication that you are behind on your own thoughts.
- **Social feeds and engagement metrics on thinking** — like counts, follower numbers as
  a scoreboard, anything that makes a half-formed idea feel like a post that underperformed.
- **"AI-made" sameness** — purple gradients, glassmorphism for its own sake, chrome that
  shows off instead of serving.

## Design Principles

1. **The graph is the protagonist.** The canvas gets the focus and the space; chrome
   recedes to the edges and disappears when there is nothing to do. Every element earns
   its pixels or it is removed.
2. **Sloppy in, structured out.** Capture is one gesture and demands nothing: no title, no
   folder, no tag, and no number either. An address is offered from where you were when
   you wrote. Structure is something the protocol supplies, never a tax charged at the
   door.
3. **An address is a label, and it keeps leading where it led.** It is shown wherever it
   helps somebody navigate or cite, and a note is allowed to have none — a note with no
   address is read by its title, and is a note like any other. A person writes, changes
   and removes their own; every address a note has carried still lands on it, and no other
   note is ever given one of them. An address is read inside a graph, so a surface showing
   notes from more than one says which — and one showing a single graph does not repeat
   it. A UI that implies `1a` means one thing everywhere, that a person cannot change
   their own, or that changing one renumbers the notes around it, is lying about the
   protocol.
4. **Pulled is never mistaken for yours.** A foreign region reads as foreign at a glance
   and at every zoom level, by more than colour. Whose thought this is, is never a
   question the reader has to work out.
5. **Publishing is a deliberate act, described truthfully.** Nothing leaves by default.
   What publishing exposes, and what it cannot take back once a peer has pulled it, is
   said plainly at the moment of the decision and nowhere else.
6. **Mobile and tablet first.** Every surface is designed at phone width and then given
   room. Desktop is the same product with more space, never the same product plus
   features the phone does not get.
7. **Legible before beautiful.** Ten thousand nodes that stay readable beat a hundred that
   look impressive. Level of detail and collapse exist so the canvas never draws more than
   a person can read; selecting tags answers a question inside what is drawn rather than
   by drawing something else.

## Accessibility & Inclusion

Target WCAG 2.2 AA as a floor.

- **The graph has a non-visual equal, not a fallback.** The canvas is drawn with WebGL, so
  it is invisible to a screen reader by construction. A DOM outline — addresses, titles,
  tags, parent and children, keyboard-navigable — is a first-class way to move through
  the graph, kept in step with the canvas and shipped alongside it. It is not a degraded
  mode; a sighted keyboard user should be able to prefer it.
- **Provenance and set membership are never carried by colour alone.** Own / published /
  pulled also carry a shape or an edge treatment. A selection is answered in hue, but a
  note carrying two selected tags draws in one of them, so which sets a note is in is
  always readable in words as well — the graph stays answerable to a person who cannot
  separate two hues, and to one who can but is looking at a note in three sets at once.
- Full keyboard operability, semantic landmarks, and AA contrast on every theme × accent
  pairing we ship. Hues drawn as marks — a node fill, an edge, a tag chip — owe the 3:1
  non-text floor and are measured against it, not eyeballed.
- **Ink degrades, it never gates.** Pointer-event features that only exist on newer
  WebKit (coalesced and predicted events) are feature-detected; a device without them
  draws a rougher line, not a disabled block. Nothing in the product requires a pencil.
- Respect `prefers-reduced-motion` and `prefers-color-scheme` (first visit only, until a
  preference is saved). Reduced motion means the layout settles to its final positions
  without animating — never that positions are left unsettled. A mark being dragged is the
  one thing the graph follows as it moves, and it settles the moment the mark is let go.
