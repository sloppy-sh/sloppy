# @sloppy/graph

The canvas. `docs/ARCHITECTURE.md` § "Graph rendering" and `DESIGN.md` § "The canvas"
are the docs of record; this file is only how a host wires it up.

## Mounting

`mountGraph` is imperative rather than a component, because a component that owned the
viewport would have to re-render to move it. A Svelte host is an element and an effect:

```svelte
<script lang="ts">
  import { mountGraph, type GraphHandle } from '@sloppy/graph';
  import LayoutWorker from '@sloppy/graph/layout-worker?worker';

  let host = $state<HTMLElement>();
  let handle: GraphHandle | undefined;

  $effect(() => {
    if (!host) return;
    handle = mountGraph(host, { ...props, createLayoutWorker: () => new LayoutWorker() });
    return () => handle?.destroy();
  });

  $effect(() => handle?.update({ ...props, createLayoutWorker: () => new LayoutWorker() }));
</script>

<div bind:this={host} class="h-full w-full"></div>
```

The first effect must not read anything that changes, or a pan will remount the scene.
`update` is where new props go.

`createLayoutWorker` is optional — without it the same layout runs on the main thread in
slices. Vite's `?worker` import is the shortest form that survives dev and a production
build alike.

## What the host owns, and what this owns

The host owns which nodes exist, which are collapsed, and which lens is active. This owns
pan, zoom, drag, level of detail and every colour, and reports back through the callbacks
in `GraphSurfaceProps`.

Pass `collapsed: new Set()` for the whole-graph view. Level of detail is what bounds the
field; a host that pre-collapses everything gets six mega-nodes and none of the graph.

## Ink

`handle.ink` is an empty positioned layer over the canvas. Pen events arrive through
`onInkPointer` with the point already in graph coordinates, so a stroke stays where it was
drawn through a pan; `handle.toWorld` converts any other client point.

## Benchmark

`pnpm --filter @sloppy/graph bench` serves a 2,400-note graph and drives it with real
pointer events; `?inline` measures the same thing without a worker. The panel and
`window.__bench` carry the numbers.
