<script lang="ts">
	// Putting a note into one value of each dimension. One value per dimension is
	// the invariant that makes facets sets rather than tags, and it falls out of
	// the label set being keyed by dimension.
	import type { LabelSet } from '@sloppy/types';
	import type { LabelPickerProps } from './contract.js';
	import FacetValues from './facet-values.svelte';

	let {
		dimensions,
		labels,
		slotFor,
		onassign,
		refused = null,
		manageHref
	}: LabelPickerProps = $props();

	/** What the reader asked for, while it is on its way to the server. */
	let pending = $state<LabelSet | null>(null);
	let failed = $state(false);
	let asked = 0;

	const shown = $derived(pending ?? labels);

	async function choose(dimension: string, value: string | null): Promise<void> {
		const next: LabelSet = { ...shown };
		if (value === null) delete next[dimension];
		else next[dimension] = value;
		const mine = ++asked;
		pending = next;
		failed = false;
		try {
			await onassign(next);
		} catch {
			failed = true;
		} finally {
			// A second choice made while this one was in flight owns the chips now.
			if (mine === asked) pending = null;
		}
	}
</script>

{#if dimensions.length > 0}
	<div class="space-y-4">
		{#each dimensions as dimension (dimension.ref)}
			<FacetValues
				{dimension}
				slot={slotFor(dimension.name)}
				value={shown[dimension.name] ?? null}
				emptyLabel="None"
				onchange={(value) => void choose(dimension.name, value)}
			/>
		{/each}

		{#if failed}
			<p class="text-sm text-destructive" role="alert">
				{refused ?? 'Sloppy could not save that label. Try again in a moment.'}
			</p>
		{/if}
	</div>
{:else if manageHref}
	<p class="text-sm text-muted-foreground">
		<a href={manageHref} class="underline underline-offset-4">Declare a dimension</a>
		to sort this note along one.
	</p>
{/if}
