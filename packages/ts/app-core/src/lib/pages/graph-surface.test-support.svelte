<script lang="ts">
	/* eslint-disable no-useless-assignment -- the page binds the handle out and
	   calls it; nothing in here reads it back. */

	// The canvas, cut down to what a page suite can tap: one control per drawn
	// note, and one for opening the fold it stands for. What a tap MEANS is the
	// real surface's contract, held by `@sloppy/graph`'s mount suite; this stands
	// in for the pixels.
	import {
		differenceMarks,
		drawnSetsOf,
		type GraphHandle,
		type GraphSurfaceProps,
		type GraphTransform
	} from '@sloppy/graph';

	let brought = $state<string[]>([]);
	let fitted = $state(0);
	let at = $state<GraphTransform | null>(null);

	const canvas = {
		bringTo: (ref: string) => (brought = [...brought, ref]),
		fit: () => (fitted += 1),
		frameWhenSettled: () => {},
		viewport: () => at,
		lookAt: (next: GraphTransform) => (at = next)
	} as unknown as GraphHandle;

	let {
		handle = $bindable(),
		arrangement,
		nodes,
		codeMoved,
		difference,
		selection,
		wallpaper,
		picking,
		chosen,
		reading,
		focus,
		onOpenNode,
		onExpand,
		onChoose,
		onChooseWithin,
		onHover,
		onMenu,
		onRetag,
		onInkPointer
	}: GraphSurfaceProps & { handle?: GraphHandle } = $props();

	handle = canvas;

	const marks = $derived(differenceMarks(difference));

	/** The sets a drop could land in, read the way the real surface reads them. */
	const drawn = $derived(arrangement === 'sets' ? drawnSetsOf(selection) : []);

	/** A drop in the first drawn set and outside every other one, which is the
	 *  shape of every drop: the place's membership among the drawn tags. */
	function dropped(notes: readonly string[]): void {
		onRetag?.({ notes, into: drawn.slice(0, 1), outOf: drawn.slice(1) });
	}
</script>

<ul
	aria-label="The graph"
	data-arrangement={arrangement ?? 'genealogy'}
	data-focus={focus}
	data-choosing={chosen ? 'yes' : undefined}
	data-wallpaper={wallpaper?.picture ?? ''}
	data-brought={brought.join(' ')}
	data-fitted={fitted}
	data-inking={onInkPointer ? 'yes' : undefined}
>
	{#each difference?.removed ?? [] as note (note.ref)}
		<li data-gone={note.ref}></li>
	{/each}
	{#each nodes as note (note.ref)}
		{@const marked =
			picking?.from === note.ref ? 'from' : picking?.taken.has(note.ref) ? 'taken' : undefined}
		<li>
			<button
				type="button"
				data-code-moved={codeMoved?.has(note.ref) ? 'yes' : undefined}
				data-difference={marks.get(note.ref)}
				data-marked={marked}
				data-chosen={chosen?.has(note.ref) ? 'yes' : undefined}
				data-lifted={reading?.open.has(note.ref)
					? reading.active === note.ref
						? 'reading'
						: 'open'
					: undefined}
				onclick={() =>
					picking ? picking.onPick(note.ref) : chosen ? onChoose?.(note.ref) : onOpenNode(note.ref)}
			>
				{note.address}
				{note.title}
			</button>
			<button type="button" data-expand={note.address} onclick={() => onExpand(note.ref)}>
				open what is under {note.address}
			</button>
			<button type="button" data-drop={note.address} onclick={() => dropped([note.ref])}>
				drop {note.address} in the first set
			</button>
			<button
				type="button"
				data-menu={note.address}
				onclick={() => onMenu?.({ clientX: 0, clientY: 0, ref: note.ref, foldable: true })}
			>
				menu on {note.address}
			</button>
			<button
				type="button"
				data-rest={note.address}
				onclick={() =>
					onHover?.({
						clientX: 0,
						clientY: 0,
						radius: 8,
						ref: note.ref,
						folded: 0,
						tags: note.tags
					})}
			>
				rest on {note.address}
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
		<!-- The fold a set draws where there is no room for its notes: the real
		     surface names the first note standing there and says the mark answers
		     for the whole set rather than for that note. -->
		{#if arrangement === 'sets' && nodes.length > 0}
			<button
				type="button"
				data-menu="a set"
				onclick={() =>
					onMenu?.({
						clientX: 0,
						clientY: 0,
						ref: nodes[0].ref,
						foldable: true,
						region: true
					})}
			>
				menu on a set's fold
			</button>
			<button
				type="button"
				data-rest="a set"
				onclick={() =>
					onHover?.({
						clientX: 0,
						clientY: 0,
						radius: 24,
						ref: nodes[0].ref,
						folded: nodes.length - 1,
						tags: drawn,
						region: true
					})}
			>
				rest on a set's fold
			</button>
		{/if}
		<button type="button" data-drop-chosen onclick={() => dropped([...(chosen ?? [])])}>
			drop the picked notes in the first set
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
