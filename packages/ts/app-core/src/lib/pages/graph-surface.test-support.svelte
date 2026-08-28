<script lang="ts">
	// The canvas, cut down to what a page suite can tap: one control per drawn
	// note, and one for opening the fold it stands for. What a tap MEANS is the
	// real surface's contract, held by `@sloppy/graph`'s mount suite; this stands
	// in for the pixels.
	import type { GraphSurfaceProps } from '@sloppy/graph';

	let { nodes, picking, focus, onOpenNode, onExpand }: GraphSurfaceProps = $props();
</script>

<ul aria-label="The graph" data-focus={focus}>
	{#each nodes as note (note.ref)}
		{@const marked =
			picking?.from === note.ref ? 'from' : picking?.taken.has(note.ref) ? 'taken' : undefined}
		<li>
			<button
				type="button"
				data-marked={marked}
				onclick={() => (picking ? picking.onPick(note.ref) : onOpenNode(note.ref))}
			>
				{note.address}
				{note.title}
			</button>
			<button type="button" data-expand={note.address} onclick={() => onExpand(note.ref)}>
				open what is under {note.address}
			</button>
		</li>
	{/each}
</ul>
