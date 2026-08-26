# Project Instructions

Common instructions for all AI agents and assistants working in this repository.
This file (`AI.md`) is the single source of truth; every agent-specific configuration
file (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `CONVENTIONS.md`, `.rules`,
`.cursorrules`, `.clinerules`, `.roorules`, `.windsurfrules`) is a symlink to it. If a
new tool wants its own filename, add another symlink — never a second copy.

## Project

**Sloppy** — a Zettelkasten-structured, socially-shareable knowledge graph.

Notion and Obsidian fail at the same thing from opposite ends. Notion imposes a tree:
pages inside pages, structure decided before the thought exists. Obsidian imposes
nothing: a flat mesh of backlinks where the graph view is decorative, because no two
people's graphs mean the same thing.

Sloppy takes a third position — **the shape of the graph is part of the protocol, not
a per-user accident.** Every node's position derives from rules everyone agrees on, so
one person's graph can be read, pulled and reasoned about by another. That agreement
is what makes the graph _social_ rather than merely shared.

Two orthogonal axes:

1. **The genealogical axis (Zettelkasten / Folgezettel).** Every node carries an
   address derived from its parent — `1`, `1a`, `1a1`, `1b`. This is not containment,
   it is _sequence of thought_: the direction a note springs out from its origin.
2. **The facet axis (multi-dimensional set classification).** Labels are typed
   dimensions (`domain:biology`, `status:seed`, `type:question`), not free tags. A node
   holds one value per dimension, so sets intersect _across_ the genealogical tree.

A subtree collapses into a **mega-node** that expands on tap. Label facets are
switchable **lenses** that re-cluster the same nodes along a chosen dimension. Node
interiors are block stacks, including **ink blocks** drawn with the Apple Pencil.

**Platform stance: mobile and tablet are the primary surface.** Desktop is the mobile
UI given more room, never the mobile UI minus features.

Domain: `sloppy.sh` · bundle id `sh.sloppy.app` · packages `@sloppy/*`.

## The Address Is the Protocol (required)

Everything else in Sloppy is an implementation detail that can be replaced. The
address cannot, because **a peer somewhere is holding it.** Once a subtree has been
published and pulled, its addresses are load-bearing on machines we do not control and
cannot migrate.

- **An address is assigned at creation and never changes.** Moving a node writes an
  alias; it never renumbers. Renumbering is not a refactor here, it is a broken link in
  somebody else's graph.
- **Assignment is deterministic, and determinism is proved, never asserted.** Two peers
  applying the same creation operations must produce byte-identical addresses. That is
  the protocol claim, so it ships as a property test over generated operation
  sequences, not as a handful of hand-picked cases.
- **Anything derived from an address is derived, never stored.** The angular sector a
  subtree radiates into, its collapse key, its depth — all of them are functions of the
  address. Persisting one creates a second copy of a truth that no longer has a single
  author, and it will disagree with the function the day the function changes.
- **A change to the addressing rules is a protocol break, and is treated as one.** It
  does not land inside a feature commit. If implementation shows a rule is wrong, stop
  and say so.

## Architecture

The deployment model (hosted, self-hosted, and fully local via the embedded IdP), the
monorepo layout, the syr split, the data model and the graph renderer's ownership line
live in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Keep architecture detail there,
not in this file.

**Stack at a glance:** pnpm + Turborepo monorepo. `apps/sloppy/{api,web,native}` —
NestJS API, SvelteKit web, Tauri native. `packages/ts/{types,client,app-core,ui,data,graph,idp}`
— shared TypeScript packages (`@sloppy/*`). Rust crates live under `packages/rust/` and
in the Tauri app's `src-tauri/`, managed by Cargo. Shared versions are pinned in the
pnpm catalog (`pnpm-workspace.yaml`). Run `pnpm dev` / `pnpm build` / `pnpm check` from
the root.

**The shells are shells.** `apps/sloppy/{web,native}` stay ~200-line boots. Every page,
component, store and API call lives in `@sloppy/app-core`. This is what makes one
codebase serve both surfaces, and it only works if nothing product-shaped leaks into
them. A change that adds a route to a shell is almost always a change that belongs in
app-core.

## Sloppy's Vocabulary Stays Out of the Identity Store (required)

Sloppy is built on **syr** for identity and content, and syr deliberately has no
lexicon system and no extension point for third-party record types — its own comparison
doc names "third-party repo pollution: structurally prevented" as a feature. So the
split is not a preference we could revisit; it is the shape syr enforces:

| Concern                                   | Owner                                           |
| ----------------------------------------- | ----------------------------------------------- |
| Identity, DID, keys, signing              | **syr** — Platform Delegation                   |
| Profile data                              | **syr** — resolved from the manifest and cached |
| Media blobs (block images, ink rasters)   | **syr** — presign → PUT → complete              |
| Emoji, stickers, reactions, comments      | **syr** — per-DID catalogs, federated           |
| **Nodes, addresses, labels, blocks, ink** | **Sloppy's own API + SurrealDB**                |

- **`node` and `block` are Sloppy's vocabulary.** Putting them in someone's identity
  store is precisely what syr is built to prevent. If a feature seems to need a new
  record type in syr, it needs a table in Sloppy instead.
- **Sloppy never holds a private key.** Content is signed through `platform.sign`; the
  syr instance holds the delegate key. Code that wants to sign locally has misread the
  delegation model.
- **Every remote asset goes through our proxy** (`proxied()`). Viewing a federated node
  must never leak the viewer's IP to the author's instance — a graph you can pull from
  strangers makes this more important, not less. A raw remote URL rendered into an
  `<img>` or a `fetch` is a privacy bug, not a shortcut.
- **Federation is pull-only.** syr has no relay and no firehose: follow a DID → resolve
  DID→provider → fetch that identity's public endpoints directly. Anything designed
  around a push feed is designed against the platform.

## Provider-Agnostic Data Shapes (required)

**Never hard-code a third-party integration's name into a data shape.** Types,
persisted rows, and API/DTO/client shapes must stay agnostic to which vendor (storage
backend, identity provider, OAuth provider, store platform, …) they carry, so a new
provider is a **new value, not a schema change**. The shape is the contract, and a
leaked brand name is debt every future provider pays.

- **Key a collection by a provider enum; never write one field per provider.** A single
  `provider` discriminant + a keyed map/list — `Partial<Record<Kind, T>>` or
  `Array<{ provider: Kind; … }>` — not `lastSyrSyncAt` / `minioBucket` / `hadS3`.
  Adding a provider should touch data, not the type.
- **Model the axis, not the brand.** A capability keys off what it IS — `local` vs
  `delegated` identity, `own` vs `pulled` provenance — not off the product that happens
  to provide it today. Don't conflate "which provider" with "which mode".
- **The same rule governs Sloppy's own open sets.** Block `type`
  (`paragraph | heading | list | todo | code | image | ink | embed`) and label
  dimensions are enums for exactly this reason: a new block kind is a new value and a
  renderer, never a column. A field named `inkStrokes` hanging off every block would be
  the same mistake wearing our own brand.
- **No brand token in a hardcoded branch, wire enum value, or SurrealQL column.** Prefer
  a predicate or a set (`isDelegatedIdentity(kind)`) over
  `mode !== 'syr' && mode !== 'local'`; name events for the concept.
- **Where a brand name IS legitimate:** the provider enum itself; the adapter class /
  `*.provider.ts` internal payload types, which exist to speak one vendor's dialect; env
  var names; and the registry keyed by the enum. The brand lives at the edge, never in
  the shared shape it normalizes into. When in doubt, ask: "does adding a provider force
  a type change here?" If yes, it's pollution — key it by the enum instead.

## Comments & Self-Documenting Code (required)

**The code says what it does; a comment says only what the code cannot.** Names, types
and small functions carry the meaning. A comment that restates them is not free — it is
a second copy of the truth that no compiler checks, no test fails on, and no reviewer
diffs, so it rots into a confident lie while the code beside it stays right. Prose is
the most expensive thing you can put in a source file. Spend it only on what the reader
cannot recover from the code, and spend it in a line or two. The rule, concretely:

- **Never explain an abstraction you are only USING.** How `ResponsiveModal` picks its
  variant, what the layout worker does with a settled position, how `--sysnav-inset-bottom`
  is published — those are their own files' contracts, and a call site that restates one
  creates N copies that all go stale the day the contract moves. The reader who needs it
  can open the file; the reader who doesn't was never served by a paragraph. Name the
  module or say nothing.
- **A comment describes the code, never its history.** No "previously we renumbered on
  move", no "this used to be a hand-kept list". The diff and the commit message already
  own that story, and they stay true because nobody has to maintain them. A file that
  narrates its own past teaches the next reader a version of the code that no longer
  exists.
- **Never restate the next line.** `// set the node's title` above `node.title = x` is
  noise. If a line needs translating into English, the line is the problem.
- **Cut what made the comment necessary, not just the comment.** A paragraph explaining
  a dense expression is a request for a named intermediate; a banner splitting a file
  into `// ---- Helpers ----` is a request for a second file. Prefer the rename, the
  extraction, the type — those the compiler keeps honest.
- **A module header is a few lines: what this is, and the doc of record.**
  `docs/ARCHITECTURE.md`, `DESIGN.md`, `PRODUCT.md` and their siblings are where design
  reasoning belongs, and a link to one stays true because the doc is maintained. An
  algorithm narrated at the top of a file is a spec nobody updates — put it in `docs/`
  and point at it.
- **Exported API gets the same rule, not a JSDoc exemption.** A shared package's public
  symbols are still code, and `childAddress(parent)` needs no paragraph. But the bound
  is what a comment DOES, not how long it is. One that merely disambiguates a name gets
  one line — a unit, a coordinate space, an ordering guarantee, a range. One that states
  an invariant the caller must uphold, or what an ABSENT field means on the wire, earns
  the sentences it takes to say precisely, because a wire contract carries obligations no
  compiler checks and no test on this side of it can fail. What never stays is the
  ARGUMENT for the rule: that belongs in the doc of record, with the type pointing at it.
- **Where a comment IS the right answer:** a WHY the code cannot show. A platform bug
  and its workaround (Android's WebView reporting `env(safe-area-inset-bottom)` as 0;
  `WKWebView` driving one pointer type at a time); an invariant the caller must uphold
  (an address is immutable once published); a deliberate deviation that reads as a
  mistake; an issue link; a `@ts-expect-error` justification; a `TODO` with an owner; a
  license header; a generated-file marker. These are load-bearing — they are what stops a
  future change from reintroducing a real failure. Keep them, and keep them short.

When in doubt, ask: "if I delete this, what does a reader lose that they could not have
worked out?" If the answer is nothing, it was never documentation — it was narration.

## User-Facing Copy Names the Outcome, Never the Mechanism (required)

**A person reads Sloppy's words to learn what happened and what they can do next —
never to learn how Sloppy is built.** Where a blob is stored, that a link is presigned
and expires while the bytes behind it do not, which worker computes a layout, what a
delegation token is: those are our problems, and naming them in product copy hands the
reader a fact they cannot act on and did not ask for. It also ages badly — copy that
describes today's implementation is wrong the day the implementation changes, and
nothing fails when it does. This holds everywhere words reach a person: the app, emails
and notifications, empty states, and the message on a thrown error. The rule,
concretely:

- **The test is whether the reader could act differently.** "This branch is published"
  is the outcome; "the subtree endpoint is public and unauthenticated" is the mechanism.
  If knowing it changes nothing they would choose or do, it does not belong in front of
  them.
- **No infrastructure nouns.** No bucket, CDN, presigned URL, cache, queue, worker,
  webhook, retry, index, DID, record id, or sync interval. The user did not choose our
  storage and cannot fix our worker. Say what they have, or what they can do.
- **An error says what to do next, not what failed.** "Delegation expired", "signature
  rejected", a bare HTTP status, or an internal id tells somebody they have hit a wall
  without telling them where the door is. Where the server explains itself in words meant
  for humans, pass those through; otherwise say what to try.
- **Never surface an internal identifier**, a table name, or a wire enum value. **The
  Folgezettel address is the one exception, and it is not one of these** — it is a
  user-facing part of the product, the thing a person cites and a peer resolves, so show
  it plainly wherever it helps somebody navigate. A record id beside it is still noise.
- **First ask whether the thing can even happen.** A disclosure about something the
  product does not do is worse than silence: it puts a scary sentence in front of
  somebody who did nothing to earn it, and it teaches people to read past notices, so the
  one that matters gets skipped too.
- **Where a consequence really is the user's, say the consequence — never the
  machinery.** Some facts change what a reasonable person would do, and those stay: that
  publishing a subtree makes it readable by anyone who has the address; that a peer who
  has already pulled a node keeps their copy after you unpublish; what leaves the device
  in hosted, self-hosted and local modes. State the consequence and stop — the reason it
  is true is ours to know. **Privacy, legal and safety disclosure is never what this rule
  trims**, so when one is in question, check what the product actually does before
  cutting OR keeping: the answer decides which of these two bullets applies.

When in doubt, ask: "would this sentence still be true, and still worth saying, if we
rebuilt the whole thing behind it tomorrow?" If it would not survive the rewrite, it was
never about the user.

## Design & Product (required reading for any UI work)

The visual and product direction lives in [`DESIGN.md`](DESIGN.md) and
[`PRODUCT.md`](PRODUCT.md). Sloppy should feel like **ink on good paper** — quiet,
legible, unhurried, with the graph carrying all the colour there is. Follow them for any
UI change. In short:

- **shadcn-svelte is the component vocabulary.** Use it wherever a component fits; don't
  hand-roll what shadcn covers. Components live in `@sloppy/ui`; the design system
  (Tailwind v4 tokens, the three theme axes, the graph's colour language) is
  `@sloppy/ui`'s `app.css`, imported by the apps via `@sloppy/ui/styles`.
- **Three orthogonal axes on `<html>`:** `data-theme` (surfaces), `data-accent`
  (`--primary`), `data-style` (how surfaces are drawn — edges and elevation, never
  colour). A style that names a colour is a bug; see DESIGN.md.
- **Mobile and tablet first.** Every surface is designed at phone width and then given
  room. A desktop-only affordance is a bug report against the phone layout.
- **`ResponsiveModal` is the only modal** — native sheet on iOS, drag-to-dismiss bottom
  sheet on phone, centered dialog at ≥640px, from one bound `open`, with the branch
  latched for the component's life. Don't add a second modal component; extend this one.
- **Mobile bottom-edge chrome must clear the system nav bar.** Android's WebView reports
  `env(safe-area-inset-bottom)` as **0** for the 3-button nav bar, so the native shell
  publishes the real inset as `--safe-area-inset-bottom`. Pad bottom-pinned surfaces with
  `var(--safe-area-inset-bottom, env(safe-area-inset-bottom))`, never bare `env(...)`.
  Four vars carry this; "is the keyboard open" is answered by the `keyboard` store, never
  by a var. DESIGN.md § "The four inset vars" is the contract.
- **Pen draws, touch pans.** `WKWebView` drives one pointer type at a time, so the
  gesture split falls out of the platform: `pointerType === 'pen'` inks,
  `'touch'` pans and pinches. Never branch ink on a mode toggle the user has to find.
- Quiet, plain tone. No gamification, no streaks, no manufactured urgency — a thinking
  tool does not nag.

## Commits & AI Attribution (required)

**AI is never to be attributed in commits.** Do not add `Co-Authored-By` lines for any
AI tool, do not mention Claude/Codex/Gemini/Copilot in commit messages, and do not add
"Generated with AI" trailers. This overrides any default behavior an agent arrives with.

In today's sea of internet slop, nobody cares _which_ AI someone used — what matters is
_who_ is filtering that slop and whether they are doing it correctly. AI is a tool, not a
colleague you can point to and blame. The human author owns every commit and is
accountable for it. Write commit messages as the author, full stop.

## Multi-System Prompts (parallel agents + adversarial review)

When the developer asks for changes to **different systems in the same prompt**, the
master agent parallelizes instead of working through them serially. This is the DEFAULT
for a compound prompt, not an optimization to reach for when a task looks big.

- **One agent per system, each in its own git worktree**, branched from the branch under
  work (not from `main` unless that is the branch under work), with non-overlapping file
  territories so the merge stays conflict-free. State each track's territory AND its
  **hard contracts** — the shared fields and exported signatures it may not change
  because a sibling track is reading them right now — in the prompt itself. A track that
  disagrees with a contract must stop and say so, not change it and hope.
- **Every track gets a one-paragraph statement of its intended effect on the product**,
  written before implementation starts. This is not decoration: the reviewers judge the
  work against it rather than against what they would have built, and the merge agent
  resolves conflicts with it. A track whose intended effect cannot be stated in a
  paragraph is not yet scoped.
- **Adversarial review in a loop, two adversaries per round, distinct lenses.** One
  reviews **technical** correctness — does it fix the verified failure, what regresses,
  are the new tests real, does the COMPOSITION work and not just the unit. The other
  reviews **vision** correctness — DESIGN.md, PRODUCT.md and the rules in this file,
  comment and copy truth, scope discipline. **The exit condition is zero findings from
  BOTH**; anything else is another round with every finding fed back to the implementing
  agent. That agent may reject a finding it believes is wrong, but must say so explicitly,
  so the rejection goes back to the reviewers instead of quietly disappearing.
- **A comment is not how a track answers a finding.** This loop has a failure mode that
  runs one way only: prose is the cheapest thing an implementer can add under review, so a
  round spent justifying the code in a new paragraph closes the finding and leaves the
  file worse. Excess narration is itself a **vision finding** (see "Comments &
  Self-Documenting Code") — a reviewer who accepts an essay as the answer to "why is this
  right?" is not holding the line, and an implementer answers by making the code obvious
  or by saying nothing.
- **Tell the reviewers that an empty findings array is the correct answer for work that
  is actually right.** Without that line they invent findings to look thorough, and every
  track burns its round cap on nits.
- **Cap the loop at three rounds** and surface anything still contested to the developer
  rather than looping forever. A contested track is held OUT of the merge tournament —
  nothing gets merged on a timer.
- **Restart the dev stack** so the developer can review the result running live, and
  report what changed per system. Readiness is `docker compose ps` reporting **healthy**
  for the backing services plus each host dev server's own ready line — never the exit
  code of the restart, which returns while the containers are still `starting`.

### Which model runs which role

**Fable plans and reviews; Opus writes the code.** A spawned agent inherits the master
agent's model unless it is told otherwise, so state the model explicitly on every call —
`model: 'fable'` / `model: 'opus'` on `Agent`, `opts.model` on a workflow `agent()`.
Leaving it off is how every role silently ends up on one model.

- **Fable — the roles that judge code without writing it.** Scoping the work (the track
  split, territories, hard contracts, each track's intended-effect paragraph, the merge
  bracket), and **both adversaries in every review round**, technical and vision alike.
  Also the round-cap call: whether a track is clean, contested, or going again.
- **Opus — the roles that write code.** The foundation wave, every track implementer, and
  every merge agent. A merge agent is an implementer, not a reviewer: it resolves
  conflicts, runs the checks for every package either branch touched, and fixes what
  breaks on the winning branch.
- **A reviewer that wants a change still does not make it.** The finding goes back to the
  Opus agent that owns the branch, exactly as the loop above requires — splitting the
  models does not split the territories, and a Fable adversary editing the tree it just
  reviewed removes the second pair of eyes the loop exists for.

### The merge tournament

Do not fan every branch into the working branch at the end. Merge them **against each
other, pairwise, as they finish**: the first two tracks to come back clean merge into
one branch, the winner re-enters the queue, and it repeats until a single branch remains.
That last branch is the one that merges into the working branch.

Two reasons this beats a fan-in:

- **Integration failures surface early, and in pairs.** A fan-in discovers every
  cross-track problem at once, at the end, with three authors' changes tangled together.
  A tournament finds each one inside a merge of exactly two known things.
- **It never waits on the slowest track.** Merging starts the moment any two are ready,
  so the tournament runs concurrently with the tracks still looping.

The merge agent is given **both branches' intended-effect paragraphs alongside the
code**, and that is the part that matters. A conflict between two tracks means someone
crossed a territory line; resolving it mechanically — taking one side, or keeping both
hunks — is how a merge silently reverts half of a fix. Resolve it by understanding what
each side was FOR.

And the standing instruction to every merge agent: **the two changes were verified in
isolation, so verify them together.** Ask specifically what the combination does that
neither did alone. A supply-side change and a consumer-side change can each be correct
and still compose into something broken — precisely the class of bug that the territory
split makes invisible to the per-track reviewers, because neither of them can see the
other half. Run the checks for every package either branch touched, against the merged
tree, and fix what breaks on the winning branch rather than reporting a green result
nobody observed.

### The foundation wave: shared files land BEFORE anyone forks

Some files are touched by every track — the `packages/ts/types/src/` barrel plus
whichever domain file beside it a new shape belongs in, the schema string in
`packages/ts/data/src/schema.ts`, the purge lists, `biome.json`'s package list, `docs/`.
If tracks fork before those settle, every branch edits the same lines and the merge is
exactly the conflict the territory split was meant to avoid.

So when work needs shared vocabulary, run a **foundation wave first**: one agent, no
parallelism, merged into the integration branch before any worktree is created.

**The foundation wave is explicitly authorized to create the shared material the tracks
will need, and is expected to** — not to defer it as somebody's later problem:

- **Types, enums and entity schemas**, keyed by an enum so a new variant is a value and
  not a schema change (see "Provider-Agnostic Data Shapes").
- **`DEFINE TABLE` / `DEFINE INDEX`** for every new entity, plus its rows in the deletion
  purge. Three rules go with this, all cheap now and expensive later:
  - **Production SurrealDB serves only `DEFINE`d tables; the dev stack does not enforce
    that.** An undeclared table passes locally and fails in production. The schema is also
    one contiguous string literal that several worktrees cannot append to independently.
  - **Every user-owned table needs a `created_by` column and must be purged by it.**
    Purging through a parent row leaks every orphan, permanently.
  - **SurrealDB will not use a composite index whose second column is a nested path**, so
    denormalize a top-level scalar beside the object — the way `node` stores `node_did`
    beside its composite id.
- **Request DTOs** (`Create*Request` / `Update*Request`) for every new entity. These are
  the shared contract between a form and the API, and they can only drift if each surface
  invents its own shape.
- **Docs**, including reconciling any document of record the new types contradict.
  Shipping a foundation whose docs disagree with its types hands every branch a false spec.

Rules that make a foundation wave safe:

- **Additive by default.** Existing rows must parse unchanged. Adding a `.default()` to a
  NEW field on an EXISTING entity makes it required on the inferred output type and breaks
  every construction site — use `.optional()` there and document what absent means.
  (`.default()` stays correct on new entities and new schemas.) And state the fallback: a
  field whose absent case the foundation leaves unstated gets its default decided by
  whichever track reads it first.
- **Beware refinements on entity schemas.** `.refine()`/`.check()` make `.omit()` and
  `.partial()` THROW at module evaluation, which takes the API down at import and is
  invisible to `tsc`. Prefer a discriminated union, or a free predicate the DTOs call.
- **It gets the same two-adversary review as any other track, and needs it most** — a
  defect here propagates into every branch that forks from it. **No worktree is created
  until both adversaries come back clean on it.**
- **Prove back-compat, never assert it.** If the work claims a new representation
  reproduces an existing one losslessly, it ships a test that enumerates the live branches
  it must reproduce — and the strong form (distinctness/injectivity) where the property
  allows, not hand-picked cases. An author is the last person able to audit their own
  losslessness claim; that is what the adversaries are for.
- **Do not silently drop a checklist item.** If implementation shows a specified field or
  approach is wrong, say so in the thread and get agreement; changing the contract inside
  a commit message is how a downstream track ends up implementing against a field that no
  longer exists.
- **State in the hand-off** anything that would break a branch already forked from an
  earlier revision of the foundation.

## MarkItDown Preprocessing (required)

Before reading or reasoning about any non-text source file (PDF, DOCX, PPTX, XLSX,
images, audio, HTML, CSV, JSON, XML, ZIP, EPUB, and other formats MarkItDown supports),
**always preprocess it through [MarkItDown](https://github.com/microsoft/markitdown)
first** and work from the resulting Markdown. Do not attempt to parse these binary or
rich formats directly.

```bash
markitdown path/to/source.pdf -o path/to/source.md
```

Save the generated Markdown alongside the source (same directory, same basename, `.md`
extension) so it can be reused and version-controlled.

MarkItDown is installed via pipx:

```bash
pipx install 'markitdown[all]'
```
