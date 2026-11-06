<script lang="ts">
	import ChartLegend from '$lib/charts/ChartLegend.svelte';
	import LineChart from '$lib/charts/LineChart.svelte';
	import { BETTER, subjectsWithRuns, type Metric } from '$lib/readings';
	import { axisOf, seriesOf, xsOf } from '$lib/series';
	import { AXIS_FORMAT, chartTitle, FORMAT } from '$lib/metrics';
	import type { PageSummary, Tier } from '$lib/summary';

	let {
		summary,
		tier,
		metrics,
		only
	}: {
		summary: PageSummary;
		tier: Tier;
		metrics: Metric[];
		/** The projects to draw; every project with runs where absent. */
		only?: string[];
	} = $props();

	const subjects = $derived(only ?? subjectsWithRuns(summary));
	const xs = $derived(xsOf(summary, subjects));

	const charts = $derived(
		metrics.map((metric) => {
			const series = seriesOf(summary, subjects, tier, metric);
			return { metric, series, ...axisOf(metric, series) };
		})
	);
	const legend = $derived(
		(charts[0]?.series ?? []).map((s) => ({ ...s, ran: s.values.some((v) => v !== null) }))
	);
</script>

<div class="space-y-12">
	<div data-chart><ChartLegend items={legend} /></div>
	<div class={['grid gap-x-12 gap-y-14', charts.length > 1 && 'lg:grid-cols-2']}>
		{#each charts as c (c.metric)}
			<LineChart
				id="chart-{c.metric}"
				title={chartTitle(c.metric, c.domain)}
				better={BETTER[c.metric]}
				height={charts.length > 1 ? 280 : 340}
				{xs}
				series={c.series}
				y={{ domain: c.domain, ticks: c.ticks, format: AXIS_FORMAT[c.metric] }}
				valueFormat={FORMAT[c.metric]}
			/>
		{/each}
	</div>
</div>
