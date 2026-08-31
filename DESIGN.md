# Design

Visual system for the Sloppy clients (web + native). Built on the shadcn-svelte token
architecture (OKLCH), then quieted: Sloppy should feel like **ink on good paper** —
legible, unhurried, and almost colourless, so that the colour the graph does spend means
something.

Read alongside [`PRODUCT.md`](PRODUCT.md). Components are shadcn-svelte wherever one
fits; we don't hand-roll what shadcn already does well.

> **Status.** The token layer is built and the rest is not. `packages/ts/ui/src/lib/app.css`
> carries the three axes, the theme, accent and style presets, the graph's hue slots, the
> scroll chrome and the four inset formulas; `token-contrast.test.ts` beside it measures the
> floors below rather than asserting them. Everything else named here — the components,
> `ResponsiveModal`, the font axis, the prefs store, the graph's own colour conversion — is
> still a specification for a later milestone, not a description of the tree. See the
> [README](README.md) for what is actually in the tree.

## The feeling

A surface you can put a half-formed thought on without tidying up first. Plain type,
generous space, a canvas that stays still unless you move it. Nothing congratulates you,
nothing nags. The chrome is a margin; the graph is the page.

Sloppy is **dry, not cold**. Warmth comes from the paper (a faint warm cast on light
themes) and from copy that is short and human, never from decoration.

## Show, don't tell (copy)

The interface demonstrates; it never narrates its own mechanics. Do not explain what the
app will do with an answer — a person capturing a thought is not studying the product
architecture. Let the result appear where it matters instead: the new node's address
appears on the node the moment it is created; the pulled region's author appears on the
region, not in a tooltip about federation.

A line of copy earns its place only when it helps the reader ACT — an instruction, an
expectation, a consequence they can choose against — one short line, never a lecture. If
a sentence's job is to justify a question, cut the sentence; if the question needs
justifying, question its placement instead.

## Theme

Default new-user theme is **Paper** — a near-white with the faintest warm cast, the
light of a notebook page. First visit honours the OS colour-scheme: **light OS → Paper**,
**dark OS → Graphite** (pencil-grey, not black). After first visit the saved preference
always wins. Themes are a client-side choice; no account required.

### Token architecture (three independent axes)

shadcn tokens drive everything (`--background --foreground --card --popover --muted
--secondary --accent --border --input --ring --primary --destructive` …). Three
orthogonal axes on `<html>` so people mix freely:

1. **Theme preset** → neutral/surface tokens.
   `data-theme="paper|graphite|light|dark|contrast"`. Dark-family themes (graphite, dark)
   also carry the `dark` class so Tailwind `dark:` variants work.
2. **Accent preset** → `--primary`, `--primary-foreground`, `--ring`, plus the derived
   `--primary-mark`. `data-accent="indigo|moss|rust|sea|iris|ochre|slate"`. Every accent
   composes with every theme. **Do not assume a pairing clears a contrast floor because
   the tokens exist** — draw a mark (an icon, a rule, a chart stroke) with
   `--primary-mark` and a fill (a button, a chip) with `--primary`, and see "Contrast is
   measured, not assumed" below.
3. **Style preset** → how surfaces are DRAWN: edges and elevation, never colour.
   `data-style="default|hardline"`, absent when default (same convention as
   `data-app-font`).

CSS lives in `packages/ts/ui/src/lib/app.css` as `:root[data-theme="x"] { … }`,
`:root[data-accent="y"] { --primary: … }` and `:root[data-style="z"] { … }` blocks, plus
the Tailwind v4 `@theme inline` mapping. The app root layout sets the attributes from the
prefs store before content renders (inline head script) so there is no flash of the wrong
theme.

A correction that applies to a set of themes is written as the pairings it corrects, never
as a `:not()` exclusion: `token-contrast.test.ts` reads the stylesheet and skips `:not()`,
so an exclusion-only rule would go unmeasured. Where a `:not()` twin is needed anyway — the
bare-root case, which carries no attribute to match on — it shares one declaration body
with its positive siblings, so the two cannot disagree.

**Adding a dark theme will mean touching every hardcoded dark roster, not just the CSS:**
the `DARK_THEMES` set in the prefs store, the dark set in any component harness, and the
inline `const dark = …` check in **both** shells' `app.html` boot scripts. Miss that last
one and the theme paints its dark surfaces with light-mode `dark:` variants for one frame
on every cold load.

### Theme presets (neutral/surface tokens)

| Preset                    | Surface                  | Ink (fg)                 | Feel            |
| ------------------------- | ------------------------ | ------------------------ | --------------- |
| **Paper** (light default) | `oklch(0.972 0.006 85)`  | `oklch(0.26 0.015 70)`   | notebook page   |
| **Graphite** (dark)       | `oklch(0.215 0.008 260)` | `oklch(0.905 0.006 250)` | pencil on slate |
| Light                     | `oklch(1 0 0)`           | `oklch(0.145 0 0)`       | clean, neutral  |
| Dark                      | `oklch(0.145 0 0)`       | `oklch(0.985 0 0)`       | neutral night   |
| High contrast             | `oklch(0.99 0 0)`        | `oklch(0.13 0 0)`        | accessibility   |

Paper is warm and Graphite is cool on purpose: paper is a warm object and pencil is a
cool mark, and the pairing keeps the two defaults from reading as one theme at two
brightnesses.

card/popover sit ~+0.015 L above surface; border/input are the surface hue at low chroma;
muted is 0.035 L off the surface **toward the ink** — down on a light theme, up on a dark
one, because a well dug below Graphite's page is where a skeleton disappears;
`token-contrast.test.ts` holds that step on every theme. Keep chroma
≤0.02 on neutrals — the surfaces are a ground for
the graph's colour, and a tinted ground shifts every hue drawn on it. Radius is moderate
(`--radius: 0.625rem`): unfussy, not soft.

### Accent presets (`--primary`)

Default accent is **Indigo** — the blue-black of fountain-pen ink.

| Accent               | `--primary` (light)    | note                |
| -------------------- | ---------------------- | ------------------- |
| **Indigo** (default) | `oklch(0.52 0.14 265)` | fountain-pen ink    |
| Moss                 | `oklch(0.55 0.09 145)` | quiet green         |
| Rust                 | `oklch(0.56 0.13 45)`  | earthy              |
| Sea                  | `oklch(0.58 0.10 210)` | cool, clear         |
| Iris                 | `oklch(0.55 0.13 300)` | violet              |
| Ochre                | `oklch(0.66 0.12 80)`  | warm, dry           |
| Slate                | `oklch(0.50 0.02 265)` | neutral / no-colour |

The accent is chrome only. **It never colours a node, an edge, or a tag** — those come
from the graph's own language below, and an accent that leaked into the canvas would make
a user's theme choice change what the data appears to say.

### Style presets (`data-style`) — the structural axis

**Hardline is a vibe, not a colour scheme.** Hard ink edges, blurless offset shadows, a
tighter radius. It is its own axis precisely so Hardline × Graphite and Default × Paper
are both real, selectable combinations.

**The rule that keeps it orthogonal: a style may not name a colour.** The only palette
token a style may touch is `--border`, and it _derives_ that from the active theme rather
than declaring one:

```css
--border: color-mix(in oklab, var(--foreground) 88%, var(--background));
```

which lands near-black on a light theme and near-white on a dark one, and stays
**opaque** — mixing toward `--background` rather than using alpha matters, because a
translucent edge picks up whatever it is composited over. Anything in a style block that
names a literal colour is a bug.

| Preset      | Edge                      | Elevation             | Radius     |
| ----------- | ------------------------- | --------------------- | ---------- |
| **Default** | 1px hairline              | soft blurred shadow   | `0.625rem` |
| Hardline    | 2px ink, 2/4/4/2 on boxes | hard offset, blurless | `0.375rem` |

Four things a style must get right, and each is a place a style ships looking half-done:

- **A style block sits AFTER every `[data-theme]` block and carries a `.dark:root[…]`
  twin.** Dark families declare `--border` at `.dark:root[data-theme='x']` (specificity
  0,3,0), so the plain `:root[data-style]` form (0,2,0) loses to them on specificity alone.
- **Controls that reserve a transparent edge get the ink.** shadcn's idiom for "this
  control only sometimes shows a border" is `border border-transparent`, coloured by a
  variant. Under a loud style those read as _missed_ unless the style reaches them by
  `data-slot` + `data-variant`. Ghost and link variants stay bare everywhere.
- **A visual style never eats a focus indicator or an error state.** Unlayered override
  rules outrank `focus-visible:border-ring` and `aria-invalid:border-destructive`, so
  every such rule ends in `:not(:focus-visible):not([aria-invalid='true'])`. This is an
  affordance guard, not tidiness.
- **A control sized in fractional pixels needs its geometry given back.** A 2px edge on a
  track hand-sized around a 1px one spills the thumb out of its own track; give the track
  exactly the pixels the second border takes, or the travel arithmetic stops landing flush.

**The canvas is exempt from `data-style`.** Node and edge geometry is drawn by pixi from
numeric colours, and a hard offset shadow on ten thousand marks is both unreadable and
unaffordable. The style changes the chrome around the graph and nothing inside it.

## The graph's colour language

This is the signature system, and it is built on one constraint: **at graph scale there
are exactly three cheap perceptual channels — hue, lightness, and form — and no two
meanings may share one.** Two meanings sharing a channel is how a graph view becomes
decorative.

| Channel                        | Carries                                              | Why this channel                                                                                             |
| ------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Hue**                        | the tags the reader has selected                     | the selection is the question the reader just asked, so it gets the loudest channel                          |
| **Lightness**                  | genealogical depth                                   | depth is ordinal, and lightness is the only channel read as ordered without a legend                         |
| **Form** (shape, edge, radius) | provenance, the author's look, and the canvas's mode | form survives greyscale, colour-blindness and full zoom-out, so anything that must never be a hue lives here |

Hue and lightness each answer one question. Form answers several, because everything
that must survive greyscale ends up in it — so form is subdivided instead, and
§ "The mark" is the division. Radius is the one channel inside it that two meanings share,
and § "The mark" bounds it; nothing else there is shared.

### Hue — the tags you selected, and only those

**With nothing selected, nothing on the canvas is coloured to mean something.** Colour
appears when the reader asks a question of the graph, and it means the answer. A
permanently rainbow canvas is the Obsidian failure with extra steps.

The one thing that carries colour of its own is an author's preview picture, and it is a
picture — imagery inside the disc, never a fill (§ "The mark"). It says nothing about
which sets a note is in, and every fill, edge and line around it stays monochrome until a
tag is selected.

- **A tag has no colour of its own.** It borrows one for as long as it is selected: the
  first selected tag takes `--facet-1`, the second `--facet-2`, and so on. There is
  nothing to persist and nothing to pin, because there is no tag row to hang a colour on
  — a tag exists exactly as long as a note carries it.
- **Selection order assigns the slot, and the tag rail shows that order**, so the legend
  and the canvas cannot disagree about which colour answers which question.
  `assignTagHueSlots` in `@sloppy/types` is where that mapping is made, and the only
  place it is.
- **A note carrying more than one selected tag draws in the earliest-selected one's hue.**
  One mark, one hue: mixing or striping makes the channel ambiguous, and the rail already
  says which sets a note is in.
- **Notes carrying none of the selected tags dim; they never leave.** The reader asked
  which notes are in a set, not to be shown a different graph, and the shape they are
  reading the answer against is the graph itself.
- Past eight selected tags the slots repeat. Eight questions at once is already more than
  the channel can carry, and the rail carries the written tag regardless.
- Every slot owes **3:1 against the surface** on every theme, because a node fill carrying
  meaning alone is a graphical object. Every slot also owes a minimum OKLab distance of
  **0.03 from every other slot** on the same theme — a palette whose slots have converged
  passes every contrast check and has quietly stopped being a language.

### Lightness — depth

Depth ramps between two ends the theme already owns: `--graph-ink` (the mark) and
`--graph-paper` (the ground). Root nodes sit at the ink end; each generation mixes one
step toward paper, bounded at six steps because level of detail has collapsed anything
deeper anyway.

Deriving the ramp from the theme's own ends rather than declaring six values per theme is
what makes it invert correctly on Graphite with no second table.

**The mix is computed in `@sloppy/graph`, not in CSS.** pixi takes numeric colours, not
CSS strings, so the tokens are read once from the computed style on theme change,
converted, and cached. A component that reads `getComputedStyle` per node per frame is the
single easiest way to make this canvas slow.

### Form — provenance

| Provenance    | Drawn as                                    |
| ------------- | ------------------------------------------- |
| **Own**       | solid fill, no ring                         |
| **Published** | solid fill + a thin ring at the node's edge |
| **Pulled**    | hollow fill + a dashed edge                 |

A pulled region additionally carries a written attribution at its origin node, and keeps
its original addresses. **Whose thought this is must never be a question the reader has to
work out** (PRODUCT.md principle 4) — so it is carried by shape, by a written label, and
only incidentally by anything else.

### The mark — five meanings on one small disc

A note is one small mark, and five separate things have to be readable off it: where the
thought came from, how its author asked it to look, whether it is one of the notes a link
is being pointed at, whether it is one of the notes somebody has chosen to act on, and
whether it is one of the notes open in front of the reader. Each gets its own channel.

| Channel on the mark                               | Carries                                                 |
| ------------------------------------------------- | ------------------------------------------------------- |
| Fill hue                                          | the selected tags (§ Hue)                               |
| Fill lightness                                    | genealogical depth (§ Lightness)                        |
| Fill alpha                                        | carries none of the selected tags (§ Hue)               |
| **Its own edge** — present, and whether broken    | provenance (§ Form)                                     |
| **A ring inside it** — weight, and whether broken | the author's look                                       |
| **Its radius**                                    | how much is folded into it, scaled by the author's look |
| **The disc's imagery**                            | the author's picture, at the share of the disc they set |
| **The orbit outside it**                          | the mode the canvas is in — picking, or choosing        |
| **The paper under it** — how far it lifts         | this note is open, and whether it is the one being read |

Ten rulings hold that table together:

- **Provenance keeps the mark's own edge, and a look draws INSIDE the mark.** Both want a
  ring and both want to be broken — a pulled region is dashed, and a draft is dashed — so
  they separate by radius rather than by which of them gets to be dashed. A pulled draft
  is two dashed rings at two radii, and reads as two facts. Provenance is the one that
  must never be a question the reader works out (PRODUCT.md principle 4), so it is the one
  that does not move.
- **Picking and choosing share the orbit outside the mark**, because a canvas is in one
  mode or the other and never both: you are picking the note a link points at, or you are
  choosing notes to act on. They are still drawn apart so nobody has to know that —
  **picking outlines, choosing fills.** A hairline ring in the orbit is a note already
  linked and a heavier one is the note being linked from; a solid band in that same orbit
  is a note in the chosen set. The chrome names the mode; the mark says membership.
- **Size stays the fold's, and radius is the one channel two meanings share.** A radius
  says how much thought is folded into a mark; a look scales that rather than replacing it.
  The bound is what keeps both readable, and it is tighter than it sounds: the smallest
  mega-node is one note folded, `9 × (1 + log2(2) × 0.42) ≈ 12.78` against a leaf's 9, so
  **a look may grow a leaf by strictly less than 1.42×**. A look that could make a leaf
  read as a folded subtree has taken a channel that was not its. `model.test.ts` in
  `@sloppy/graph` holds that bound over every size a look offers.
- **A mega-node draws its own look, and none of the looks it folded.** A mega-node IS a
  note — the root the fold collapsed to — so it wears the ring, the radius scale and the
  picture its own author gave it. What a fold aggregates is a set a mark can be IN — its
  tags, and whether it is one of the notes open — because a mega-node answers for the
  subtree it replaced; a look is authored by one person on one note, and forty of them do
  not average into a forty-first.
- **A look is the first thing to go as the mark gets small.** Three concentric strokes do
  not survive a leaf drawn at half a pixel, so they drop in the order of how little the
  reader is owed them: the look's ring and its picture first, then the orbit and the
  provenance edge, which are last because one is the act the person is in the middle of
  and the other is PRODUCT.md principle 4. The threshold is DRAWN radius rather than zoom
  — `layoutLabels` in `scene.ts` is the precedent, and its hysteresis is too, so a look
  does not flicker on a mark drifting across the line, nor on a rebuild. **A figure that
  drops the look at the view a graph OPENS on has dropped it always**, so the threshold is
  measured against that view — a phone, the whole field framed — and `scene.test.ts` holds
  it there. Where the field is too big to hold one, looks survive on the mega-nodes and a
  pinch brings the rest back.
- **A picture may grow, and what bounds it is what it leaves.** How much of the disc the
  imagery covers is a channel its author spends, so a picture can be the thing you see
  rather than a dot in the middle. What stops it is the band of fill outside it, where the
  reader's own question is answered (§ Hue): that band stays wider than the heaviest ring
  an author may draw, because a picture that left the reader's channel thinner than the
  author's own decoration would have taken the loudest thing on the mark from the question
  it exists to answer. **The ring is drawn inside that band, so where an author spends one
  the hue is what the ring does not cover** — at the largest picture under a heavy ring that
  is about half the band, and still the widest single thing left on the mark. **The band is measured where it is drawn, not out to the radius** —
  the fill stops short of the mark's edge, and on a published note the ink edge is drawn
  over the outside of what is left, so the tighter of those two is what the largest picture
  is worth. That lands the ceiling on the look's ring, which is where it belongs: **the
  ring is drawn over the picture**, so a rim that stops under the ring is framed by it and
  one well inside it is a circle of its own. A rim that stops just short of a ring's edge is
  the case guarded against, because two circles that close read as one thick edge instead of
  two facts — the clearance held is half the thinnest line drawn, which the middle size meets
  exactly against a regular ring and spends entirely against a heavy one, where it stops
  tangent to the ring instead. `scene.test.ts` holds those bounds against the radii `scene.ts` draws at, and
  `PREVIEW_SPAN` in `model.ts` is what each size is worth. A picture is cut to the largest
  of them once, when somebody chooses it; a mark drawn bigger than the bytes it holds draws
  them softer rather than refusing them.
- **Where an author spends both, the ring wins the band they share.** A solid heavy ring
  covers the annulus the two largest pictures differ across, so on such a note they draw
  alike; a dashed one leaves most of its turn open, and the two rims show apart through the
  gaps. That is the ring's, not a size that failed to act: the ring is the author's own
  line and a picture that erased it would have taken a channel that was not its. An author
  who wants every pixel of the picture has a lighter ring, or none, and none is what a note
  draws with nothing set.
- **Being open lifts the mark off the paper, because the paper was the one surface no
  meaning had taken.** Every other channel spends the mark itself — its fill, its edge, the
  ring inside it, its radius, the imagery on it, and the orbit ruled around it. Being open
  may not have the orbit: that channel is honest only because a canvas is picking or
  choosing and never both, and being open is not a mode of the canvas at all — a note stays
  open while somebody chooses, and while they do neither. So it takes the ground the mark
  stands on, drawn as ink laid outside the mark's edge and fading outward, which reads as a
  mark lifted rather than as another line drawn round it. **It clears the mark's edge
  before it lays anything**, the way the orbit does and for the orbit's reason: that edge
  is provenance, an `own` note draws none, and ink laid tangent to the rim would hand one a
  ring it never had. The clearance is half the orbit's, because a lift is ground rather
  than a line — held as far off as the orbit it stops reading as the mark's own paper.
  **It is one channel at two
  strengths** — a note that is open lifts a little, the note being read lifts further and
  darker — because open and active are one fact at two intensities, not two facts.
  Concretely it is rings and never a disc: a pulled mark is drawn hollow, and a lift that
  filled it would make provenance read as own.
  **It is not `data-style`'s elevation**, the way the ground is not the style's either
  (§ "The ground"): the canvas is exempt from that axis, and this is drawn from
  `--graph-ink`, so it inverts with the theme and no theme has to know it exists.
  **It never dims with the tag question** — § Hue's alpha answers what the reader ASKED,
  and this answers where the reader IS, so a note carrying none of the selected tags still
  shows plainly that it is the one being read. It is the LAST thing to go as a mark
  shrinks rather than the first, with the orbit and the provenance edge, and it is the
  mark's own size only while the mark has room: **what it spreads has a floor measured on
  the screen**, so a mark drawn at half a pixel still lifts far enough to find. Somebody
  hunting the note they are reading across a field they zoomed out of is exactly who that
  floor is for, and it only ever widens — at the view a note is read at, the lift is the
  mark's own size and none of the geometry above moves.
  And the objection to elevation on a canvas — a shadow on ten thousand marks — does not
  reach it, because **its cost is bounded by the fact rather than by the field**: only the
  handful of notes a reader has open are ever lifted. **The chosen band and a lift share
  ground, and are told apart by weight rather than by clearance** — the band is a
  screen-constant gap outside the mark while a lift is the mark's own size, so past a small
  mark the band is drawn INSIDE the lift, and further in the closer the reader zooms. It
  goes on reading as a band because it is laid at least half again as heavily as the
  heaviest paper a lift can put under it, which is the bound `scene.test.ts` in
  `@sloppy/graph` sweeps every mark size and zoom against; it holds the two strengths apart
  there too, and `scene.lift.test.ts` holds the lift at full strength on a mark the tags
  have dimmed.
- **The active note moves `focus`, and `focus` goes on meaning what it always meant.**
  Level of detail is measured in hops from the note the reader is reading (`lod.ts`),
  which is the note they will walk out of. It says nothing about how a mark is DRAWN, and
  it knows nothing about the other notes open beside it — the lift is the only thing that
  says which those are. So the budget goes on folding a note open far from the focus, and
  **the mega-node that swallowed it lifts in its place**, by the aggregation rule above:
  a tap through it reaches the mark itself, and what the surface lists as open and what the
  canvas draws can never disagree. The budget is not widened to hold every open note's
  spine drawn instead — the focus's own exemption exists because folding it would fold the
  focus out of the view it is the focus of, and that argument is about one note rather than
  a handful. **The note being read is never the one aggregated**: it is the focus, and the
  budget will not fold the focus's spine.
- **"Selection" already means the reader's selected TAGS** — `GraphSurfaceProps.selection`,
  the question the hue channel answers. The notes somebody has picked out to act on are
  **the chosen set**, everywhere, and nothing else on the canvas may be called a selection.

### A note's look never uses colour

Every channel a look may spend is shape or imagery: ring weight, whether the ring is
broken, mark radius, a picture, and how much of the mark that picture covers. There is no
colour picker on a note, and a build that grows one has grown a bug.

Hue here is the reader's own question — the tags THEY selected, in the order they selected
them — and it has to stay legible across a graph pulled whole from somebody else, styled
by an author the reader never met. A note carrying a colour of its own would answer a
question nobody asked, in the one channel reserved for the question they did.
`NodeAppearanceSchema` in `@sloppy/types` therefore carries no colour field at any level.

The VALUES those channels take are an open set, for the same reason the element kinds
inside a block are: a look this build has no renderer for is stored and handed back
untouched, and draws meanwhile as an unstyled note does. Adding a look is a value; adding
a channel is a change to the table above.

**A look does not reach a peer yet, and a pulled region draws unstyled.** `PublishedNodeSchema`
carries no appearance. Ring weight, ring style and radius are plain shape and could travel;
the picture cannot, because a preview is an upload in the author's own private store, which
docs/ARCHITECTURE.md § "Pictures" already owns as an open gap. The publishing milestone owns
both halves and settles the picture's fate before the other three go, so that a peer either
sees the look its author gave a note or sees none of it.

### Edges

Three kinds of line cross the canvas, and which one a reader is looking at has to be
answerable at a glance. Hue is not one of the channels that answers it — that belongs to
the tags (§ Hue) — so they separate by weight, by lightness and by whether the line is
broken.

| Edge                                | Drawn as                           | What it says                          |
| ----------------------------------- | ---------------------------------- | ------------------------------------- |
| **Genealogy** — parent to child     | the depth ramp, thin, lowest alpha | this thought sprang out of that one   |
| **The run** — consecutive addresses | ink, solid, heaviest line drawn    | this thought carries on from that one |
| **A link** (`links[]`)              | ink, dashed, drawn above both      | somebody drew this by hand            |

Genealogy is everywhere, so it recedes. The run is the line a reader walks — `1 → 2 → 3`,
`1a → 1b` — so it is the one that carries weight, and it is **derived from the addresses,
never stored** (AI.md § "The Address Is the Protocol"): the two notes either side of a
deleted one still read as consecutive, because they are. A link is the only line a person
drew, so it is the only broken one; it crosses the tree and would otherwise read as
parentage. Where somebody has drawn a link along a run, the hand wins and the line is
dashed.

**A reference is none of the three.** `[[` names another note from inside a sentence, and
the canvas draws nothing for it: it belongs to the writing it was typed into, not to the
shape of the graph. `links[]` therefore stays what somebody drew by hand — a reference
that wrote one would put a dashed hand-drawn line over a run that is already solid, and
claim a gesture nobody made.

**With tags selected, genealogy and the run both dim**: the reader has asked to see sets,
and the tree is momentarily the background.

### Contrast is measured, not assumed

Ratios in this document are targets until a test holds them. `token-contrast.test.ts` in
`@sloppy/ui` is the file of record, and it runs: it sweeps every theme × accent and every
theme × facet-slot pairing, measures on the **quantised** colour (both sides converted to
sRGB and rounded to 8 bits per channel, which is what a screen actually paints), and holds
the 3:1 mark floor and the 0.03 separation floor — on `--background`, `--card` and
`--popover` alike, because most marks are not drawn on the page. It reads the tokens out of
`app.css` itself; a table of them beside the stylesheet would be a copy that drifts.

One accent needs a correction today, and only one: Ochre on the light family reads 2.90:1
as a solid mark on Paper, so `--primary-mark` moves it in lightness alone. Every other
pairing is handed back its own colour untouched.

**A floor this file does not name is a floor nothing measures.** Small accent TEXT owes
4.5:1 and no member of the mark family reaches it — the mark floor is for graphical objects
and large text.

A figure quoted anywhere in this repo without a test behind it is a target, and should say
so.

## Typography

- **UI and content face**: Inter with a system fallback (`Inter, system-ui, -apple-system,
"Segoe UI", sans-serif`). One family for chrome, node titles and block text. There is no
  display face — a notebook does not change typeface to make a heading feel important.
- **Address face** (`--font-address`): JetBrains Mono with a `ui-monospace` fallback,
  tabular figures, always. An address is scanned and compared character by character, and
  `1a1` against `1al` must never be a question the reader has to resolve. Every address in
  the product renders in this face, at every size.
- Fixed rem scale, ratio ~1.2. Hierarchy by scale and weight (≥1.2 between steps).
- **The font axis** (`data-app-font`) swaps the UI face: `atkinson` and `opendyslexic` for
  accessibility, `apple` for SF Pro. It swaps the address face too, and drops the
  tabular-figure guarantee where the chosen family cannot provide it. **Legibility
  outranks alignment** — a reader who needs OpenDyslexic to read at all does not get an
  exception carved out of it for our nicest column.

## Layout

- **Canvas-first.** The graph is the page; there is no page around it. Chrome floats over
  the canvas and is dismissible.
- **Floating nav, not a top bar.** A pill anchored bottom-centre (`fixed`, safe-area
  inset) holds the core destinations. ≥44px targets, keyboard-reachable, `aria-label`led.
  The pill publishes its own height as `--sysnav-inset-bottom` and is suppressed while a
  modal is open.
- **A note opens into a reading surface.** `ReadingPanel` is that surface, and it has two
  presentations from one bound `open`: **docked beside the graph at ≥900px**, where the canvas
  keeps its pan, its pinch, its choosing and its menu beside an open note; and a **full-height
  modal sheet below that width**, phone and portrait tablet alike, so a note is a page rather
  than a peep-hole. The branch is fixed for as long as a note is open — a rotation mid-edit
  never remounts the editor and loses a caret — and is read again from the viewport once the
  surface is empty.
- **A docked panel is a layout, not a modal**: no scrim, no focus trap, nothing else on the
  page taken away while it stands, and a drag begun on the canvas is still the canvas's. It is
  put away by the way out at its head, and by Escape from inside it — outside it, Escape
  belongs to whatever the canvas is in the middle of. Beside means beside, so it publishes the
  width it takes as `--reading-dock-inset-right` and the page it stands next to gives that
  width up rather than going on drawing its chrome underneath.
- **The wall between a docked note and the graph is the reader's to move.** A person who
  came to write takes as much room as they want for it, by dragging that inner edge or by
  moving a separator they can focus with the arrow keys. It shows a grip at rest rather than
  one that appears under a pointer, and the target around that grip is one a finger can hit:
  the tablet it docks on has no hover. It is bounded at both ends — never narrower than the
  column a note is worked in, never so wide that what it is docked against stops being a
  graph — and it publishes every width it passes through rather than only the
  one it comes to rest at, because the nav pill, the bar over a chosen set and the card
  beside a mark all place themselves against that number. Below the dock width the note is
  the whole screen and there is no wall, because there is nothing left to take room from.
  How much room was taken is this device's, kept beside the theme (§ Persistence).
- **The note's way out and its address keep their place** at the head of the surface however
  far the note runs. The way back out of a long note must never be a scroll away, and the
  address is the thing a person cites.
- **Several notes stay open in that surface, and a strip across its head says which.** A
  reader working across a few related notes switches between them without losing their
  place in any — what was typed, what a note is showing, what a failed act left to say, and
  how far down it they had got are all that TAB's, never the surface's. The strip is the
  same strip on a phone as on a desk, because a phone is where it matters most, and it
  appears only once there is something to switch to: one note open draws no strip, which is
  the remove-empty-chrome rule above applied to the head of the surface. **Each tab is led
  by its address**, in the address face, because that is the label a note always has and
  the one a person cites.
- **A plain tap replaces the note being read; opening one BESIDE it is a deliberate act.**
  A walk along the run — previous, next, down, up — and a tap on the canvas both move the
  tab the reader is in, so walking a branch never quietly fills the strip. Opening another
  note as well has a way in wherever a note is named: the canvas menu on a mark, which a
  right-click and a press-and-hold both raise, and — beside every row inside a note that
  names another one — a control of its own. **The row is what makes this reach a phone at
  all**, where the surface stands over the canvas the menu is on, and the rows are the
  related notes a reader came to work across. **The address bar names the active note and
  nothing else** — which notes are open beside it rides in the history entry, so Back and
  Forward can never land on a strip that disagrees with the address, and a reload lands on
  the one note the address carries.
- **A question put to the graph borrows the surface; it does not close it.** Pointing a
  link at a note takes the reading surface out of the canvas's way, and the notes open come
  back with the reader when the graph has answered or the question is abandoned.
- **Closing has a bound and the bound is said plainly.** A tab closes onto the note beside
  it; the surface's own way out puts the whole thing away. Past a handful of open notes the
  strip stops being somewhere a note can be found, so opening another says how many may be
  open and what to do about it.
- **Inside the surface, the room is the surface's, not the window's.** A note is worked in a
  column between 22rem and 42rem wide — the reader moves that wall themselves — on a desk
  where every viewport breakpoint has long since turned on, so what lays itself out in two
  columns or one asks a container query, never `sm:`.
- **Inside a note, the words lead.** A person opens a note to read it and write in it, so
  the writing comes straight under the title and nothing stands between them. What a reader
  takes in at a glance stays out where they can see it — the address, the title, who wrote
  it, the tags it carries, the notes under it and the notes it names — and what they
  occasionally DO to a note waits behind one quiet control at the head: filing it, giving it
  a look, pointing it at another note, taking it down. This is a ranking and never a
  removal, so every act is still one tap away and the phone gets exactly the acts the desk
  does.
- **The one act that cannot be taken back sits apart.** Deleting a note is the last thing in
  that control, below a rule and in the destructive colour — never a full-width button in
  the flow of a note somebody is writing in, where a hand lands on its way to something
  else. The question it then asks is the same question the canvas asks about a whole chosen
  set, in one wording that is derived rather than written twice.
- **A block reads as a section, not a paragraph.** Each is a bounded region of the page —
  a ruled band with its own handle — quiet enough that a note of three sections still
  reads as one page. Everything inside is ordinary prose; the boundary is the only
  structure the note draws.
- **Adding a section is a control somebody taps.** AI.md § "A Block Is a Section" is the
  rule; the design consequence is that the affordance is visible at the end of the stack
  rather than hidden behind a keystroke or a slash menu. Where the control sits is what it
  promises, so the section lands there too — at the end, never wherever the caret was
  left.
- **The handle is the promise a section makes.** It drags a whole thought, so it rides
  the section's edge and stays at rest until a pointer or focus reaches it. A handle per
  line would say the wrong thing about what moves.
- **A tablet is a phone with room, never a third layout.** If a tablet arrangement needs a
  component the phone does not have, the phone layout is what is wrong.
- **`ResponsiveModal` is the only modal.** Native sheet on iOS, bottom sheet on phone,
  centred dialog at ≥640px, from one bound `open`; `fill` is the full-height sheet a reading
  surface stands in below its dock width. Reserve bare `Dialog` for passive confirm/detail
  popups, never input surfaces.
- **Remove-empty chrome (hard rule).** A component renders only when it has something to
  do. An empty graph shows one line and one action, never a bare toolbar or "0 nodes".
  Loading uses skeletons shaped like the thing, not spinners.
- **On a coarse pointer the long press belongs to the app, not to the selection.** Touch
  surfaces carry `user-select: none` and no callout app-wide, so a long press can drag a
  node or open a row instead of raising the selection magnifier and a Copy / Look Up bar
  over the UI. Inputs and `contenteditable` are exempt. **Anything else a person should be
  able to copy has to ask**, with `select-text` (or `select-all`), which restores the
  callout with it — so a surface built for reading a node rather than editing one asks,
  and a canvas or a chrome control does not.
- Spacing varies for rhythm (section gaps > intra-section gaps); avoid uniform padding.

## The four inset vars

Bottom-edge chrome must clear the system nav bar, and the platform will not tell you how
on its own. **Android's WebView reports `env(safe-area-inset-bottom)` as 0** for the
3-button nav bar (unlike iOS's home indicator, which it does report), so the native shell
publishes the real inset itself via `tauri-plugin-safe-area-insets-css`, imported
native-only in the native `+layout.svelte` — it polls for Tauri, so it must never be
imported from web or app-core.

Three vars live on `<html>`, and a fourth mirrors them at the top:

- **`--safe-area-inset-bottom`** — the real OS bar height. The plugin publishes it and
  zeroes it while the keyboard is open; the `keyboard` store then OWNS it across
  transitions, caching the value from a quiet moment, clamping it to a plausible bar, and
  re-asserting it. Pad every bottom-pinned surface with
  `var(--safe-area-inset-bottom, env(safe-area-inset-bottom))`, **never bare `env(...)`**:
  WebKit ties `env(safe-area-inset-bottom)` to the keyboard, so a raw probe reads a
  keyboard-sized number and strands whatever padded by it.
- **`--kb-inset-bottom`** — how far a bottom-anchored element must lift to sit above the
  keyboard. **This is not the keyboard's height**, and it is 0 when WebKit pans the page
  instead of shrinking the viewport. Never decide "is the keyboard open" from it; that is
  the `keyboard` store in app-core, driven off the true occlusion.
- **`--sysnav-inset-bottom`** — the space the floating nav pill occupies, set BY the pill,
  so UNSET wherever the pill is hidden (the on-screen keyboard included). Use it only to
  clear the pill, never the OS bar.
- **`--app-chrome-top`** — the height of the in-flow chrome the shells render above the
  page, published BY that chrome, measured with a ResizeObserver. Every viewport-fit
  surface subtracts it, e.g.
  `h-[calc(100dvh-var(--app-chrome-top,0px)-env(safe-area-inset-top))]`. **Subtract it
  unconditionally** — the two shells gate chrome differently, so a route exempt on one is
  often not exempt on the other, and the fallback is the no-chrome height to the pixel.

`--reading-head` is the same bargain kept inside one surface: the reading panel publishes
how tall its own head stands, and the note under it sticks its own head below that rather
than beneath it. **The head is what it holds** — the strip across it, and whatever the
surface has to say about the note being opened — so the height is measured off that box
rather than assumed from the strip: a refusal drawn beside the strip and a height that
counted only the strip is a message painted over the way out of the note. It is unset
wherever the surface draws no head at all, so a note read on its own keeps its head at the
top of whatever is scrolling it — the fallback is that height to the pixel, which is why
every reader of it is written `var(--reading-head, 0px)`.

`--reading-dock-inset-right` is the same bargain turned sideways: the reading panel docked
beside the graph publishes the width it occupies, and what stands next to it subtracts that
width instead of drawing underneath — the page's own box, and the nav pill, which re-centres
over what is left rather than being taken away. Any full-bleed layer on a page that can be
docked beside — a drawn ground, a bar pinned across the foot, a card raised beside a mark —
is placed against that box, or it runs on under the panel while the page it belongs to stops
at the edge.

A composer riding above the keyboard uses
`max(var(--kb-inset-bottom,0px), calc(var(--safe-area-inset-bottom,env(safe-area-inset-bottom)) + 0.5rem))`
— the breath belongs INSIDE the bar term, since that term goes to 0 while the keyboard is
up and the lift can be 0 in the panned case.

## The canvas

- **Pen draws, touch pans.** `WKWebView` drives one input type at a time, which turns out
  to be a gift: `pointerType === 'pen'` inks, `'touch'` pans and pinches, and the gesture
  model falls out of the platform instead of fighting it. There is no mode toggle to find.
  Pencil Pro gestures (squeeze, barrel-roll, double-tap) live in `UIPencilInteraction` and
  are not exposed to the web layer — do not design an affordance around them.
- **Ink degrades, it never gates.** `getCoalescedEvents()`/`getPredictedEvents()` are
  feature-detected; without them a stroke is rougher, not unavailable.
- **The ownership line.** Svelte owns _which_ nodes exist and their initial geometry; pixi
  owns runtime pan/zoom/drag and reports back; the scene re-initialises only on an explicit
  `remountKey`. A plain drag never remounts, which is the difference between a graph that
  keeps its viewport and one that doesn't.
- **Level of detail is the design, not an optimisation.** A subtree past a depth threshold
  draws as one mega-node sized by descendant count; a tag selection lights the notes that
  carry it and dims the rest along with the genealogical edges. **Neither mode ever draws
  more than a bounded node count** — legibility and frame time are the same constraint here (PRODUCT.md principle 7).
- **The canvas is not a scroller.** Pan and zoom are pixi's; the scroll rules below do not
  apply to it, and it must never be wrapped in something that scrolls.
- **Pointing at a note says what it is, and that is all hover ever does.** A pointer resting
  on a mark raises a small preview beside it — the address, the title, the tags, and whether
  it carries a picture — after a moment, so a pointer crossing the field on its way somewhere
  else says nothing. It is placed clear of the mark and never over it — beside it, or above
  or below it where the box the graph has left is too narrow to have room beside — takes no
  pointer and no focus, and goes the moment anything else begins: a pan, a zoom, a drag, the
  menu, or a canvas somebody is picking or choosing on. **Nothing is ever reachable only this
  way.**
  Hover does not exist on touch and the phone is the primary surface, so a finger gets the
  tap that opens the note and the press that opens the menu, both untouched, and the canvas
  already writes the address and the title beside every mark big enough to carry them.

### The ground

The field is drawn on paper, and the reader says which: **dots, ruled lines, or neither**.
It is a ground rather than a layer of information — it carries no hue, no second weight, and
nothing drawn on it means anything. It owes no contrast floor for that same reason: it is
the one thing on the canvas a reader is meant to stop seeing.

- **It is pinned to the world, not to the screen.** A mark of it keeps the world point it
  sits on, so panning says how far you went and zooming keeps what you were looking at. The
  one concession is its period: closer together than 32 screen pixels it would close into
  moiré over a field of thousands of marks, so it **doubles** instead — which leaves every
  surviving point exactly where it was, the coarser lattice being a subset of the finer one.
- **The doubling is not seen happening, and that is measured rather than hoped.** The
  half-step marks fade in at exactly the rate their own count closes up — squared for dots,
  linear for rules — so the ink the lattice asks for per unit area is one number at every
  scale, and the same number either side of a doubling. And a mark keeps the size it is drawn
  at: a tiled fill's scale is what carries the lattice's period, and it would carry the mark
  along with it, so the pattern is cut at eight cells across the octave the period opens over
  and a fill takes whichever leaves it nearest 1:1 — a mark within 5% of its size anywhere in
  the range, with what is left of that taken back out of the alpha. `ground.test.ts` in
  `@sloppy/graph` holds all three: the 32-pixel bound at every scale the viewport can reach,
  the flat ink, and the mark. What a GPU rasterises out of a mark a pixel or two across then
  wanders as the lattice slides over the pixel grid, the way any stipple does. There is no
  step in it, and none at the doubling.
- **It is two tiled fills and nothing else.** One for the lattice a reader keeps as they zoom
  out, one for the half-step marks that fade into it; a frame writes their offset, their
  scale and two alphas, never a texture — the cuts are taken once, when a reader first asks
  for that paper. Its cost on the 2,400-note corpus sits inside the noise of the same passes
  with no ground at all: `bench/` reports idle and pan frames at 8.3/9.3 ms either way.
- **It is the theme's, and not `data-style`'s.** The colour is `--graph-ink`, so it inverts
  with the surfaces and no theme has to know it exists. It is deliberately not the style
  axis's: the canvas is exempt from `data-style` (above), and dots against rules is a choice
  about the field somebody is reading rather than about how the chrome around it is drawn —
  binding the two would mean choosing a hard edge on your buttons also chose your paper.
- **It is a per-device view preference**, kept beside the theme (§ Persistence), and never
  anything about the notes. A peer pulling a subtree receives nothing of it, because there is
  nothing there to receive.

## Scrolling (themed scroller + edge fades)

Scroll chrome is part of the theme, not the OS's. Both halves live in `@sloppy/ui`'s
`app.css` and apply app-wide; never restyle either per surface.

- **One themed scrollbar, everywhere, by inheritance.** The base layer sets every scroller
  thin (`scrollbar-width` on `*`) with a faint foreground-tinted thumb on a transparent
  track (`scrollbar-color` on `html`, inherited). WebKit pseudo-element rules cover the
  Tauri WKWebView shells; the `contrast` theme raises thumb contrast. New code needs **no
  class** — the global rule IS the scrollbar.
- **Hiding the bar is reserved for compact rails** (the tag rail, a chip rail). A rail that
  hides its bar MUST carry `scroll-fade-x`, because the fade is then the only "there's more
  this way" affordance.
- **Overflowing content dissolves at the parent's edges; it never hard-clips.**
  `scroll-fade-x` for rails, `scroll-fade-y` for capped vertical lists (the node's block
  stack, a picker), `scroll-fade-r` when the start edge is anchored content that must stay
  legible at rest. Tune depth with `[--scroll-fade:8px…2rem]`; cancel with
  `sm:scroll-fade-none` where the region stops scrolling.
- **Masks go on the inner scroller, never on the surface that owns the background.** A mask
  makes the element itself translucent at its edges — applied to a sheet or any
  `bg-*`-carrying container it lets the page bleed through. Structure as: opaque wrapper
  holds the background, inner child scrolls and fades.
- **Viewport edges use scrims, not masks.** `edge-scrim-t`/`edge-scrim-b` overlay the
  safe-area insets so content fades into the surface under the status bar and home
  indicator instead of bleeding through them.

## Forms (every mutating surface)

- **Superforms + Zod + formsnap**, with the schema imported from `@sloppy/types`. The form
  and the API validate the same object; a hand-written client-side check is a second
  contract that will disagree.
- **Capture demands nothing.** The one-gesture capture path has no required field — not a
  title, not a tag, not a parent choice beyond where the user already was. Everything
  else is a form the user can open later.
- **A tag is written by typing it.** Nothing is declared first and nothing is chosen from
  a list the person had to build; what is already in the graph completes as they type.
- **Publishing states its consequence at the moment of the decision.** What becomes
  readable, and what a peer keeps after an unpublish, is said there — once, plainly, and
  nowhere else in the product.
- Inline `Form.FieldErrors`; destructive actions use `AlertDialog`; toasts via sonner,
  brief and unexcited.

## Components

shadcn-svelte vocabulary, consistent across the app. Add via the CLI:
`pnpm --filter @sloppy/ui run add <component>`, which invokes `@sloppy/ui`'s
`"add": "shadcn-svelte add"` script. `run` is not optional — without it, `add` is pnpm's
own installer and quietly downloads an npm package named `<component>` instead. Until
`@sloppy/ui` exists, `pnpm dlx shadcn-svelte add <component>`. Don't hand-roll what shadcn
covers. Every interactive element ships default/hover/focus/active/disabled/loading
states. Empty states invite; they don't apologize. Icons: lucide, one weight.

## Motion

- **Chrome: 150–250ms, ease-out (quart/expo).** Motion conveys state — a sheet arriving,
  the nav pill hiding, a node collapsing into its mega-node — never decoration. No
  page-load choreography.
- **The layout settle is physics, not a transition.** It has no duration; it ends when the
  force simulation converges. Do not give it an easing curve, and do not block interaction
  on it — a graph that is still settling is still usable.
- **Ink is never animated.** A stroke appears where the pen is, at whatever latency the
  platform gives us. Easing applied to ink is lag with a nicer name.
- Honour `prefers-reduced-motion`: chrome transitions degrade to static, and the layout
  **jumps to its converged positions** rather than animating there. Reduced motion must
  never mean an unsettled graph.

## Persistence

A single client-side prefs store (`localStorage`, key `sloppy_prefs`) holds
`{ theme, accent, style, font }`, applied to `<html>` data-attributes as early as
possible (inline head script) to avoid a flash of the wrong theme. No account required;
choices carry over if someone signs in.

The same store holds the view choices that are nobody's business but this device's — the
tags the graph opens lit by, the ground it is drawn on (§ "The ground"), and how much room
a docked note was last given. None of them is an attribute on `<html>`, so none is a thing
the boot script has to know: the canvas reads them once it is up, and a first paint with
the right theme is all that flash-of-the-wrong anything is about. None of them reaches a
note either — a peer pulling a subtree receives nothing of how it was read.
