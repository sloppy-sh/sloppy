<script lang="ts">
	// The question the reader asks the canvas, and the legend for its answer.
	// DESIGN.md § "Hue — the tags you selected, and only those": selected tags
	// lead, in the order they were selected, because that order is what hands out
	// the hues.
	import { assignTagHueSlots, type Tag, type TagCount } from '@sloppy/types';
	import { tick } from 'svelte';
	import { cn } from '$lib/utils.js';
	import { scrollFade } from '$lib/scroll-fade.svelte.js';

	let {
		tags,
		selected,
		onselect
	}: {
		/** Every tag the reader has used, most-used first. */
		tags: readonly TagCount[];
		/** In selection order. */
		selected: readonly Tag[];
		onselect: (tags: Tag[]) => void;
	} = $props();

	const slots = $derived(assignTagHueSlots(selected));
	const counts = $derived(new Map(tags.map((entry) => [entry.tag, entry.notes])));

	/** Selected first, in selection order; then the rest as the read ordered them. */
	const order = $derived([
		...selected,
		...tags.map((entry) => entry.tag).filter((tag) => !slots.has(tag))
	]);

	let rail = $state<HTMLElement | null>(null);

	async function toggle(tag: Tag, tapped: HTMLElement): Promise<void> {
		const dropping = slots.has(tag);
		onselect(dropping ? selected.filter((held) => held !== tag) : [...selected, tag]);
		if (dropping) return;
		await tick();
		keepInView(tapped);
	}

	/**
	 * Selecting has moved the tapped chip to the head of the rail, away from
	 * where the finger left it — and the legend is read from that head, so show
	 * as much of it as fits with the tag still on screen.
	 */
	function keepInView(tapped: HTMLElement): void {
		if (!rail) return;
		const at = rail.scrollLeft;
		const box = tapped.getBoundingClientRect();
		const start = box.left - rail.getBoundingClientRect().left + at;
		const end = start + box.width;
		const seen = rail.clientWidth;
		const to = end <= seen ? 0 : Math.min(start, Math.max(at, end - seen));
		if (to !== at) rail.scrollTo({ left: to });
	}

	const chip =
		'inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm whitespace-nowrap transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none';
</script>

<div class="space-y-1.5">
	<div class="flex items-baseline gap-3">
		<h2 class="min-w-0 flex-1 truncate text-sm text-muted-foreground">
			<!-- The word only appears once several tags can be selected at all, which
			     is the first moment it means anything. -->
			{selected.length > 1 ? 'Notes with any of these' : 'Tags'}
		</h2>
		{#if selected.length > 0}
			<button
				type="button"
				onclick={() => onselect([])}
				class="shrink-0 text-sm text-muted-foreground underline underline-offset-4 transition-colors duration-150 ease-out hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
			>
				Clear
			</button>
		{/if}
	</div>

	<div
		bind:this={rail}
		class="-mx-1 flex gap-1.5 overflow-x-auto scroll-fade-x px-1 py-0.5 [scrollbar-width:none]"
		{@attach scrollFade('x')}
	>
		{#each order as tag (tag)}
			{@const slot = slots.get(tag)}
			<button
				type="button"
				aria-pressed={slot !== undefined}
				onclick={(event) => void toggle(tag, event.currentTarget)}
				style={slot === undefined ? undefined : `color: var(--facet-${slot})`}
				class={cn(
					chip,
					slot === undefined
						? 'border-transparent text-muted-foreground hover:text-foreground'
						: 'border-current'
				)}
			>
				{#if slot !== undefined}
					<span aria-hidden="true" class="size-2.5 shrink-0 rounded-full bg-current"></span>
				{/if}
				{tag}
				{#if slot === undefined}
					<span class="text-xs text-muted-foreground/70">{counts.get(tag)?.toLocaleString()}</span>
				{/if}
			</button>
		{/each}
	</div>
</div>
