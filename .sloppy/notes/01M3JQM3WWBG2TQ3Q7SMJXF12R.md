---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQM3WWBG2TQ3Q7SMJXF12R
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQGKYNV7HMP3611A245MPN
address: 1b6
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - frontend
  - graph
  - rendering
title: "graph: the canvas renderer"
created: 2026-09-28T00:46:16.988Z
updated: 2026-09-28T00:46:16.990Z
---

<!-- block 01M3JQM3WXD693XY741PYAVW3Z -->

[packages/ts/graph](code:packages/ts/graph)

<!-- block 01M3JQM3WY7XJKCCY5ZFC2QS0Y -->

## What it is

`@sloppy/graph` draws a graph on a pixi.js v8 canvas, over a graphology model with a d3-force layout that runs in a worker. The app drives it through a surface contract and never reaches into pixi itself.

## Where to start

- [contract.ts](code:packages/ts/graph/src/contract.ts): the surface the app drives.
- [mount.ts](code:packages/ts/graph/src/mount.ts): putting a canvas on the page.
- [model.ts](code:packages/ts/graph/src/model.ts): the graph as the renderer holds it.
- [scene.ts](code:packages/ts/graph/src/scene.ts): what is drawn, including marks, edges, captions, tints and pictures.
- [layout-worker.ts](code:packages/ts/graph/src/layout-worker.ts): the force layout, off the main thread.
- [lod.ts](code:packages/ts/graph/src/lod.ts) and [density.ts](code:packages/ts/graph/src/density.ts): detail falling away as you pull back.
- [gestures.ts](code:packages/ts/graph/src/gestures.ts) and [viewport.ts](code:packages/ts/graph/src/viewport.ts): panning, pinching and zooming.
- [ground.ts](code:packages/ts/graph/src/ground.ts), [wall.ts](code:packages/ts/graph/src/wall.ts): the picture a reader can put behind the field.
- [color.ts](code:packages/ts/graph/src/color.ts), [palette.ts](code:packages/ts/graph/src/palette.ts): the graph's colours.

\[Graph rendering\](code\:docs/ARCHITECTURE.md#Graph rendering) is the doc of record.
