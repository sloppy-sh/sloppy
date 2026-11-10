<script lang="ts">
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import { approach } from '$lib/approaches';
	import BarChart from '$lib/charts/BarChart.svelte';
	import { CHART_TITLE, FINER, FORMAT, TITLE } from '$lib/metrics';
	import { PROJECTS, reasonFor } from '$lib/projects';
	import {
		approachesRun,
		belowFloor,
		BETTER,
		compare,
		FAMILY,
		groupOf,
		labelOf,
		METRICS,
		modelOf,
		pairOf,
		tiersWithRuns,
		underRecommended,
		valueOf,
		WORD_FLOOR,
		type Metric
	} from '$lib/readings';
	import { ratioSaid, scoreSaid } from '$lib/said';
	import ModelTabs from '$lib/sections/ModelTabs.svelte';
	import PageHead from '$lib/sections/PageHead.svelte';
	import SiteFooter from '$lib/sections/SiteFooter.svelte';
	import SiteHeader from '$lib/sections/SiteHeader.svelte';
	import TokenNote from '$lib/sections/TokenNote.svelte';
	import { count, tokens, type Tier } from '$lib/summary';

	let { data } = $props();
	const summary = $derived(data.summary);
	const project = $derived(PROJECTS.find((p) => p.slug === data.slug)!);
	const facts = $derived(summary.subjects[project.subject]);
	const label = $derived(labelOf(summary, project.subject));
	const ran = $derived(tiersWithRuns(summary, project.subject));
	let tier: Tier = $state(
		untrack(() => (ran.includes('medium') ? 'medium' : (ran[0] ?? 'medium')))
	);

	const size = $derived(
		[
			facts.code_lines !== null ? `${tokens(facts.code_lines)} lines of code` : null,
			facts.docs_words !== null
				? `${tokens(facts.docs_words)} words of docs in ${count(facts.docs_files)} files`
				: null
		]
			.filter(Boolean)
			.join(', ')
	);

	const floor = $derived(
		belowFloor(summary, project.subject)
			? ` Below the ${count(WORD_FLOOR)}-word floor the others were chosen by; measured on request.`
			: ''
	);

	const pair = $derived(pairOf(summary, project.subject, tier));
	/** Both values, finer where the usual rounding would show a difference as none. */
	const valuesSaid = (metric: Metric, sloppy: number, plain: number, level: boolean) => {
		const [s, p] = [FORMAT[metric](sloppy), FORMAT[metric](plain)];
		return s === p && !level ? [FINER[metric](sloppy), FINER[metric](plain)] : [s, p];
	};
	const differenceSaid = (metric: Metric, sloppy: number, plain: number) =>
		metric === 'score' ? scoreSaid(sloppy - plain) : ratioSaid(metric, sloppy / plain - 1);

	const blocks = $derived(
		METRICS.map((metric) => {
			const bars = approachesRun(summary).map((a) => {
				const g = groupOf(summary, project.subject, tier, a);
				return {
					key: a.id,
					label: a.label,
					colour: a.colour,
					hollow: a.dash !== '',
					value: g ? valueOf(g, metric) : null,
					runs: g?.n ?? 0
				};
			});
			const max =
				metric === 'score' ? 1 : Math.max(...bars.map((b) => b.value ?? 0), Number.EPSILON);
			const c = pair && compare(pair, metric);
			const [sloppy, plain] = c ? valuesSaid(metric, c.sloppy, c.plain, c.verdict === 'level') : [];
			return {
				metric,
				bars,
				max,
				said: c
					? `${approach('sloppy').label} ${sloppy}, docs alone ${plain}: ${differenceSaid(metric, c.sloppy, c.plain)}.`
					: null,
				why: c && pair ? reasonFor(project, tier, metric, c.verdict, pair) : null
			};
		})
	);
	const model = $derived(modelOf(summary, tier) ?? FAMILY[tier]);
	const basis = $derived(
		underRecommended(summary, project.subject)
			? "Sloppy's bar is this project's documents shaped the way the practices set out; the other two are its documents as it keeps them."
			: "Every bar is this project's documents as it keeps them."
	);
</script>

<svelte:head>
	<title>{label}: Sloppy's results</title>
	<meta
		name="description"
		content="How Sloppy did on {label}: answer quality, tokens, cost and time against Claude Code with the docs alone, and why."
	/>
</svelte:head>

<div class="min-h-dvh bg-background text-foreground">
	<SiteHeader isSample={data.isSample} />
	<main>
		<PageHead trail={[{ label: 'Results', href: resolve('/results') }, { label }]} title={label}>
			<p>{project.about}{size ? ` ${size}.` : ''}{floor}</p>
		</PageHead>

		<section class="mx-auto max-w-6xl space-y-10 px-4 pt-12 pb-24 sm:px-8" aria-label="Results">
			<div class="flex flex-wrap items-center justify-between gap-4">
				<ModelTabs bind:tier {ran} />
				<p class="text-sm text-muted-foreground" data-chart>
					{model}, Sloppy as it ships. {basis}
				</p>
			</div>
			<div class="grid gap-x-12 gap-y-14 md:grid-cols-2">
				{#each blocks as b (b.metric)}
					<article class="border-t pt-6" aria-labelledby="{b.metric}-title">
						<h2 id="{b.metric}-title" class="text-xl font-semibold">{TITLE[b.metric]}</h2>
						<div class="mt-4">
							<BarChart
								title={CHART_TITLE[b.metric]}
								better={BETTER[b.metric]}
								bars={b.bars}
								format={FORMAT[b.metric]}
								max={b.max}
							/>
						</div>
						{#if b.said}
							<p class="mt-5 font-medium">{b.said}</p>
							<p class="type-body mt-1 text-muted-foreground">{b.why}</p>
						{/if}
					</article>
				{/each}
			</div>
			<TokenNote />
			<p>
				<a
					href={resolve('/projects/[slug]/questions', { slug: project.slug })}
					class="font-medium underline underline-offset-2">See the questions</a
				>
				<span class="text-muted-foreground">
					asked on {label}, each approach's answers, and why one scored higher.</span
				>
			</p>
		</section>
	</main>
	<SiteFooter generatedAt={summary.generated_at} />
</div>
