<script lang="ts">
	// A picture somebody chose to be seen as. An `<img>` cannot be paused, so a
	// reader who has asked for stillness gets its first frame sampled into a
	// canvas instead of a loop — DESIGN.md § Motion.
	import { MediaQuery } from 'svelte/reactivity';
	import { cn } from '$lib/utils.js';

	let {
		src,
		sample = 1024,
		class: className,
		onshown,
		onbroken
	}: {
		src: string;
		/** Longest edge of the still frame, in px. */
		sample?: number;
		class?: string;
		/** The picture is on screen, so whatever stood in for it can go. */
		onshown?: () => void;
		onbroken?: () => void;
	} = $props();

	const still = new MediaQuery('(prefers-reduced-motion: reduce)');

	let source = $state<HTMLImageElement | null>(null);
	let frame = $state<HTMLCanvasElement | null>(null);

	function paint(): void {
		const img = source;
		const target = frame;
		if (!img?.naturalWidth || !target) return;
		const ctx = target.getContext('2d');
		if (!ctx) return;
		const scale = Math.min(1, sample / Math.max(img.naturalWidth, img.naturalHeight));
		target.width = Math.round(img.naturalWidth * scale);
		target.height = Math.round(img.naturalHeight * scale);
		ctx.drawImage(img, 0, 0, target.width, target.height);
		onshown?.();
	}

	// A picture already in the cache can be complete before `onload` is bound.
	$effect(() => {
		if (src && source?.complete) paint();
	});
</script>

<!-- `alt=""`: every use of this sits beside the person's name, and a second
     reading of it is noise to anyone listening. -->
{#if still.current}
	<img
		bind:this={source}
		{src}
		alt=""
		onload={paint}
		onerror={() => onbroken?.()}
		class="pointer-events-none absolute size-0 opacity-0"
	/>
	<canvas bind:this={frame} class={cn('block object-cover', className)}></canvas>
{:else}
	<img
		{src}
		alt=""
		decoding="async"
		draggable="false"
		onload={() => onshown?.()}
		onerror={() => onbroken?.()}
		class={cn('block object-cover', className)}
	/>
{/if}
