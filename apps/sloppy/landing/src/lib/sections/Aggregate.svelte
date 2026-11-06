<script lang="ts">
	import {
		AGGREGATE_LABEL,
		AGGREGATE_METRICS,
		aggregateNote,
		aggregates,
		type Aggregate
	} from '$lib/aggregate';
	import { ratioSaid, scoreSaid } from '$lib/said';
	import { resolve } from '$app/paths';
	import { BENCH_README } from '$lib/links';
	import type { PageSummary } from '$lib/summary';

	let {
		summary,
		invite = true
	}: {
		summary: PageSummary;
		/** Close with the invitation to try it, where the page does not already. */
		invite?: boolean;
	} = $props();

	const columns = $derived(aggregates(summary));
	const ROWS: { label: string; said: (a: Aggregate) => string }[] = [
		{ label: 'Answer quality', said: (a) => scoreSaid(a.score) },
		...AGGREGATE_METRICS.map((m) => ({
			label: AGGREGATE_LABEL[m],
			said: (a: Aggregate) => ratioSaid(m, a.ratio[m])
		}))
	];
	const first = $derived(columns[0]);
	const note = $derived(aggregateNote(summary, columns));
</script>

{#if first}
	<figure>
		<div class="overflow-x-auto">
			<table class="w-full max-w-2xl text-sm tabular-nums sm:text-base">
				<thead class="text-muted-foreground">
					<tr class="border-b">
						<th scope="col" class="py-2 pr-3 text-left font-normal"
							>With Sloppy, on average, against</th
						>
						{#each columns as c (c.against.id)}
							<th scope="col" class="px-2 py-2 text-right font-normal">{c.against.label}</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each ROWS as row (row.label)}
						<tr class="border-b border-border/60">
							<th scope="row" class="py-2 pr-3 text-left font-medium">{row.label}</th>
							{#each columns as c (c.against.id)}
								<td class="py-2 pl-2 text-right sm:whitespace-nowrap">{row.said(c)}</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<figcaption class="mt-3 max-w-2xl text-sm text-muted-foreground">{note}</figcaption>
	</figure>
{/if}
{#if first && invite}
	<p class="mt-6 max-w-2xl">
		These are averages; your codebase will land somewhere around them.
		<a href="{resolve('/')}#start" class="font-medium underline underline-offset-4"
			>Try it on your repo</a
		>, or
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- links off this site -->
		<a href={BENCH_README} class="underline underline-offset-4">run the same benchmark on it</a>.
	</p>
{/if}
