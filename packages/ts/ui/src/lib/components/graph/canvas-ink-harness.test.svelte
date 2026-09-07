<script lang="ts">
	import type { GraphTransform } from '@sloppy/graph';
	import type { InkStroke } from '@sloppy/types';
	import { untrack } from 'svelte';
	import CanvasInk, { type CanvasPen } from './canvas-ink.svelte';

	type Drive = (next: { transform?: GraphTransform; strokes?: InkStroke[] }) => void;

	let props: {
		layer: HTMLElement;
		transform?: GraphTransform;
		strokes?: InkStroke[];
		ondrawn: (stroke: InkStroke) => void;
		drive: (set: Drive) => void;
		held: (pen: CanvasPen | undefined) => void;
	} = $props();

	let transform = $state<GraphTransform | undefined>(untrack(() => props.transform));
	let strokes = $state<InkStroke[]>(untrack(() => props.strokes) ?? []);
	let pen = $state<CanvasPen>();

	$effect(() => untrack(() => props.held)(pen));

	untrack(() => props.drive)((next) => {
		if (next.transform !== undefined) transform = next.transform;
		if (next.strokes !== undefined) strokes = next.strokes;
	});
</script>

<CanvasInk layer={props.layer} {transform} {strokes} ondrawn={props.ondrawn} bind:pen />
