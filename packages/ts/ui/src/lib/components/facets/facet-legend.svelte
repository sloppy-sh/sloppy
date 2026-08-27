<script lang="ts">
	// What the graph's colours mean while this dimension is the lens: every
	// value in the hue the canvas paints it, and how much of the graph it holds.
	import type { FacetSlot, LabelDimensionView } from '@sloppy/types';
	import { facetHue, unlabelledHue, watchFacetHues } from './hues.svelte.js';

	let {
		dimension,
		slot,
		counts,
		unlabelled
	}: {
		dimension: LabelDimensionView;
		slot: FacetSlot;
		/** Notes carrying each value. */
		counts: ReadonlyMap<string, number>;
		/** Notes this dimension says nothing about. */
		unlabelled: number;
	} = $props();

	$effect(watchFacetHues);
</script>

<ul class="flex flex-wrap gap-x-4 gap-y-2">
	{#each dimension.values as value, at (value)}
		<li class="flex items-center gap-2 text-sm">
			<span
				aria-hidden="true"
				class="size-2.5 shrink-0 rounded-full bg-current"
				style:color={facetHue(slot, at, dimension.values.length)}
			></span>
			<span>{value}</span>
			<span class="text-xs text-muted-foreground tabular-nums">
				{counts.get(value)?.toLocaleString() ?? 0}
			</span>
		</li>
	{/each}
	{#if unlabelled > 0}
		<li class="flex items-center gap-2 text-sm text-muted-foreground">
			<span
				aria-hidden="true"
				class="size-2.5 shrink-0 rounded-full bg-current"
				style:color={unlabelledHue()}
			></span>
			<span>No value</span>
			<span class="text-xs tabular-nums">{unlabelled.toLocaleString()}</span>
		</li>
	{/if}
</ul>
