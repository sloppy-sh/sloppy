<script lang="ts">
	// One dimension's values, one of which may be chosen — the shape both
	// labelling a note and narrowing a search take.
	import type { FacetSlot, LabelDimensionView } from '@sloppy/types';
	import { cn } from '$lib/utils.js';
	import { facetHue, watchFacetHues } from './hues.svelte.js';

	let {
		dimension,
		slot,
		value,
		emptyLabel,
		onchange,
		disabled = false
	}: {
		dimension: LabelDimensionView;
		/** Absent draws the chosen chip without a hue. */
		slot?: FacetSlot;
		/** `null` where this dimension says nothing. */
		value: string | null;
		/** The chip standing for that: "Any" when searching, "None" when labelling. */
		emptyLabel: string;
		onchange: (value: string | null) => void;
		disabled?: boolean;
	} = $props();

	const group = $props.id();

	$effect(watchFacetHues);

	function hue(of: string): string | undefined {
		const at = dimension.values.indexOf(of);
		if (slot === undefined || at < 0) return undefined;
		return facetHue(slot, at, dimension.values.length);
	}

	const chip =
		'inline-flex min-h-11 items-center gap-2 rounded-full border px-3.5 text-sm whitespace-nowrap transition-colors duration-150 ease-out peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background motion-reduce:transition-none';
	const chosen = 'border-foreground/30 text-foreground';
	const unchosen = 'border-border text-muted-foreground hover:text-foreground';
</script>

<fieldset class="min-w-0" {disabled}>
	<legend class="sr-only">{dimension.name}</legend>
	<div class="-mx-1 flex gap-1.5 overflow-x-auto scroll-fade-x px-1 py-0.5 [scrollbar-width:none]">
		<label class="shrink-0 cursor-pointer">
			<input
				type="radio"
				name={group}
				checked={value === null}
				onchange={() => onchange(null)}
				class="peer sr-only"
			/>
			<span class={cn(chip, value === null ? chosen : unchosen)}>{emptyLabel}</span>
		</label>

		{#each dimension.values as option (option)}
			{@const on = value === option}
			<label class="shrink-0 cursor-pointer">
				<input
					type="radio"
					name={group}
					checked={on}
					onchange={() => onchange(option)}
					class="peer sr-only"
				/>
				<span class={cn(chip, on ? chosen : unchosen)}>
					{#if on}
						<span
							aria-hidden="true"
							class="size-2.5 shrink-0 rounded-full bg-current"
							style:color={hue(option)}
						></span>
					{/if}
					{option}
				</span>
			</label>
		{/each}
	</div>
</fieldset>
