<script lang="ts">
	// The canvas, hosted in Svelte. `@sloppy/graph`'s README is how a host wires
	// one up; DESIGN.md § "The canvas" is why the renderer is imperative.
	import { mountGraph, type GraphHandle, type GraphSurfaceProps } from '@sloppy/graph';
	import LayoutWorker from '@sloppy/graph/layout-worker?worker';
	import { untrack } from 'svelte';

	// The handle is bound out rather than driven by a prop: asking twice for the
	// same note has to move the canvas twice, which a value cannot say.
	let { handle = $bindable(), ...props }: GraphSurfaceProps & { handle?: GraphHandle } = $props();

	let host = $state<HTMLElement>();

	const options = () => ({ ...props, createLayoutWorker: () => new LayoutWorker() });

	$effect(() => {
		const element = host;
		if (!element) return;
		// `untrack`, or the first pan's prop change tears the scene down and the
		// reader loses the viewport they just moved.
		handle = mountGraph(element, untrack(options));
		return () => {
			handle?.destroy();
			handle = undefined;
		};
	});

	$effect(() => {
		handle?.update(options());
	});
</script>

<div bind:this={host} class="size-full"></div>
