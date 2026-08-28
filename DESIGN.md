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
are exactly three cheap perceptual channels — hue, lightness, and form — and each is
spent on exactly one thing.** Two meanings sharing a channel is how a graph view becomes
decorative.

| Channel                | Carries                               | Why this channel                                                                      |
| ---------------------- | ------------------------------------- | ------------------------------------------------------------------------------------- |
| **Hue**                | the tags the reader has selected      | the selection is the question the reader just asked, so it gets the loudest channel   |
| **Lightness**          | genealogical depth                    | depth is ordinal, and lightness is the only channel read as ordered without a legend  |
| **Form** (shape, edge) | provenance — own / published / pulled | provenance must survive greyscale, colour-blindness and full zoom-out, so never a hue |

### Hue — the tags you selected, and only those

**With nothing selected the graph is monochrome.** Colour appears when the reader asks a
question of the graph, and it means the answer. A permanently rainbow canvas is the
Obsidian failure with extra steps.

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

### Edges

Genealogical edges draw the depth ramp at low alpha — they are the structure, so they
recede. Associative links (`links[]`) are dashed and drawn above them, because they cross
the tree and would otherwise read as parentage. **With tags selected, genealogical edges dim
further**: the reader has asked to see sets, and the tree is momentarily the background.

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
- **The node interior is one component with two presentations.** A drag-to-dismiss bottom
  sheet on phone, a docked side panel at ≥900px — same component, same props, the branch
  **latched for the component's life** so a rotation mid-edit never remounts the editor and
  loses a caret.
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
  centred dialog at ≥640px, from one bound `open`. Reserve bare `Dialog` for passive
  confirm/detail popups, never input surfaces.
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
