<script lang="ts">
	import type { SeriesData } from './types';

	let {
		items
	}: {
		items: (Pick<SeriesData, 'key' | 'label' | 'colour' | 'dash' | 'approach'> & {
			ran: boolean;
		})[];
	} = $props();
</script>

<ul class="flex flex-wrap gap-x-5 gap-y-2 text-[13px]" aria-label="Lines on the charts">
	{#each items as item (item.key)}
		<li class="flex items-center gap-2">
			<svg width="20" height="4" aria-hidden="true" class="shrink-0">
				<line
					x1="1.25"
					x2="18.75"
					y1="2"
					y2="2"
					class="series-line"
					data-approach={item.approach}
					style:stroke={item.colour}
					stroke-width="2.5"
					stroke-dasharray={item.dash || undefined}
					stroke-linecap="round"
				/>
			</svg>
			<span
				>{item.label}{#if !item.ran}<span class="text-muted-foreground"> (not run)</span>{/if}</span
			>
		</li>
	{/each}
</ul>
