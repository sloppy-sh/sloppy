<script lang="ts">
	/* eslint-disable no-useless-assignment -- the page binds the handle out and
	   calls it; nothing in here reads it back. */

	// The canvas, cut down to what a page suite can tap: one control per drawn
	// note, and one for opening the fold it stands for. What a tap MEANS is the
	// real surface's contract, held by `@sloppy/graph`'s mount suite; this stands
	// in for the pixels.
	import { differenceMarks, type GraphHandle, type GraphSurfaceProps } from '@sloppy/graph';

	let brought = $state<string[]>([]);
	let fitted = $state(0);

	const canvas = {
		bringTo: (ref: string) => (brought = [...brought, ref]),
		fit: () => (fitted += 1)
	} as unknown as GraphHandle;

	let {
		handle = $bindable(),
		nodes,
		codeMoved,
		difference,
		wallpaper,
		picking,
		chosen,
		reading,
		focus,
		onOpenNode,
		onExpand,
		onChoose,
		onChooseWithin,
		onMenu,
		onInkPointer
	}: GraphSurfaceProps & { handle?: GraphHandle } = $props();

	handle = canvas;

	const marks = $derived(differenceMarks(difference));
</script>

<ul
	aria-label="The graph"
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
