<script lang="ts" module>
	import type { GraphTransform } from '@sloppy/graph';

	/** The canvas as a tab-switch suite drives it. `at` is where it is looking,
	 *  which the page reads back off it; `looked`, `fitted` and `framing` carry
	 *  what was drawn at the moment of each ask, so a suite can tell an ask that
	 *  waited for the folder's notes from one that did not. */
	export const field = {
		at: null as GraphTransform | null,
		looked: [] as { at: GraphTransform; drawing: string[] }[],
		fitted: [] as string[][],
		framing: [] as string[][]
	};

	export function forgetTheField(): void {
		field.at = null;
		field.looked = [];
		field.fitted = [];
		field.framing = [];
	}
</script>

<script lang="ts">
	/* eslint-disable no-useless-assignment -- the page binds the handle out and
	   calls it; nothing in here reads it back. */

	// The canvas, cut down to what a tab switch asks of it: being read back,
	// being put somewhere, and being framed. What those MEAN is the real
	// surface's contract, held by `@sloppy/graph`'s mount suite.
	import type { GraphHandle, GraphSurfaceProps } from '@sloppy/graph';

	let {
		handle = $bindable(),
		nodes,
		collapsed,
		selection,
		onOpenNode,
		onCollapse
	}: GraphSurfaceProps & { handle?: GraphHandle } = $props();

	const drawing = (): string[] => nodes.map((note) => note.title);

	const canvas: GraphHandle = {
		update: () => {},
		destroy: () => {},
		ink: document.createElement('div'),
		toWorld: () => ({ x: 0, y: 0 }),
		bringTo: () => {},
		fit: () => {
			field.fitted = [...field.fitted, drawing()];
		},
		frameWhenSettled: () => {
			field.framing = [...field.framing, drawing()];
		},
		viewport: () => field.at,
		lookAt: (at) => {
			field.at = at;
			field.looked = [...field.looked, { at, drawing: drawing() }];
		},
		stats: () => null,
		resetStats: () => {}
	};

	handle = canvas;
</script>

<ul
	aria-label="The graph"
	data-selection={selection.join(' ')}
	data-collapsed={[...collapsed].join(' ')}
>
	{#each nodes as note (note.ref)}
		<li>
			<button type="button" onclick={() => onOpenNode(note.ref)}>{note.title}</button>
			<button type="button" data-fold={note.title} onclick={() => onCollapse(note.ref)}>
				fold what is under {note.title}
			</button>
		</li>
	{/each}
</ul>
