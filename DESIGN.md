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
appears on the node the moment it is created; the author of the region being read is
named across the top of it, not in a tooltip about federation.

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

The one thing that carries colour of its own is the picture an author put on their mark,
and it is a picture — imagery inside the disc, never a fill (§ "The mark"). It says nothing
about which sets a note is in, and every fill, edge and line around it stays monochrome
until a tag is selected.

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
  reading the answer against is the graph itself. So the dim is measured rather than
  chosen: every unselected mark gives up the same share of its own fill, and one that
  cannot afford the whole share gives up as much of it as leaves **1.6:1 against the
  ground it lands on** and stops there. That floor is not the 3:1 a mark owes. A dimmed
  mark is the negative half of an answer rather than a graphical object carrying meaning
  alone, so what it owes is the least that keeps it on the page — and a graph whose deep
  generations fade out under the question has answered by drawing a different graph. It is
  measured against the band a picture can put under a mark as well as against the paper
  (§ "The wallpaper"), so a wallpaper cannot take the unselected graph off the page either.
- Past eight selected tags the slots repeat. Eight questions at once is already more than
  the channel can carry, and the rail carries the written tag regardless.
- Every slot owes **3:1 against the surface** on every theme, because a node fill carrying
  meaning alone is a graphical object. Every slot also owes a minimum OKLab distance of
  **0.03 from every other slot** on the same theme — a palette whose slots have converged
  passes every contrast check and has quietly stopped being a language.

### Lightness — depth

Depth ramps between two ends the theme already owns: `--graph-ink` (the mark) and
`--graph-paper` (the ground). Root nodes sit at the ink end, and the far end is not the
paper but the faintest mark that still clears the mark floor on it — **the ramp divides
the range the theme actually has, in even steps, and carries as many of them as that range
holds 0.03 OKLab apart**, the same distance the tag slots owe each other and for the same
reason. Six steps is the most it will draw; where a theme holds fewer it draws fewer, and
a note deeper than the last of them draws in the last of them.

**That end is a stop, not a fade, and the drawn set does reach it.** Level of detail folds
by hops from the note the reader is standing on rather than by absolute depth (`lod.ts`),
so a reader working at the bottom of a branch routinely has generations past the sixth on
screen. A ramp that spent its range before its last steps would hand them all one colour
there — which passes every contrast check and has quietly stopped being ordered.

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

A pulled region keeps its author's addresses, and one author's graph is drawn at a time —
a peer's `1a` seeds where the reader's own does, so the two cannot share a canvas. While a
region is up, its author is named in the chrome above it and every act that would change a
note is gone. **Whose thought this is must never be a question the reader has to work out**
(PRODUCT.md principle 4) — so it is carried by shape, by a written label, and only
incidentally by anything else.

### A difference between two states

A person comparing two states of their graph has asked a question of it, so it is answered
where their questions are answered: **the notes the difference names are left as they are
and everything else dims**, by § Hue's measured share and down to the same 1.6:1 floor. The
shape of the graph survives the question here for the reason it survives the tag question —
what changed is only legible against what did not.

**The kinds are drawn in ink, never in colour.** Hue is the tag question's and stays it: a
reader looking at a difference can still ask which of these notes carry a tag, and a second
colour table would take that answer away from them. So a difference takes the orbit outside
the mark, which is the channel a comparison frees — picking and choosing are acts, and there
is nothing to act on in a state that is not now. Three values, and a mark is in exactly one:

| On the mark                   | Means                                                                   |
| ----------------------------- | ----------------------------------------------------------------------- |
| A closed band, mark inside    | it arrived — the later state has this note and the earlier one does not |
| A closed band, nothing inside | it went — drawn where the earlier state put it, with no mark to draw    |
| A broken band                 | it is in both states and is not as it was                               |

A note that went is the only mark on any canvas drawn as a band around nothing, so it cannot
be read as a hollow pulled mark: there is no mark inside it at all — no fill, no look ring
and no provenance edge, because each of those is a channel on a mark and there is no mark to
carry them. **Where there is a mark, provenance keeps its own edge**, as it keeps it through
everything else: the band is in the orbit, outside the mark, so a note that arrived and a
note that is not as it was are drawn pulled or not exactly as they are anywhere else.

**A move is a fact about a line, and is drawn on the lines.** A note that changed parent did
not itself change; the run line it hung from did. So the line to the parent it left is drawn
as gone and the line to the parent it joined as arrived, in the same ink the marks are, and
the note at the end of them takes the broken band only if its writing changed too. Those two
lines are the one thing on the canvas that says WHERE a note went rather than that it moved.

**Both move lines are solid, and they separate on ink alone** — the line the note joined at
the difference's full ink, the line it left at a little under half of it. Never on the break:
§ Edges reserves that for the single fact that a hand made a line, and a second broken kind
would put a move and a hand link in one shape. Ink is the channel left, and the right one —
§ Edges climbs its three solid kinds on lightness as well as width precisely because width is
clamped as a field zooms out, so ink is what a reader still has when every line is the same
hairline. Both sit above a field receded as far as selecting recedes it, so the two lines a
difference draws are the loudest thing on the page.

**What changed about a note is written, not drawn.** One note can have moved, been renamed,
been given another address and had three sections rewritten between two states, and one mark
cannot carry a set — the same reason a note carrying several selected tags draws in one hue.
The mark says a note is not as it was; the panel beside it says how, in words, section by
section.

**The dim has one strength and never doubles.** Comparing two states with tags selected is
two questions at once, and a note outside both answers is not dimmer than a note outside
either: the floor is what keeps the graph on the page, and two shares taken off one mark go
straight through it.

**Nothing in the picture names the four kinds, so the surface around it must.** A band closed
round a mark, a band closed round nothing, a broken band and the pair of move lines are four
meanings a reader cannot learn from the canvas. The legend that teaches them is four rows with
no colour swatch in any of them, and it belongs to the surface that asked for the comparison —
`@sloppy/graph` builds no chrome.

All of it survives the four axes because it is drawn from `--graph-ink` and spends no hue,
exactly as the lift is (§ "The mark"): it inverts with the theme, it survives greyscale and
full zoom-out, and no theme, accent, style or face has to know it exists.

### The mark — five meanings on one small disc

A note is one small mark, and five separate things have to be readable off it: where the
thought came from, how its author asked it to look, whether it is one of the notes a link
is being pointed at, whether it is one of the notes somebody has chosen to act on, and
whether it is one of the notes open in front of the reader. Each gets its own channel.

| Channel on the mark                            | Carries                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| Fill hue                                       | the selected tags (§ Hue)                                                      |
| Fill lightness                                 | genealogical depth (§ Lightness)                                               |
| Fill alpha                                     | carries none of the selected tags (§ Hue)                                      |
| **Its own edge** — present, and whether broken | provenance (§ Form)                                                            |
| **A ring inside it** — weight, and how broken  | the author's look                                                              |
| **A dot on its rim**                           | the code under it has moved since its author read it                           |
| **Its radius**                                 | how much is folded into it, times the size its author asked for                |
| **The disc's imagery**                         | the author's picture, or a few taking turns, at the share of the disc they set |
| **The orbit outside it**                       | the mode the canvas is in — picking, choosing, or comparing two states         |
| **The paper under it** — how far it lifts      | this note is open, and whether it is the one being read                        |
| **Which field it stands in**                   | which graph it is in (§ "Several graphs on one canvas")                        |

Thirteen rulings hold that table together:

- **Provenance keeps the mark's own edge, and a look draws INSIDE the mark.** Both want a
  ring and both want to be broken — a pulled region is dashed, and a draft is dashed — so
  they separate by radius rather than by which of them gets to be dashed. A pulled draft
  is two dashed rings at two radii, and reads as two facts. Provenance is the one that
  must never be a question the reader works out (PRODUCT.md principle 4), so it is the one
  that does not move. **The look's ring has more than one way of being broken, and they
  separate by how much of the ring is missing rather than by how finely it is chopped.**
  A mark is tens of pixels wide and its ring is a fraction of that, so a style told apart
  by dot density is a grey haze at the size the look is still drawn at — where two styles
  cannot be told apart on the smallest mark that carries one, the second is a row in a
  picker rather than a look. What survives is the count of gaps and their width: whole,
  one gap, a few, and ticked all the way round. `LOOK_RING_BREAK` in `model.ts` is what
  each is drawn as, and `scene.test.ts` holds them apart on a mark at the threshold.
  **The cost is charged in cells:** the sheet every mark is cut from holds one per ring
  weight AND style, so a style widens it for everybody — the reason the set is short.
- **The code having moved takes a dot on the rim, because it is the one shape left that is
  not a ring.** § "What the code left behind" rules that it is drawn at all, and why; what
  the mark decides is where. Rings here separate by radius, and the sheet every mark is cut
  from holds a cell per ring weight AND style — so a third ring widens that sheet for every
  mark on every canvas in order to say one bit, which is more than the fact is worth. A dot
  costs one shape. It is a single small disc centred ON the mark's own edge, due south,
  drawn from `--graph-ink` and spending no hue: straddling the edge makes it an addition
  rather than an absence, so it cannot read as a break in the provenance edge; one dot at
  one bearing is not a band, so it cannot read as the orbit picking, choosing and comparing
  put there; and it sits outside the look's ring, at a radius nothing else reaches. It is
  drawn over the chosen band and over the lift, both of which it stands inside, and **it
  goes when the look goes** — at the size three concentric strokes stop reading as three, a
  dot on the rim is a smudge, and a reader that far out asks this through the sheet and the
  highlight instead.
- **Picking and choosing share the orbit outside the mark**, because a canvas is in one
  mode or the other and never both: you are picking the note a link points at, or you are
  choosing notes to act on. They are still drawn apart so nobody has to know that —
  **picking outlines, choosing fills.** A hairline ring in the orbit is a note already
  linked and a heavier one is the note being linked from; a solid band in that same orbit
  is a note in the chosen set. The chrome names the mode; the mark says membership.
  **Comparing two states is a third mode of the same kind**, and § "A difference between two
  states" is what it draws in that orbit — a state that is not now is not a thing anybody can
  act on, so nothing is being picked or chosen while a difference is up.
- **Radius is the one channel two meanings share, and the fold does not hold it alone.**
  A radius says how much thought is folded into a mark, and a look scales that rather than
  replacing it — the two multiply, so a fold is always bigger than the note it collapsed and
  a mega-node its author sized up is bigger than the same fold left alone. What the size
  channel costs, past its middle, is the glance: a leaf an author grew can reach the size a
  small mega-node draws at, so a big mark stops proving a fold. **The count was never the radius's
  to say and still is not** — it is a logarithm of it, readable only against a neighbour,
  while the number itself is written on the mark (`1a +12`) and a tap on a fold opens it
  where a tap on a leaf opens a note. So what the reader loses is an inference that was
  already approximate, and what the author gains is the channel a person actually reaches
  for to say this one matters.
- **The cap is the fold's, and the author spends theirs on top of it.** A fold's growth has
  no natural end — a subtree can hold anything — so it is capped, which is what stops one
  mega-node eating the field. What an author sets is bounded at both ends by hand, so capping
  it again would only take back what somebody deliberately asked for: **bigger always draws
  bigger**, at every fold, which is the whole of what the control is. The largest mark any
  canvas draws is therefore the fold's cap at the top of that range. **What the top costs is
  charged where it is spent.** The shapes are one sheet every mark is a scale of, cut at the
  density of the screen in front of it times the zoom, in a few steps — so a pinch crosses a
  step now and then rather than recutting every frame, and the smallest texture a phone's GPU
  is guaranteed to hold is what bounds the densest step. **The handful of marks past what that
  step holds are drawn as shapes for the frame rather than stretched**, so nothing on the
  canvas is enlarged by more than a quarter, at any zoom, on any screen: a mega-node its
  author sized up, held at full zoom on a dense display, is the case it is for. A picture is a
  texture per mark, so it is cut for the mark that wears it and the screen it is drawn on, and
  a leaf never carries what the largest needs — a phone holding hundreds of pictured marks is
  what that difference is for.
  **The size is one continuous channel, dragged, and its ends are `0.78` and `2.4`.** A
  handful of words cannot hold a channel like this: the size somebody wants is usually
  between two of them, and no amount of picking reaches it. So the words are the COARSE way
  of spelling the same channel rather than the channel itself — `small`, `regular`, `large`,
  `huge`, `giant` are worth `0.78`, `1`, `1.34`, `1.8`, `2.4`, a number says the same thing
  finely, and a note carrying both is drawn at the number, because that is the one its author
  dragged. What each word is worth is frozen for the reason an address is: a mark that
  redrew itself when the numbers behind the words moved is a graph somebody else has already
  read.
  Moving the cap under the look is what makes the control this, and it moves what every
  existing graph draws: a mark set small over a large fold shrinks by the same factor one set
  large grows by.
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
- **A picture may grow until it is the mark, and what bounds it is the disc it is drawn
  on.** How much of the disc the imagery covers is a channel its author spends, dragged the
  way the size is, so a picture can be the whole face of the mark rather than a dot in the
  middle. The ceiling is where the fill itself stops, a hair inside the mark's edge: past
  that a picture would spill outside the mark, and no author asked for that. **What the
  picture may cover on the way there is the author's own, including their own ring.** The
  ring is drawn UNDER the picture, so a cover taken past it takes it — the author asked for
  their picture and got all of it, and a ceiling drawn short of that would be Sloppy deciding
  an author may not. Somebody who wants the ring back drags the cover in, which is the
  control they were already holding. **The hue band is
  spent as well, and that is the honest cost**: the fill outside the picture is where the
  reader's own question is answered (§ Hue), and a picture dragged all the way leaves none
  of it. Nothing else on the mark moves — the tags still dim what carries none of them,
  and the answer to "which of these did I select" is still there in every mark whose author
  did not spend it. **Provenance is not the author's to spend**, and does not have to be
  reserved: its edge is drawn over the picture, so a mark stays readable as own, published or
  pulled at every cover. That is the whole of the order — the author's ring under their
  picture because it is theirs to cover, the graph's word over it because it is not. `PREVIEW_COVER_MIN` and `PREVIEW_COVER_MAX` in
  `@sloppy/types` are the ends, `PREVIEW_SIZE_COVER` beside them is what the words a cover
  may also be spelt in are worth, and `scene.test.ts` holds the top against the disc
  `scene.ts` cuts. **What a picture is STORED at and
  what a mark DRAWS it at are two different budgets, and confusing them is what makes a
  picture go soft.** A picture is cut once, when somebody chooses it, and it is cut for the
  largest mark that look could ever become — the widest mark at the fold's cap, covered
  whole. That is bytes spent once, and it is what makes both controls safe to reach for:
  **they and the picture button are the same modal**, so
  adding a picture and then growing the note is the ordinary order, and a cut made for the
  size the look happened to be at that moment would leave the picture permanently soft with
  nothing said and nothing to do about it but choose the file again. Widening what a picture
  may cover therefore widens what EVERY picture is stored at, in proportion, and that is the
  price the ceiling is worth paying at rather than a detail of it. What the phone holds is
  the other budget, and it is answered separately: the texture a mark decodes is cut for the
  mark that wears it, so a leaf never carries a mega-node's pixels however large the stored
  picture is. **A mark may wear more than one, taking turns the way the ground under it
  does** — § "A picture that takes turns" is the model both read, and every picture in a
  series is cut and sized the same as the one before it, because the size is the mark's
  channel and not any one picture's.
  A picture stored under an older build's constant is one an enlarged mark draws softer
  rather than refuses.
- **Where an author spends both, the ring is drawn on the picture, not around it.** A solid
  heavy ring over a picture dragged past it is a line across the imagery; a broken one shows
  the picture through its gaps, and how much shows is which style they chose. Both are the
  author's, and neither is the picture failing to act — an author who wants every pixel of
  the picture has a lighter ring, or none, and none is what a note draws with nothing set.
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
- **Which graph a mark is in takes the one thing no meaning on the mark had: where its
  field stands.** Every row above spends the disc itself or the ground touching it, so a
  mark drawn in a second graph is drawn identically — the same fill, the same edge, the
  same ring, the same radius — and what says which graph it is in is that it stands in
  that graph's field, with that graph's name written over it. § "Several graphs on one
  canvas" is the section.

### Several graphs on one canvas

A person keeps a graph per body of thought, and puts more than one up at a time to work
across them. Each one is drawn as a **field**: the same shape it has alone, laid out
beside the last rather than over it.

- **A field's place is what tells it from the next, because place is the only channel
  nothing else had spent.** Within one graph, where a mark sits is the address's
  (`geometry.ts`), and that is untouched: the whole field moves, and every mark keeps the
  place its address gave it inside it. Two graphs each holding a `1` seed the same point,
  so without this they would be drawn on top of each other — the gutter between fields is
  what stops them. `model.test.ts` in `@sloppy/graph` holds both of those: a mark keeps
  the place its address gave it, and no field is seeded inside another's span. The force
  pass afterwards is not held to the gutter — a field of a few hundred notes spreads
  wider than one — so what keeps the fields apart on screen is where each one's weight
  settles, not a line no mark ever crosses.
- **The field being read never moves.** Fields are laid out in the order the reader put
  them up, from the first, so standing another graph up beside the one in front of you
  does not shift the one you were reading.
- **A graph's name is written over its field, and only where there are several.** With one
  graph on the canvas there is nothing to tell apart, so the name lives in the chrome and
  the canvas carries none. The name is quiet ink rather than a mark — it says which field
  this is and nothing about any note — and it holds the top of the screen while the reader
  is inside its field, the way § Form names a region's author in the chrome above it.
- **Where the reader's field arrangement is kept is this device's** (§ Persistence), like
  the ground and the theme. It is not the addresses: nothing about it reaches a note, and
  a peer pulling a subtree receives nothing of it.
- **A pulled region is still one graph at a time.** § Form's rule holds — a peer's `1a`
  seeds where the reader's own does — and a held region is never one of these fields,
  because a field is a graph the reader themselves keeps.
- **Where a graph is a folder on the device, the picker's rows are folders.** A person can
  hold one graph in two folders — a copy brought from their own host beside the original —
  so a row is the folder it is: the folder's own name sits under the graph's name wherever
  two rows share a graph, and the row marked as the one you are in is the folder that is
  open rather than whichever row carries its ref. A row that cannot say which of the two
  folders it means offers none of the acts a graph is named by; opening it and forgetting it
  are still offered, because those are the folder's own. **Forgetting is that row's one
  removal**, and it deletes nothing: the folder stays where it is with everything in it.

### A note's look never uses colour

Every channel a look may spend is shape or imagery: ring weight, how the ring is broken,
how big the mark is drawn, the pictures the mark wears, how much of the mark they cover,
and how one gives way to the next. There is no colour picker on a note, and a build that
grows one has grown a bug.

Hue here is the reader's own question — the tags THEY selected, in the order they selected
them — and it has to stay legible across a graph pulled whole from somebody else, styled
by an author the reader never met. A note carrying a colour of its own would answer a
question nobody asked, in the one channel reserved for the question they did.
`NodeAppearanceSchema` in `@sloppy/types` therefore carries no colour field at any level.

The VALUES those channels take are an open set, for the same reason the element kinds
inside a block are: a look this build has no renderer for is stored and handed back
untouched, and draws meanwhile as an unstyled note does. Adding a look is a value; adding
a channel is a change to the table above. **A channel that is a NUMBER is open the same
way and falls back differently**: a size or a cover past the range this build draws is
stored untouched and drawn at the nearest end of that range, because the widest mark this
build has is nearer what its author asked for than a mark with nothing set.

**A look's shape travels to a peer and its pictures do not.** Ring weight, ring style and
size are plain shape, so they ride on `PublishedNode.look` and a held region draws the marks
the way their author shaped them. The pictures stay behind: each is an upload in the
author's own private store, which docs/ARCHITECTURE.md § "Pictures" owns as an open gap, and
a mark that could not load one draws exactly as a mark with none — so a peer reads a shaped
field of discs wearing no pictures, never a gap where one was promised. A note published
before a look could travel carries none, and draws unstyled.

### Edges

Four kinds of line cross the canvas, and which one a reader is looking at has to be
answerable at a glance. Hue is not one of the channels that answers it — that belongs to
the tags (§ Hue) — so they separate by weight, by lightness and by whether the line is
broken.

| Edge                                             | Drawn as                                           | What it says                          |
| ------------------------------------------------ | -------------------------------------------------- | ------------------------------------- |
| **Genealogy** — parent to child                  | the depth ramp, thinnest, lowest alpha, solid      | this thought sprang out of that one   |
| **A reference** — `references`, from the writing | ink, solid, a middle weight and lightness          | this note's own words name that one   |
| **A link** — `links`, drawn by hand              | ink, broken, at a reference's weight and lightness | somebody put these two together       |
| **The run** — consecutive addresses              | ink, solid, the heaviest and darkest line drawn    | this thought carries on from that one |

**The canvas draws three of those four.** `model.ts` in `@sloppy/graph` still builds one
`connection` out of `links` and `references` together and `scene.ts` strokes it broken, so a
note's own words currently read as a line somebody drew by hand — which is the one thing the
break is supposed to mean. `EDGE_KINDS` in `@sloppy/types` is the vocabulary that tells them
apart; nothing reads it yet. Splitting the two is what the table above is a ruling for.

Seven rulings hold that table together:

- **The three solid kinds are three steps of one ladder, and they move on both channels at
  once.** Genealogy is the depth ramp at the thinnest line and the faintest ink; a reference
  is ink a step heavier and a step darker; the run is heaviest and darkest. Both channels
  rather than one because a line's width is clamped as a field is zoomed out — past a point
  every line on the canvas is the same hairline — and the reader who has lost the width still
  has the order. The two lines a person made are drawn over the two the addresses make, so a
  crossing never hides the rarer of them. `scene.test.ts` and `palette.test.ts` in
  `@sloppy/graph` owe that order at every scale the viewport reaches, and the figure each
  step takes is a target until they hold it.
- **The break says how the line was made, and it is the only thing that says it.** A hand
  drew it, and a hand is what takes it away. Every other line on the canvas comes out of
  something the note already holds — what it sprang from, or its own words — and those are
  drawn whole. So a broken line between two marks is exactly one fact: a hand made it.
- **Genealogy is everywhere, so it recedes.** The run is the line a reader walks —
  `1 → 2 → 3`, `1a → 1b` — so it is the one that carries weight, and it is **derived from
  the run's own order, never stored** (AI.md § "The Genealogy Is the Protocol"): the address
  leads that order where a note has one, and the two notes either side of a deleted one still
  read as consecutive, because they are.
- **A reference is solid, because it is the note's own words.** Typing `[[X]]` is the author
  saying inside the thought itself that this note and that one go together — a statement of
  the same kind the address makes, and drawn whole for the same reason. A reference that drew
  nothing would leave the two notes reading as strangers on the one surface whose whole job
  is to show what is connected to what. A hand-drawn link is that statement made beside the
  note rather than in it, and it is the broken line.
- **Two ways of making a line, and they end differently.** A note carries both, and which one
  made a line is what says how it goes away:
  - **`links`** is drawn by hand and removed by hand. Nothing anybody writes adds one, and
    nothing they write takes one away.
  - **`references`** is derived from the note's own writing and follows it. Typing `[[X]]`
    makes the line; deleting those words takes it away, because there is nothing left to
    derive it from.
- **A pair draws one line, and it is the strongest thing true of it: a hand link, then the
  run, then a reference, then parentage.** A pair may be all four at once, and the reader is
  being told the pair is connected rather than shown an inventory of the ways it is.
  - **The hand leads, because a gesture the canvas swallowed is a gesture lost.** Somebody
    reached for the ⋯ menu and asked for a line; if the pair were already joined and nothing
    changed, the act would have no answer on the surface it was made on.
  - **The run beats a reference, because nobody drew anything by typing.** `[[1a]]` in `1b`
    is a note naming its neighbour, and the two are already joined by the heaviest line
    there is — the one a reader walks. Trading that for a line that reads like any reference
    across the tree would make the run patchy exactly where a train of thought carries itself
    forward, which on a Zettelkasten is the common case and not the exotic one. The citation
    is not lost: it is in the writing, where it was made.
  - **A reference still beats parentage.** Citing the note a thought sprang from is ordinary,
    the tree's own line is the quietest thing on the canvas, and there the citation is the
    rarer fact and the one worth the line.
  - So taking one way away leaves the line and may change how it is drawn: take the hand
    link off a pair the writing also names and the line closes up from broken to solid;
    delete the `[[X]]` from a pair a hand linked and nothing moves. Each way still ends
    independently, and the line goes when the last of them does.
- **What a connection never does is move them.** How far apart two notes sit is the
  addresses' to set, so a connection onto a line that is already there takes that line's look
  and leaves its spacing alone.

**A reference does not reach a peer yet, and a pulled region draws only what a hand drew
there.** `PublishedNodeSchema` carries `links` and no `references`, so a note somebody
pulled shows the connections its author made by hand and none of the ones its writing
makes — fewer lines than the same writing draws on the author's own canvas, and every one
of them broken. The publishing milestone owns closing that, and the reason it is not free is
the same one that bounds every ref a published node carries: what a peer may be shown is
bounded by what they may follow, and docs/ARCHITECTURE.md § "Federating the graph" owns that bound.

**With tags selected, genealogy and the run both dim**: the reader has asked to see sets,
and the tree is momentarily the background. **A reference dims with them, and a hand link
does not.** A reference is solid, so it sits on the same ladder of weight the addresses'
lines do and would read as the darkest thing on the canvas if it stayed while they stepped
back. A hand link is broken, is on no ladder, and is the one line somebody made on purpose —
the canvas swallowing it the moment a tag is ticked would take back the whole reason it
leads the order above.

#### A look a person set

Everything above is how a line is drawn when nobody has said otherwise, and that is what
almost every line on almost every canvas is. A person may set a look on one line, and it
wins only on the channels it names. Three channels, and nothing else moves:

| Channel         | Absent                                  | Set                                                      |
| --------------- | --------------------------------------- | -------------------------------------------------------- |
| **`stroke`**    | the break the line already has          | `solid`, `dashed` or `dotted`, whatever kind the line is |
| **`direction`** | no arrowhead, which is every line above | an arrowhead at the far end, this end, or both           |
| **`label`**     | no words on the line                    | the words, as a caption at the line's middle             |

- **`stroke` overrides the break, and only the break.** The break otherwise says how the
  line was made — a hand drew it — so a hand link a person drew solid is solid and says
  nothing about how it was made any more. That is the point: they said so on purpose, and
  the canvas swallowing it would be the same gesture lost the break rule is written against.
  The weight and the lightness are NOT a channel, so the ladder of the four kinds survives
  every look anybody sets, and the line still reads at the depth it belongs to. `dotted` is
  a third texture beside `dashed`, drawn at the same weight.
- **An arrowhead is drawn in the line's own ink at the line's own weight**, and is clamped
  as the width is: a field zoomed out far enough draws hairlines, and an arrowhead that
  stayed its size would be the loudest thing on a canvas of them. It is a mark ON the line
  and never a second colour — hue belongs to the tags, here as everywhere.
- **A label is a caption, in the caption face the canvas already uses for marks**, bound to
  the line's midpoint, and held to the same level-of-detail rules a mark's caption is: it
  appears when there is room for it to be read and is not drawn when there is not, which is
  what keeps a field of labelled lines from turning into a wall of text at any zoom.
- **A look dims with the line it is on.** Ticking a tag dims genealogy, the run and
  references (above); a look set on one of those dims with it, arrowhead and label
  together, because the look is how that line is drawn and not a separate thing over it.
- **A look moves no mark.** The distance between two marks and the sector a subtree
  radiates into are the addresses' and the genealogy's. Setting a look changes how a line
  is drawn and nothing about where anything sits — docs/ARCHITECTURE.md § "A look a person
  set on a line" carries the storage side of that.
- **A look draws on the line that is there, and on nothing where there is none.** Two notes
  with no line between them stay two notes with no line between them, however carefully
  somebody has described one.

### Contrast is measured, not assumed

Ratios in this document are targets until a test holds them. `token-contrast.test.ts` in
`@sloppy/ui` is the file of record, and it runs: it sweeps every theme × accent and every
theme × facet-slot pairing, measures on the **quantised** colour (both sides converted to
sRGB and rounded to 8 bits per channel, which is what a screen actually paints), and holds
the 3:1 mark floor and the 0.03 separation floor — on `--background`, `--card` and
`--popover` alike, because most marks are not drawn on the page. It reads the tokens out of
`app.css` itself; a table of them beside the stylesheet would be a copy that drifts.

One accent needs a correction today, and only one: Ochre on the light family reads 2.90:1
as a solid mark on Paper, so `--primary-mark` moves it in lightness alone, and `--ring`
reads from `--primary-mark` so the focus ring inherits the same correction. Every other
pairing is handed back its own colour untouched.

**A floor this file does not name is a floor nothing measures.** Small accent TEXT owes
4.5:1 and no member of the mark family reaches it — the mark floor is for graphical objects
and large text.

A figure quoted anywhere in this repo without a test behind it is a target, and should say
so.

## Whose writing

A note can carry more than one person's writing, and somebody reading it should be able to
tell whose without asking. It is said in words, in the chrome above the note, because a set
of people is not a thing one mark can carry — the same reason a note in three selected tags
draws in one hue. **The canvas is untouched by any of this**: no channel on a mark says who
wrote a note, and a build that grows one has spent a channel on a question the reader did not
ask.

- **The note says who wrote it, plainly.** "Written by A and B" where more than one person
  has, "with C" after it where somebody's offer was taken in. One person who wrote their own
  note is the ordinary case and reads as it always has — an author's own graph does not
  announce the author on every note.
- **Its details say who gates it, and let the right person change that.** An open note says
  nothing about gating: a line about something the product is not doing to you is worse than
  silence. A note with an owner says so, and only the graph's owner and the note's own owner
  are offered the control.
- **An owner's note says how many changes are offered on it**, as a count beside the note,
  and it does not move, animate, badge or grow a dot. It is a fact the person can act on when
  they like, not a thing asking to be cleared.
- **Where a change cannot be offered at all, the note is read rather than half-written.** A
  graph served over a network has one writer, so a note somebody else writes opens as theirs:
  the writing is there to read and not to type into, one sentence says whose it is, and the
  graph's own owner is told where that changes. Nothing offers an act that would have nowhere
  to land.
- **A contributor's save on an owned note says what happened, in outcomes** — offered to
  whoever owns it, and it shows once they take it. Nothing about rows, offers standing, or
  what the request did: the person needs to know their writing is somewhere and what has to
  happen next, and that is the whole of it. The offer standing in their name stays theirs to
  read, write again and take back, so nobody has to remember what they proposed. While they
  write, the line under the writing says it is kept here until they offer it, and never that
  it is saved: the note has not changed.
- **The owner reads an offer as a difference**, note against offer, section by section, in
  § "A difference between two states"'s own language — no second vocabulary for the same
  question. Taking it in is one act on the whole offer; there is no picking a section out of
  one, and the surface does not imply there is.

Quiet throughout. Nothing here counts contributions, ranks writers, thanks anybody or marks
an offer as waiting. A thinking tool does not nag, and it does not keep score of whose
thinking it is.

## The history as a picture

A person who keeps their graph in more than one place has a second shape to read: not the
graph, but the states it has been in and the lines they run along. It is drawn on the
History surface, and it is a picture rather than a list because branches are a shape — where
one left another and where they came back together is not a thing a column of rows can say.

**It is a table, one dense row per version.** The lanes, then the message with the branches
at it beside it, then when it was kept, who kept it, and the short name it is cited by. A
branch kept here is a chip with a border; one kept somewhere else, which the history spells
`origin/main`, is drawn dashed, so where a branch lives is read from form rather than from a
second colour (§ "The graph's colour language"). The version the folder stands on is an open mark on its
lane, and a version nobody is at is a filled one and nothing more.

**Lanes are drawn in hue, and this is the one surface outside the canvas that spends it.**
Which of a dozen lines a row belongs to is the question this picture exists to answer, and
over hundreds of rows ink weight cannot carry it — a reader following one line down the page
has to be able to see where it went. So a lane borrows a slot from the same eight the canvas
lends a selected tag (§ "Hue — the tags you selected, and only those"), taken by lane rather
than by branch, wrapping onto the first once a page runs past eight. Each slot is measured to
3:1 against every surface on every theme in `token-contrast.test.ts`, because a lane carries
its meaning alone. **A branch's identity is still its label at its head, not its hue** — the
hue says which lane, which is why spending it teaches nobody a legend to hold, and a line
that ends hands its hue back to the next one that starts. Nothing about the canvas changes:
there, still, nothing is coloured until the reader selects a tag.

**Newest at the top, paged, and a commit never above what it springs from.** That order is
the contract `graph()` answers on, so the picture is drawn from what it is handed rather
than sorted again on the page. Which lane a version falls into, and the curves that fork out
of it and come back together at it, are Git Graph's (mhutchie/vscode-git-graph, MIT),
reimplemented in `commit-lanes.ts`.

**Phone first, which means the trailing columns fold and the lanes stay.** Where there is no
room for four columns beside the lanes, when it was kept, who kept it and its short name drop
to a second, quieter line under the message. The lanes and the labels never drop: the shape
and the name at a head are the two things somebody opened this to read.
Tapping a commit opens its details as a sheet (§ Layout, the one modal): the message, who
made it, whether it is signed and by which key, what it springs from, the branches at it,
and the acts — read the graph as it was, compare it with now, branch from here, switch to a
branch at it.

**Every number is the distance from the place in front of you.** Where a folder is kept in
more than one place, the picker over those acts opens on the one the line the folder is on
follows, and ahead, behind and what an act comes back saying are all measured against the
place that is picked — against the line it follows there, which need not share its name. A
place this device has not heard from is left unsaid rather than drawn as a zero: nothing
waiting and nothing known are two different answers and only one of them is safe to act on.
**The picture is the folder's, not the line's** — it draws every head, so it stands wherever
any line holds a version, including where the one in front of you holds none yet.

**The branches panel is a list, because a branch is a name and a number.** Local and remote
ones together, the current one said plainly, how far each is ahead and behind, and merge or
delete beside every one except the one the folder is on: that one says it is the one being
worked on and is offered neither, because an act that could only be refused is not an act to
offer. Nothing here is decorated: a history is read to answer a question, and the answer is
words and lines.

## Reading a draft

A chat with an agent works in a **draft** — a copy of the notes it writes into, standing
apart from the folder in front of you until you have read it. Nothing it does appears on
your canvas while it runs, nothing interrupts you to ask, and what you are eventually asked
is one question about finished work: **take it in, or throw it away.**

**The whole surface is a difference, so it is drawn as one.** § "A difference between two
states" already says how two states of a graph are read — the notes named are left as they
are and everything else dims, arrived and gone and changed are three bands in ink, a move is
two lines — and a draft is exactly that comparison with the draft on one side. A second
visual language for the same question would be a second thing to learn for no second
meaning.

**Beside the canvas, a list, because what changed about a note is written and not drawn.**
One row per note, in this order and no other: **what you would have to settle first**, then
what is new, then what was changed, then what moved or was renumbered or retitled, then what
went to the bin. Each row is the note's title, the number where it has one, and one line
saying what happened — the same line the chat said as it happened, read again. Nothing is
counted twice: a note written into and moved is one row saying both.

**A row opens the note as the draft has it**, in the reading panel, where a note is always
read. It is not an editor: this is somebody else's writing until they take it in, and an
edit made here would be an edit to a copy that is about to stop existing. The note your
folder holds is one tap away beside it, because the question a reader actually has is what
is different.

**A conflict is the only thing that stops a merge, and it is the choice you already know.**
Where your own copy of a note changed while the draft was running, you are handed the same
mine-or-theirs it has always been — whole note, or section by section, or which note keeps a
number — from § "A difference between two states"'s vocabulary and the import's. Every one
settled, and the merge is one act.

**Phone first, and the shape falls out of that.** On a phone the review IS the panel: a full
sheet of rows, the canvas behind it, a row opening the note over the top, and one bar pinned
to the bottom holding both acts and clearing the system nav (§ "The four inset vars"). Given
room, the list sits beside the canvas as the reading panel does, and nothing moves to the
desktop that was not on the phone.

**Two acts, both plain, and one of them is not red.** Merge and discard sit together; discard
is the quiet one and says what it costs in words rather than in colour, because a draft is
work you asked for and throwing it away is an ordinary choice rather than a warning. There is
no third act: a draft is taken whole or not at all, and a person who wants half of it says so
to the agent and reads it again.

**A standing draft is said once, quietly, where the chat is.** Not a badge, not a count on
the canvas, not a nag: a line at the head of the chat saying a draft is standing, with going
on with it, reading it, or throwing it away. It is still there tomorrow, and the line reads
the same then.

**The words are draft, review, merge, discard, version and kept.** Never branch, never a
commit, never a checkout, never a conflict marker — AI.md § "User-Facing Copy Names the
Outcome". The history surfaces say "branch" because a branch is what a person is looking at
there; a draft is not one of those surfaces.

## An anchor into code

A note that explains a piece of code is read next to it, and the whole point of writing one
is that somebody comes back to it later and can tell whether it still holds. Two things carry
that on the note, and neither of them is a badge: a link that goes somewhere, and one quiet
line when the code under it has moved.

**An anchor is a chip in the writing, not a panel beside it.** It sits inline where the
sentence names the file, reads as the path's last part with the line or the name after it —
`parser.ts · L12-20`, `history.rs · discover` — and carries a small leading mark so it is not
mistaken for a link to a page. It draws in the body face at the body size, in ink and not in
hue: the graph is where colour lives (§ "The graph's colour language"), and a note that
points at four files must not read as a control panel. A path this checkout has not got draws
exactly the same, because what a person wrote is still what they meant.

**Tapping one opens the code as a sheet** (§ Layout, the one modal): the path along the top,
the lines or the run around the name, and the acts — copy the path, and open the file where
the person opens files. It is a reading surface, so it is monospaced, scrolls in one
direction and offers no editing: Sloppy does not write in somebody's repository.

**"Still true" is one act, and it says only what it does.** It sits on the note, not on each
anchor, and taking it records that the note's reasoning has been read against **every** place
the note points at, as those files stand now — one act, because a person reads a note
against its code and not against one file of it. Nothing else happens: no section changes,
nobody joins the note's authors, nothing moves. A note nobody has confirmed says nothing at
all — **unread is not stale**, and a product that nags somebody about a note they wrote this
morning has made a chore out of thinking.

**When the code has moved, one quiet line for each file that has, under the title.**
"`src/parser.ts` has changed since you read it", in the note's own ink, with "Still true"
beside the lines — one act for the note, because the reading is the note's. Each line names
its file, so a note pointing at four files never says only that something has moved. The
lines sit under the title rather than under a chip because a reading outlives the sentence
that named the file: the note may not point there any more, may name it twice, or name it in
the middle of a paragraph a line cannot interrupt. A note whose code has all stood still
shows no line anywhere: silence is the ordinary state of a note that is fine, and so is a
note nobody has read against the code yet — that says nothing either, and never "up to
date". Where the project is not open beside the notes, nothing is worked out and no line is
drawn.

**The words name what happened, never how it is known.** "Changed since you read it",
"Still true", "read against the code" — what a person can act on. Never what Sloppy
compared, or what it compared it with.

**Phone first.** The chip wraps inside the paragraph rather than truncating the sentence
around it; the sheet is the full-width bottom sheet every modal is, with the path pinned at
the top and the code scrolling under it; a line about moved code wraps its path rather than
cutting it short, and at phone width the act sits under the lines rather than beside them.
Nothing here is a hover: an anchor says what it is in the words it is drawn with.

## The compass card

A note that says what it is part of, what it is made of, what it is like and what was
chosen instead has said most of what somebody comes back for. The compass is where those
four go, and it is drawn once — **on the note, never on the canvas.** The graph draws one
shape, and a citation from a slot is a citation like any other (§ "The graph's colour
language"); a compass that put arrows on the field would be a second shape saying something
the first one already says.

**The card is the note in the middle and four slots around it**, each headed by its word —
**Part of**, **Made of**, **Like**, **Instead of** — with the notes it holds listed under
it. It is an element inside a section, like a list or a picture, so it sits where the
author wrote it and travels with the section the handle reorders — never a block of its
own, and never something typing conjures (AI.md § "A Block Is a Section").

**The four slots can be read as another method, and the card says which.** At the top of
the card sits the choice, each method offered by its questions rather than by its name
alone: the **Idea compass** those four words are, **QEC** — the question, the evidence, the
conclusion — or **AJI** — the assumption, the justification, the implication.
It is choosing how to think about the note, not setting a field, so what changes is the
questions and nothing else: the same slots hold the same citations, and a person who
switches back finds them where they were. A reader who cannot write sees the method's name
only where it is not the idea compass, and never an inert control. Three questions read as
a column at every width rather than as a rose, because the rose is what four questions
around a note look like.

**An empty slot asks rather than complains.** Under a slot with nothing in it sits the
question it answers — "What larger pattern is this part of?", "What is this made of?",
"What else works like this?", "What was chosen instead?" — in the note's own ink at the body
size, and nothing else: no red, no "incomplete", no three-of-four counter. A note with one
slot filled is a note with one slot filled, and the product has no opinion about that.

**Every method asks all four**, so switching never leaves a citation under a question
nobody asked. What the words are is the method's; that there are four of them is the
compass's.

**A slot is filled the way a sentence cites a note.** Typing in a slot searches the graph
exactly as `[[` does, and what it writes is a citation. Where the note somebody wants does
not exist yet, filling the slot writes it — a new note with no parent, titled from what was
typed — and cites it, so a half-formed thought becomes something to write into later
instead of a dead end.

**Phone first: the four slots stack into one column**, in the order north, south, east,
west, each a heading with its notes under it. That is also how the card reads in the
outline, where the compass is four labelled lists of links and a screen reader meets them as
that. Nothing about the four is carried by position alone.

**A slot on somebody else's note is a suggestion, and so is the method.** Filling one where
the author has reserved their note offers it, the way writing in it does (§ "Whose
writing"), and the offer reads as what it is — "Part of: gained …" against the slot, and
"Read as: QEC, not Idea compass" where it would read the note by other questions — rather
than as a block of changed markup. An offer that changes only the method is that line and
nothing under it.

## What the code left behind

A body of notes beside a codebase goes out of date quietly, and the whole job of this
surface is to say so without ever nagging. **It is a question the person asks, not a state
the product broadcasts.** There is no count in the chrome, no score, and nothing that goes
red on its own — a note nobody has confirmed says nothing at all, because unread is not
stale (§ "An anchor into code").

**One thing the mark says on its own, and it is the code having moved.** A note whose author
has read it against the code, and whose code has moved since, carries a dot on its rim
(§ "The mark") whether or not anybody has asked. This is a deliberate exception to the
paragraph above, and the reason is the shape: a body of notes beside a codebase is read AS a
graph — which part of this system has gone out from under me is a question about the field,
and answering it only inside a list answers it in the one place the field is not. Somebody
who has to open a sheet to learn that anything has moved learns it one note at a time.

**What that exception is held to, which is everything the rule was protecting.** A note
nobody has read against the code carries nothing, so unread is still not stale and nobody is
marked for a note they wrote this morning. It is one dot however many files moved: a count
was never the thing to act on, and a number on a mark is a score. It spends no hue, so the
canvas's colour still answers the reader's own question and nothing else. And where the code
cannot be reached — read away from the project, or a graph that is nobody's project —
nothing is worked out and nothing is drawn, because a silent mark must never come to mean
"this one is fine". What the dot MEANS is learned by opening the note, which says it in
words beside the anchor (§ "An anchor into code"); the canvas teaches it no other way, and
the sheet below is still how somebody reads the whole of it at once.

**Asking is choosing one signal, and the canvas answers by highlighting.** The four —
_the code moved_, _nothing written here_, _an empty slot_, _no why written_ — behave exactly
as tags do: the notes that carry the chosen one stay in ink and the rest dim, so the shape
of the graph survives the question. Never a filter, never a colour of its own, and never
two signals at once: the question is one at a time, the way a person asks one.

**Beside it, one quiet sheet.** The same modal every sheet is (§ Layout), titled "What the
code left behind", listing the notes under the chosen signal — the title, the address where
there is one, and the act, in the note's own ink:

- **Still true** — for a note whose code has moved. Taking it records the reading and
  nothing else, and it is the same act the note itself offers beside the anchor.
- **Write a note** — for code nothing has been written about. It opens a walkthrough under
  the project's own note, already anchored at the path.
- **the slot's own question** — for an empty slot, which is the same line the card shows,
  and tapping it opens the note.
- **Say why** — for a decision whose "Why" is still empty. Taking it opens the note, and it
  never writes a word there.

**An act lands on the thing it named.** An empty slot opens the note at its compass card and
"Say why" opens it with the Why section in view — not at the top of a note somebody then has
to hunt through for the part the row was about.

**Where nothing is left behind, the sheet says so in one line and offers nothing.** "Nothing
the code has left behind." That is the ordinary state of a project somebody is keeping up
with, and it should read as the pleasant thing it is rather than as an empty container with
a call to action in it.

**Phone first.** The sheet is the full-width bottom sheet, one note per row with its act
under the title rather than beside it, and the signal chosen from a row of chips along the
top that wraps onto a second line where the four do not fit — nothing here scrolls sideways,
because a chip past the edge with nothing to say it is there is a question nobody can ask.
The canvas keeps answering underneath, so dismissing the sheet
leaves the highlight where it was — the question is still the one being asked.

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
- **The graph you are in leads the chrome over the canvas.** Which notebook a person is
  writing in decides where every act in the row after it lands, so it is named first,
  full-width on a phone, and it is the way to every other graph — moving into one, standing
  one up beside it, naming one, starting one. Moving between graphs is a top-level act on
  the surface the graphs are on, never a setting.
- **What only changes how the canvas is LOOKED at sits on the canvas, at a weight below the
  row that writes.** Putting the whole field back in view, walking it note by note, the
  drawing, the ground under it: none of them makes or changes a note, so none of them takes a
  place in the row where the graph is named and a branch is written. They ride the canvas they
  act on, as one quiet column against its edge, held clear of the system nav (§ "The four
  inset vars").
- **Floating nav, not a top bar.** A pill anchored bottom-centre (`fixed`, safe-area
  inset) holds the core destinations. ≥44px targets, keyboard-reachable, `aria-label`led.
  The pill publishes its own height as `--sysnav-inset-bottom` and is suppressed while a
  modal is open.
- **What stands beside the graph is a dock, and `SideDock` is the one of them.** It has two
  presentations from one bound `open`: **docked beside the graph at ≥900px**, where the canvas
  keeps its pan, its pinch, its choosing and its menu beside whatever is open; and a
  **full-height modal sheet below that width**, phone and portrait tablet alike, so what it
  holds is a page rather than a peep-hole. The branch is fixed for as long as something is
  open in it — a rotation mid-edit never remounts the editor and loses a caret — and is read
  again from the viewport once the dock is empty. **Two things dock today**: a note opened to
  read, which is `ReadingPanel` — the dock plus the strip across its head; and the chat with
  an agent about the project, which is the dock plus the thread and the composer. Anything
  else that wants to stand beside the graph is a third use of the same dock, never a second
  copy of it.
- **Both may stand at once, and they stack.** You read the note while you chat about it, so
  the chat is outermost — it is the companion that stays — and a note opened to read sits
  between it and the graph. A second dock opens beside the first only where the graph would
  still keep its own room; where it would not, it is the sheet, exactly as one dock is below
  the docking width. Two sheets never stand together: below that width the note is what was
  asked for, and the chat steps aside with its conversation kept.
- **A docked panel is a layout, not a modal**: no scrim, no focus trap, nothing else on the
  page taken away while it stands, and a drag begun on the canvas is still the canvas's. It is
  put away by the way out at its head, and by Escape from inside it — outside it, Escape
  belongs to whatever the canvas is in the middle of. Beside means beside, so what is docked
  publishes the width it takes as `--reading-dock-inset-right` — everything docked on the
  right, together — and the page it stands next to gives that width up rather than going on
  drawing its chrome underneath.
- **The wall between a dock and the graph is the reader's to move.** A person who
  came to write takes as much room as they want for it, by dragging that inner edge or by
  moving a separator they can focus with the arrow keys. It shows a grip at rest rather than
  one that appears under a pointer, and the target around that grip is one a finger can hit:
  the tablet it docks on has no hover. It is bounded at both ends — never narrower than words
  read well in, never wider than the point they themselves stop widening, and never so wide
  that what it is docked against stops being a graph, which the two of them answer between
  them: each is bounded against what the window has left once the other has taken its room
  — and it publishes every width it passes through rather than only the
  one it comes to rest at, because the nav pill, the bar over a chosen set and the card
  beside a mark all place themselves against that number. Below the dock width what it holds
  is the whole screen and there is no wall, because there is nothing left to take room from.
  How much room each was given is this device's, kept beside the theme (§ Persistence).
- **The note's way out and its acts keep their place** at the head of the surface however
  far the note runs. The way back out of a long note must never be a scroll away, and
  neither may the acts, because that is where a refused one answers. **The address is read
  with the title it labels**, on the line above it and flush with it, since it is what that
  title is filed under rather than a piece of chrome — so the acts carry a way to copy it,
  and a reader deep in a long note can still cite what they are reading.
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
  single column, on a desk where every viewport breakpoint has long since turned on, so what
  lays itself out in two columns or one asks a container query, never `sm:`.
- **The words stop widening before the wall does, and the wall stops with them.** A note's
  column grows with the wall as far as 42rem, past which a line stops being one an eye
  carries back to the start of. So the wall stops there: room taken past that point is
  margin nobody writes in, bought with graph somebody reads. At the other end it stops at
  22rem, below which there is not enough left to work a note in at all. The surface hands
  the ceiling to the note as `--reading-column`, so the words and the wall cannot drift
  apart.
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
- **In the outline, a row's write control is also where a new note is aimed.** Carrying it
  over the outline — a press and hold on a finger, a plain drag with a mouse — says in
  words what letting go will do: write under the row it is indented past, or beside the
  row it is level with. The run that would gain the note is marked by an edge rather than
  a colour, and the same words are said to anything reading the page aloud. The gesture
  only ever adds. The new note lands at the end of the run it named, because that is
  where the next address in a run is, and nothing already written is moved or renumbered
  by a drag. A tap on that control still writes under its own row and the keyboard keeps
  its chord, so this is a third way in and never the only one.
- **A row opens its note in place, and a handle carries a section anywhere in the
  outline.** A tap on the row draws what is written in the note under it, in the writing
  surface itself, so it is read and written where it stands; the one control the row can
  spare goes to the note's own page. Each section carries the same handle it has inside
  the note. Carrying that handle says in words where letting go will put the section — up
  or down its own note, into another open note's stack, onto a closed row at the end of
  it, or out between two rows as a note of its own, springing from the run it landed in.
  Tapping the handle offers the moves within its own note as steps, for a finger that has
  no hover to read. No note moves with a section, and the run the outline draws keeps its
  own order.
- **A note's row fits the narrowest phone, and the title is what gives.** The chevron, the
  control that opens the note's own page and the write control are touch targets and hold their size, and the
  stair a row is set in is shallower where the width is scarcer; the title truncates before
  any control does. Beside it, _published_ and _chosen_ fold back to their marks, and how
  many notes are under a row is a wide-screen affordance — on a phone the chevron is what
  says there is anything under it. Anything reading the page aloud is told all three either
  way. The address is the one part that never gives — it is what a person cites — so
  everything else on the row is drawn to fit around it.
- **A tablet is a phone with room, never a third layout.** If a tablet arrangement needs a
  component the phone does not have, the phone layout is what is wrong.
- **`ResponsiveModal` is the only modal.** A drag-to-dismiss bottom sheet on a phone, a
  centred dialog at ≥640px, from one bound `open`; `fill` is the full-height sheet a reading
  surface stands in below its dock width. It is drawn by Sloppy on every platform, because a
  sheet holds the note's own editing surfaces and those live in the webview. Reserve bare
  `Dialog` for passive confirm/detail popups, never input surfaces.
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

The bottom edge is two of those terms and is asked for as one, so **`--sysnav-clearance`
names their sum** — the OS bar plus the pill standing on it. `clear-sysnav` is that sum as
padding; the var is the same sum as a length, for a surface that needs to inset something
rather than pad it. A surface takes one or the other and never re-derives the formula, which
is what stops one of them going on spelling `env()` after the other stopped.

`--reading-head` is the same bargain kept inside one surface: the reading panel publishes
how tall its own head stands, and the note under it sticks its own head below that rather
than beneath it. **The head is what it holds** — the strip across it, and whatever the
surface has to say about the note being opened — so the height is measured off that box
rather than assumed from the strip: a refusal drawn beside the strip and a height that
counted only the strip is a message painted over the way out of the note. It is unset
wherever the surface draws no head at all, so a note read on its own keeps its head at the
top of whatever is scrolling it — the fallback is that height to the pixel, which is why
every reader of it is written `var(--reading-head, 0px)`.

`--reading-dock-inset-right` is the same bargain turned sideways: what is docked beside the
graph publishes the width it occupies, and what stands next to it subtracts that width
instead of drawing underneath — the page's own box, and the nav pill, which re-centres over
what is left rather than being taken away. **The number is everything docked on the right,
together**, so a note and the chat standing side by side owe one sum and no reader of the var
has to know how many panels drew it; `SideDock` is where they are added up, because two
components each setting one var would race and whichever drew last would win. Any full-bleed
layer on a page that can be docked beside — a drawn ground, a bar pinned across the foot, a
card raised beside a mark — is placed against that box, or it runs on under the panel while
the page it belongs to stops at the edge.

`--chosen-bar-inset-bottom` is the bar of chosen notes owing what it stands on, published BY
the bar and unset wherever it is down. It is measured off the bar's whole box, so the row of
acts and a refusal drawn under the tally are both counted, and it sits ON TOP of
`--sysnav-clearance` rather than replacing it. A pannable field ignores it — the reader moves
what is under the bar. A surface that SCROLLS while somebody chooses on it insets by
`calc(var(--sysnav-clearance) + var(--chosen-bar-inset-bottom, 0px))`, or its last rows are
the ones being chosen on and the ones the bar covers.

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
- **Once a set is being chosen, one finger sweeps.** Choosing a region is the only way to
  act on many notes at once, and it cannot be a thing only a mouse can do. While a set is
  being chosen — where a tap is already adding and removing — a one-finger drag over bare
  canvas draws the sweep box instead of panning. Two fingers still pan and pinch, a finger
  that lands on a mark still pans, and the press that opens the menu is untouched. This is
  not a mode to find: nothing changes until the reader has said they are choosing, and a
  finger pans again the moment they are done. A second finger arriving mid-sweep is a pan,
  and what was swept by then stands — a sweep adds to the chosen set, it never replaces it.
- **Proposed, not built: moving a mark with a finger.** Taking hold of a mark is a mouse
  gesture, so the reader most likely to meet a crowded region — the annotator, on a tablet —
  cannot untangle one. The likely shape is **Move** on the press menu rather than a longer
  hold, because the press pointer is spent on the menu on purpose (above), and re-reading
  it as a drag is what this section is written to prevent. Whatever it becomes, it moves the
  mark **for this reader, in this session**: where a mark stands is not stored and not
  published, so nothing a peer pulls changes. Not decided — it moves the touch contract
  above, which is a decision to take on its own rather than inside a feature.
- **Ink degrades, it never gates.** `getCoalescedEvents()`/`getPredictedEvents()` are
  feature-detected; without them a stroke is rougher, not unavailable.
- **What the pen leaves over the canvas is a drawing on the FIELD, and it stays.** It goes
  into the layer above the canvas — the one the renderer positions and hands to the host —
  in the field's own coordinates, so a circle round three marks and an arrow between two
  branches pan and zoom with the marks rather than sliding off them. The renderer says
  where the field is looking beside handing over the pen; nothing else keeps that layer in
  step.
- **That drawing is a per-device view choice kept against the graph**, like the ground and
  the picture behind it: nothing of it is on a note, it never publishes, and a peer pulling
  a subtree receives nothing of it. It is kept on the device for the person signed in
  (§ Persistence) and it LIVES there — it is not a copy of anything Sloppy holds, which is
  the one thing writing that has not been saved yet also is. **The way back is one quiet
  control**, and it is there only once something has been drawn: the last stroke, or the
  whole drawing. A pen is how a drawing starts, so nothing has to be found first.
- **The ownership line.** Svelte owns _which_ nodes exist and their initial geometry; pixi
  owns runtime pan/zoom/drag and reports back; the scene re-initialises only on an explicit
  `remountKey`. A plain drag never remounts, which is the difference between a graph that
  keeps its viewport and one that doesn't.
- **The canvas comes to a note the reader opened, and never to one the app moved to
  under them.** A link followed, a row of the outline, an address in the URL: each
  brings the mark under the canvas, and one already on screen is left exactly
  where it is. It is held there through the settle that opening it starts, and no
  further — an ask that outlived its act would pull the canvas away from whatever the
  reader unfolded next. Putting the whole field back in view is one control in the
  chrome, which is also the answer to "where am I".
- **Where a mark STARTS when the field is rebuilt is this reader's session, not the
  protocol.** One already drawn stays where the last settle left it, and one re-entering
  the drawn set — an unfolded branch — starts at its parent's current place plus the step
  its own address takes, so a branch comes back where it was rather than in from the
  seeds. The seeds themselves are untouched, and they are what a peer agrees with
  (§ "Several graphs on one canvas").
- **Level of detail is the design, not an optimisation.** A subtree past a depth threshold
  draws as one mega-node sized by descendant count; a tag selection lights the notes that
  carry it and dims the rest along with the genealogical edges. **Neither mode ever draws
  more than a bounded node count** — legibility and frame time are the same constraint here (PRODUCT.md principle 7).
- **The page is the ground; the field is a box inside it.** A picture reaches every edge of
  the page — behind the chrome at the head, under the bar at the foot — while the field the
  marks are drawn in is held off that chrome by the room the chrome says it takes. So no mark
  is ever drawn where something else is written over it. **The lattice is the field's**, not
  the page's: it is drawn in the canvas with the marks, so it stops where they do, and over a
  picture that carries on past it that edge is visible. It is the one part of the ground that
  is still cut to the box. **Everything that reads a screen point
  reads it against that inner box** — a tap, a hover, a stroke, and the size the renderer is
  given; read against the page instead, every one of them lands the chrome's height away
  from the mark it was aimed at.
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

### The wallpaper

Behind that paper the reader may put a picture of their own — one, or a few that take turns.
It is a ground for the same reason the lattice is: it carries no meaning, nothing drawn on it
says anything, and it sits under everything the canvas draws. **It is behind the paper rather
than instead of it**, so dots or rules and a picture are two independent choices and a reader
may have either, both or neither — the lattice goes on reading as the paper's own grain, laid
over whatever is behind it.

- **It is pinned to the screen, where the lattice is pinned to the world.** How far you went
  is the lattice's to say, and a second thing moving with the field would answer the same
  question twice. The screen means the whole page, to all four edges and under the chrome
  floating over it: a ground that stopped where the chrome starts is a picture let into the
  page rather than the page's own. Standing still is also what makes it free: it is one
  composited layer behind a canvas that already clears transparent, so no frame writes
  anything for it. On the 2,400-note corpus `bench/` reported idle and pan at **8.3/9.3 ms
  with a picture and 8.3/9.3 without** — the same numbers the ground is measured at, and the
  same with both on. **Those were taken before a mark could wear a series or a size of its
  own, and the corpus they were taken on has since gained both; they are the ground's number and
  not the mark's until `bench/` is run again.** What the mark costs is known without
  running it: the sheet every mark is cut from is cut for the screen and the zoom, so a graph
  pays 1.64 MB of RGBA at the coarsest step and 14.75 MB at the densest — a phone with the
  field in view sits at the first, a 4K desk zoomed into a note at the last — and its cells
  are one per ring weight AND style, which is why the styles are four and not ten. A picture
  is cut for the mark that wears it and the screen it is drawn on, so a leaf takes 32 px on a
  plain display and 128 px on a dense one, where the stored cut is 1,863 px on a side — the
  biggest mega-node a look could grow, covered whole, at full zoom, on the densest screen. Those
  numbers are a still picture's. **A picture may move if that is what somebody wants behind
  their graph** — a background that lives is a thing people put behind their work, and the
  ground is theirs. It costs what it looks like it costs: an animated picture repaints that
  layer under the whole field, so the idle number above is not the one a reader gets. That
  is a price they chose by choosing the picture, and it is taken off the way it was put on.
- **The mask over it is the theme's own paper, and nobody picks its colour.** A hue chosen
  here would be the one thing on the canvas carrying colour that answers no question
  (§ Hue), and it would shift every hue drawn over it. So the picture shows through the
  paper at one strength, and that strength is the only knob: `--graph-paper` at
  `1 − presence` over the picture, composited in sRGB, which is what the floors below are
  measured on.
- **What the ground can carry is computed, not chosen.** A picture may hold any pixel, so the
  ground under a mark becomes a BAND — the theme's paper with the darkest and the lightest
  pixel showing through it — and everything drawn on it owes its floor against both ends.
  `paperCeiling` in `@sloppy/graph` walks a picture up until one of two things gives: the ink
  the canvas letters in falls under **4.5:1**, the floor small text owes, or the tag slots
  close to within a tenth of what tells them apart on the plain theme. **The ceiling is
  whichever comes first**, because the label is not the only thing that has to survive the
  ground: a picture strong enough to darken eight hues into one has taken the reader's
  question, and on a light theme it takes it a long way before the label gives. **The
  reader's control spans that range**, so its full travel is the most the theme will carry
  rather than a number that stops meaning anything half way along, and a theme change
  re-reads it. It opens at a quarter of the way up, which is quiet enough to read as paper
  with a picture in it.
- **A picture moves the palette, because the palette is derived from the ground.** The depth
  ramp runs from the theme's ink to the faintest mark that clears the mark floor; with a
  picture under it, that far end is found against the band instead. The cost is the range
  between them, which closes as the picture strengthens, and the ramp answers by carrying
  fewer generations rather than by handing two of them one colour (§ Lightness) — at the
  top of the travel Graphite carries five where it carries seven on the plain theme. Past
  the last step depth is being read off the tree and not off the fill. That is the trade
  the control is for, and it is the reader's to make.
- **A dimmed note is measured against that band too**, so the answer to a tag question
  keeps the whole graph on the page at every strength the ground carries (§ Hue). It costs
  the picture nothing: an unselected mark gives up less of its own fill where the ground
  demands it, so the floor is held by the dim rather than by the ceiling, and the two
  things that end a ground are still the two above.
- **A tag slot moves in LIGHTNESS and in nothing else.** It has to clear the mark floor on
  the same band, and the correction `--primary-mark` already ships for Ochre is the one that
  applies: pulling eight hues toward one anchor converges them, and a palette whose slots
  have converged has stopped being a language. `wallpaper.test.ts` in `@sloppy/graph` holds
  the mark floor, the separation the ceiling is drawn at and the hue at every strength up to
  it, holds that the ceiling is a picture somebody can actually see, and holds that a dimmed
  note never out-reads a lit one on the same ground. **The rail's chip and the canvas's mark
  answer in the same hue and the same slot, and that is what the reader reads across.** The
  chip is drawn on chrome, and **the chrome that carries it stands on the theme's own opaque
  surface** — the picture runs beneath that chrome and never reaches it. That is what keeps
  the chip's ground a token `token-contrast.test.ts` has already swept, and so a floor known
  to hold over every picture rather than over the one somebody tried. So it is the mark alone
  that moves — as far as the ground under it moved, and no further, which is why the ceiling
  ends where the eight are still eight.
- **A series changes while nobody is watching it, and how it changes is the reader's.**
  § "A picture that takes turns" is the model — the ground and a mark's imagery are both it,
  written once so the two cannot drift into two spellings of the same choice.
- **The pictures are the reader's own**, resolved the way a mark's are (§ "The mark") and
  never as a remote URL. **The ground has its own library**, and reads the note one beside
  it: choosing here offers both what somebody added as a ground and what is already in their
  notes, so a picture goes behind a graph without first going into a note. The note picker
  offers the note ones alone — a ground is a screenful and a note's picture is a paragraph's,
  and a writer's picker that filled with wallpapers would be spending its page on pictures
  they never put in a note. A mark's imagery is the note library and not this one
  (docs/ARCHITECTURE.md § "Pictures" carries that ruling).
- **It is a per-device view preference, kept against the graph it is under**, and never
  anything about the notes. What one graph is drawn over says nothing about another, and a
  peer pulling a subtree receives nothing of it.

### A picture that takes turns

A reader may put more than one picture behind their graph, and an author more than one on
their mark. Both are the same thing — a series, a cadence, and a transition — so both read
one model, `picture.ts` in `@sloppy/types`: a ground and a look take their cadence and their
transition from it and hold no bounds of their own, `turn.ts` in `@sloppy/graph` steps both
through a change, and one `SeriesControls` is what either is chosen with. A surface that grew
its own spelling of it would let the two disagree about a choice somebody made once.

- **Whose turn it is comes off the clock** — `floor(now / every) % count` — and is read when
  the graph opens and when the app comes back from the background, never on a timer. So
  there is no rotation state to keep, two devices land on the same picture at the same minute
  with nothing to sync, and nothing changes under somebody who is reading.
- **One picture is a still one.** A cadence and a transition say nothing about a series of
  one, so neither is worth putting in front of somebody until there is a second picture to
  change to.
- **Three transitions, and every one of them is transform and opacity alone**: a crossfade, a
  slide, and a slow zoom that settles down to full size and never past it, so a picture
  cropped to fill cannot reveal its edges mid-change. Opacity multiplies into whatever the
  layer is already drawn at, so a picture somebody has quietened never pops to full strength
  half way through. They are the same three on the ground and on a mark and take the same
  time on both, inside § Motion's band, so one screen never changes a picture at two speeds.
  Under `prefers-reduced-motion` the picture changes without moving.
- **The values are an open set**, the way a look's are: a transition this build cannot draw
  is stored and handed back untouched, and meanwhile crossfades. So is the count and so is
  the cadence: **eight pictures is what a look is written with** — past that somebody is
  keeping an album rather than choosing what a note is known by — and a series a later Sloppy
  widened is read, kept whole and drawn to the first eight. `PICTURES_PER_SERIES` bounds a
  look on the way in, because a look is what a note is known by and it travels to whoever
  pulls that note. **The ground's series is deliberately not bounded**: it is a per-device
  view choice that reaches nobody, and one picture of it is on screen at a time, so a long
  one is spent by the reader who chose it and by no one else. A picture that costs somebody
  the note it is on is the one thing none of this may do.
- **What each surface carries beside the series is its own.** The ground has a strength,
  because a picture under a whole field is held to what the reader must still be able to read
  on it (§ "The wallpaper"); a mark has the share of the disc its imagery covers (§ "The
  mark"). Neither belongs in the model they share.

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
  never mean an unsettled graph. A mark the reader is holding is the one thing the field
  follows as it goes, rather than jumping to a converged field under a moving hand, and it
  converges the moment the mark is let go.

## Persistence

A single client-side prefs store (`localStorage`, key `sloppy_prefs`) holds
`{ theme, accent, style, font }`, applied to `<html>` data-attributes as early as
possible (inline head script) to avoid a flash of the wrong theme. No account required;
choices carry over if someone signs in.

The same store holds the view choices that are nobody's business but this device's — the
tags the graph opens lit by, the ground it is drawn on (§ "The ground"), the picture behind
it (§ "The wallpaper"), which graph the reader is in and which they have stood up beside it
(§ "Several graphs on one canvas"), whether it is read as an outline rather than drawn, and
how much room each dock beside it was last given. None of them is an attribute on `<html>`, so
none is a thing the boot script has to know: the canvas reads them once it is up, and a
first paint with the right theme is all that flash-of-the-wrong anything is about. None of
them reaches a note either — a peer pulling a subtree receives nothing of how it was read.

Beside those choices, and answering to a different rule, is **what this device keeps for
the person signed in**: the graph as it was last read, writing that has not reached Sloppy
yet, and whatever else a surface has to put in front of somebody before an answer arrives.
`deviceStore` in `@sloppy/app-core` is the one door to it, scoped by identity and by area
so two surfaces cannot write over each other. Three rules hold it:

- **It is a copy, never where something lives** — with one exception, writing that has not
  reached Sloppy yet, which lives here until it does. Everything else a surface reads from
  here it can read again from the graph, and that is what makes the graph open on a train.
  A surface that can only read a thing from here has lost it.
- **It is one identity's, and their sign-out takes it.** `session.signOut()` forgets
  everything this device kept for them. A session that merely lapses is not a sign-out:
  the person is expected back, and the writing still waiting to be saved has to be there
  when they are. Nothing of theirs is put in front of whoever signs in next either — every
  key here is scoped to the identity that wrote it.
- **None of it reaches a note or a peer.** It is this device's, like the ground and the
  theme, and nobody else can tell it exists.
