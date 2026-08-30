<script lang="ts">
	// The canvas, cut down to what a page suite can tap: one control per drawn
	// note, and one for opening the fold it stands for. What a tap MEANS is the
	// real surface's contract, held by `@sloppy/graph`'s mount suite; this stands
	// in for the pixels.
	import type { GraphSurfaceProps } from '@sloppy/graph';

	let {
		nodes,
		picking,
		chosen,
		focus,
		onOpenNode,
		onExpand,
		onChoose,
		onChooseWithin,
		onMenu
	}: GraphSurfaceProps = $props();
</script>

<ul aria-label="The graph" data-focus={focus} data-choosing={chosen ? 'yes' : undefined}>
	{#each nodes as note (note.ref)}
		{@const marked =
			picking?.from === note.ref ? 'from' : picking?.taken.has(note.ref) ? 'taken' : undefined}
		<li>
			<button
				type="button"
				data-marked={marked}
				data-chosen={chosen?.has(note.ref) ? 'yes' : undefined}
				onclick={() =>
					picking ? picking.onPick(note.ref) : chosen ? onChoose?.(note.ref) : onOpenNode(note.ref)}
			>
				{note.address}
				{note.title}
			</button>
			<button type="button" data-expand={note.address} onclick={() => onExpand(note.ref)}>
				open what is under {note.address}
			</button>
			<button
				type="button"
				data-menu={note.address}
				onclick={() => onMenu?.({ clientX: 0, clientY: 0, ref: note.ref, foldable: true })}
			>
				menu on {note.address}
			</button>
		</li>
	{/each}
	<li>
		<button
			type="button"
			data-menu="the canvas"
			onclick={() => onMenu?.({ clientX: 0, clientY: 0, ref: null, foldable: false })}
		>
			menu on the canvas
		</button>
		<button
			type="button"
			data-sweep
			onclick={() => onChooseWithin?.(nodes.map((note) => note.ref))}
		>
			sweep the whole field
		</button>
	</li>
</ul>
