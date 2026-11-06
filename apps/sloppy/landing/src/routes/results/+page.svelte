<script lang="ts">
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import { aggregates, largeProjects } from '$lib/aggregate';
	import { PROJECTS } from '$lib/projects';
	import { oneLine } from '$lib/oneLine';
	import { inWords, labelOf, METRICS, subjectsWithRuns, tiersWithRuns } from '$lib/readings';
	import Aggregate from '$lib/sections/Aggregate.svelte';
	import CrossProject from '$lib/sections/CrossProject.svelte';
	import ModelTabs from '$lib/sections/ModelTabs.svelte';
	import PageHead from '$lib/sections/PageHead.svelte';
	import SiteFooter from '$lib/sections/SiteFooter.svelte';
	import SiteHeader from '$lib/sections/SiteHeader.svelte';
	import type { Tier } from '$lib/summary';

	let { data } = $props();
	const summary = $derived(data.summary);
	const ran = $derived(tiersWithRuns(summary));
	let tier: Tier = $state(
		untrack(() => (ran.includes('medium') ? 'medium' : (ran[0] ?? 'medium')))
	);

	const large = $derived(largeProjects(summary));
	/** Said only while it is true of the numbers above: more tokens read, less paid. */
	const dearer = $derived(
		aggregates(summary).some((a) => (a.ratio.input ?? 0) > 0 && (a.ratio.cost ?? 0) < 0)
	);
	const projects = $derived(
		subjectsWithRuns(summary).flatMap((subject) => {
			const project = PROJECTS.find((p) => p.subject === subject);
			return project
				? [{ project, label: labelOf(summary, subject), line: oneLine(summary, subject, tier) }]
				: [];
		})
	);
</script>

<svelte:head>
	<title>Sloppy's results</title>
	<meta
		name="description"
		content="Sloppy against Claude Code with the docs alone: answer quality, tokens, cost and time on real projects."
	/>
</svelte:head>

<div class="min-h-dvh bg-background text-foreground">
	<SiteHeader isSample={data.isSample} />
	<main>
		<PageHead
			trail={[{ label: 'Results' }]}
			title="Results across {inWords(projects.length)} large projects."
		/>

		<section class="section-pad mx-auto max-w-6xl space-y-10 px-4 sm:px-8" aria-label="Charts">
			<div>
				<h2 class="type-h2">Averaged across the {inWords(large.length)}</h2>
				<div class="mt-6"><Aggregate {summary} /></div>
				{#if dearer}
					<p class="type-body mt-6 max-w-[70ch] text-muted-foreground">
						More tokens, less paid: re-reading the conversation is billed at a fraction of the
						price, and with Sloppy an agent takes in less new text and writes shorter answers — the
						parts that cost.
					</p>
				{/if}
			</div>
			<ModelTabs bind:tier {ran} />
			<CrossProject {summary} {tier} metrics={METRICS} />
		</section>

		<section class="section-pad border-t bg-card" aria-labelledby="by-project">
			<div class="mx-auto max-w-6xl px-4 sm:px-8">
				<h2 id="by-project" class="type-h2">By project, with Sloppy against the docs alone</h2>
				<ul class="mt-8 divide-y border-y">
					{#each projects as p (p.project.slug)}
						<li>
							<a
								href={resolve('/projects/[slug]', { slug: p.project.slug })}
								class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-4 hover:text-muted-foreground"
							>
								<span class="font-semibold">{p.label}</span>
								<span class="text-muted-foreground">{p.line ?? 'Not run with this model.'} →</span>
							</a>
						</li>
					{/each}
				</ul>
				<p class="mt-6">
					<a href={resolve('/questions')} class="font-medium underline underline-offset-2"
						>See the questions</a
					>
					<span class="text-muted-foreground"
						>, each approach's answers, and why one scored higher.</span
					>
				</p>
			</div>
		</section>
	</main>
	<SiteFooter generatedAt={summary.generated_at} />
</div>
