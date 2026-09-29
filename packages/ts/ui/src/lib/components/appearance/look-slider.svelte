<script lang="ts">
	// One channel of a look, dragged rather than picked. The strip is a thumb's
	// height so the whole of it takes a drag, not just the handle.
	import { Slider } from '$lib/components/ui/slider/index.js';

	let {
		label,
		value,
		min,
		max,
		step,
		says,
		ondrag,
		onchange
	}: {
		label: string;
		value: number;
		min: number;
		max: number;
		step: number;
		/** What dragging along this row gets somebody, where the row alone does
		 *  not say it. */
		says?: string;
		/** Every value the thumb passes through, so what it changes follows it. */
		ondrag: (value: number) => void;
		/** Where the thumb was let go. */
		onchange: (value: number) => Promise<void> | void;
	} = $props();
</script>

<fieldset class="space-y-2">
	<legend class="mb-2 text-sm font-medium">{label}</legend>
	<Slider
		type="single"
		{value}
		{min}
		{max}
		{step}
		{label}
		class="h-control"
		onValueChange={ondrag}
		onValueCommit={(next: number) => void onchange(next)}
	/>
	{#if says}<p class="text-xs text-muted-foreground">{says}</p>{/if}
</fieldset>
