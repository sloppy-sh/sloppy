<script lang="ts">
	// A person's picture, with their initials until one is drawn.
	//
	// An `<img>` cannot be paused, so a reader who has asked for stillness gets
	// the picture sampled into a canvas once instead — an animated one then holds
	// its first frame rather than looping in the corner of the page.
	import { MediaQuery } from 'svelte/reactivity';
	import { cn } from '$lib/utils.js';
	import { initialsOf, type Person } from './person.js';

	let {
		person,
		size = 40,
		class: className
	}: {
		person: Person;
		/** Rendered px; the picture is drawn at twice this. */
		size?: number;
		class?: string;
	} = $props();

	const still = new MediaQuery('(prefers-reduced-motion: reduce)');

	/** The picture that would not load, so the initials stand in for it. */
	let broken = $state<string | null>(null);
	/** The picture on screen, so the initials are a fallback and never a backdrop
	 *  showing through one drawn over them. */
	let drawn = $state<string | null>(null);

	const picture = $derived(person.avatar && person.avatar !== broken ? person.avatar : null);
	const covered = $derived(picture !== null && drawn === picture);

	let source = $state<HTMLImageElement | null>(null);
	let frame = $state<HTMLCanvasElement | null>(null);

	function paint(): void {
		const img = source;
		const target = frame;
		if (!img?.naturalWidth || !target) return;
		const ctx = target.getContext('2d');
		if (!ctx) return;
		const scale = Math.max(target.width / img.naturalWidth, target.height / img.naturalHeight);
		const w = img.naturalWidth * scale;
		const h = img.naturalHeight * scale;
		ctx.clearRect(0, 0, target.width, target.height);
		ctx.drawImage(img, (target.width - w) / 2, (target.height - h) / 2, w, h);
		drawn = picture;
	}

	// A picture already in the cache can be complete before `onload` is bound.
	$effect(() => {
		if (source?.complete) paint();
	});
</script>

<!-- `alt=""`: every use of this sits beside the person's name, and a second
     reading of it is noise to anyone listening. -->
<span
	class={cn(
		'relative block shrink-0 overflow-hidden rounded-full bg-muted text-muted-foreground',
		className
	)}
	style:width="{size}px"
	style:height="{size}px"
>
	{#if !covered}
		<span
			aria-hidden="true"
			class="absolute inset-0 flex items-center justify-center font-medium"
			style:font-size="{Math.round(size * 0.38)}px"
		>
			{initialsOf(person)}
		</span>
	{/if}
	{#if picture && still.current}
		<img
			bind:this={source}
			src={picture}
			alt=""
			onload={paint}
			onerror={() => (broken = picture)}
			class="pointer-events-none absolute size-0 opacity-0"
		/>
		<canvas bind:this={frame} width={size * 2} height={size * 2} class="relative block size-full"
		></canvas>
	{:else if picture}
		<img
			src={picture}
			alt=""
			decoding="async"
			onload={() => (drawn = picture)}
			onerror={() => (broken = picture)}
			class="relative block size-full object-cover"
		/>
	{/if}
</span>
