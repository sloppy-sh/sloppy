# The page a note is read in

What the headset shows a note's markdown in: tables, coloured code, mermaid diagrams, math,
task lists, quotes and pictures, in the look's ink, paper and faces, with every link handed to
the headset to open. `../tools/build-web.sh` builds it into `dist/index.html` — one file with its
script, styles and faces inside it, so a view can be handed it from any base and it asks nothing
of the network.

## What the headset says to it

`sloppy.render(json)`, with

```
{ markdown, look?: { ink, paper, card, edge, faces: { ui, heading, mono }, density },
  named?: { <ref>: <title> }, pictures?: { <path as the markdown names it>: <data URI> } }
```

A colour is any CSS colour or an OKLCH triple `[lightness, chroma, hue]`. A face is a name as a
desk gives it (`inter`, `atkinson`, `firacode`, …). A picture the headset did not hand over is
shown as the words its author gave it.

## What it says back

Each through `window.sloppy.send(json)` where the panel provides one (the console otherwise):

- `{ kind: "ready" }` once, when `sloppy.render` can be called;
- `{ kind: "height", px }` whenever the page's height changes;
- `{ kind: "link", href, note?, address? }` on a click of any link, which goes nowhere itself:
  `note` is the ref of a note it names, `address` the address of one it names by address, and a
  link with neither is one out of the graph. A link to a place on the page scrolls to it and says
  nothing.

## Working on it

```sh
pnpm --filter @sloppy/vr-web dev     # the page in a browser; call sloppy.render in the console
pnpm --filter @sloppy/vr-web test    # the markdown, the look, the links and the messages
pnpm --filter @sloppy/vr-web paint   # after a build: WebKit paints the fixture and keeps pictures of it
```
