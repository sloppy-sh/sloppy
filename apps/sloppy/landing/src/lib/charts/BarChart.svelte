<script lang="ts">
	import BetterBadge from './BetterBadge.svelte';
	import type { Bar } from './types';

	let {
		title,
		better,
		bars,
		format,
		max
	}: {
		title: string;
		better: 'higher' | 'lower';
		bars: Bar[];
		format: (v: number) => string;
		/** The value a full-width bar stands for. */
		max: number;
	} = $props();

	const width = (v: number) => `${Math.max(0.5, Math.min(100, (v / max) * 100))}%`;
</script>

<figure class="min-w-0" data-chart>
	<figcaption class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
		<h3 class="text-base font-semibold">{title}</h3>
		<BetterBadge {better} />
	</figcaption>
	<dl class="mt-4 space-y-2.5 text-sm">
		{#each bars as bar (bar.key)}
			<div class="grid grid-cols-[8.5rem_1fr] items-center gap-3">
				<dt class="truncate text-muted-foreground">{bar.label}</dt>
				<dd class="flex min-w-0 items-center gap-2">
					{#if bar.value === null}
						<span class="text-muted-foreground">not run</span>
					{:else}
						<span
							class="h-3.5 shrink-0 rounded-sm border-2"
							style:width="calc({width(bar.value)} - 4.5rem)"
							style:min-width="3px"
							style:border-color={bar.colour}
							style:background={bar.hollow ? 'transparent' : bar.colour}
							title="{bar.runs} runs"
						></span>
						<span class="font-medium tabular-nums">{format(bar.value)}</span>
					{/if}
				</dd>
			</div>
		{/each}
	</dl>
</figure>
