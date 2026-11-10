<script lang="ts">
	import graphPicture from '../../../../../docs/images/reading-the-graph.jpg';
	import outlinePicture from '../../../../../docs/images/reading-the-outline.jpg';
	import { resolve } from '$app/paths';
	import { buttonVariants } from '@sloppy/ui/button';
	import { largeProjects } from '$lib/aggregate';
	import { contextLine, frontPoints, heroStats } from '$lib/front';
	import { FAMILY_LABEL, type FeaturedRun } from '$lib/questions/types';
	import { modelOf } from '$lib/readings';
	import { CONTACT, REPOSITORY } from '$lib/links';
	import Aggregate from '$lib/sections/Aggregate.svelte';
	import CrossProject from '$lib/sections/CrossProject.svelte';
	import Section from '$lib/sections/Section.svelte';
	import SiteFooter from '$lib/sections/SiteFooter.svelte';
	import SiteHeader from '$lib/sections/SiteHeader.svelte';

	let { data } = $props();

	const summary = $derived(data.summary);
	const points = $derived(frontPoints(summary));
	const hero = $derived(contextLine(summary));
	const stats = $derived(heroStats(summary));
	const model = $derived(modelOf(summary, 'medium'));

	const stepsSaid = (r: FeaturedRun) =>
		`${r.steps} ${r.steps === 1 ? 'step' : 'steps'}${r.firstSession ? ' over two sessions' : ''}${r.subagentCalls ? ` +${r.subagentCalls} inside helpers` : ''}`;

	const SETUP = `git clone ${REPOSITORY}
cd sloppy && pnpm install && pnpm build:packages
cd packages/ts/cli && pnpm link --global
cd your-repo && sloppy init`;

	const MCP_JSON = `{ "mcpServers": { "sloppy": { "type": "stdio", "command": "sloppy", "args": ["mcp"] } } }`;

	const container = 'mx-auto max-w-6xl px-4 sm:px-8';
	const code = 'overflow-x-auto rounded-lg border bg-muted p-3 font-mono text-xs leading-relaxed';
	const link = 'underline underline-offset-4 hover:text-muted-foreground';
</script>

<svelte:head>
	<title>Sloppy: better agent performance, for less</title>
	<meta
		name="description"
		content="Coding agents cost less and answer at least as well with Sloppy, which keeps the reasons behind your code beside it. Every run behind the figures is published, step by step."
	/>
</svelte:head>

<div class="min-h-dvh bg-background text-foreground">
	<SiteHeader isSample={data.isSample} />

	<main>
		<section id="top" class="pt-[clamp(3.5rem,10vw,7rem)]" aria-labelledby="headline">
			<div class={container}>
				<h1 id="headline" class="type-display max-w-[18ch]">Better agent performance, for less.</h1>
				{#if stats.length}
					<dl class="mt-10 grid max-w-3xl grid-cols-1 gap-6 sm:grid-cols-3">
						{#each stats as stat (stat.label)}
							<div class="flex flex-col-reverse gap-2 border-t pt-4">
								<dt class="text-muted-foreground">{stat.label}</dt>
								<dd
									class="text-[clamp(2.5rem,1.6rem+3vw,3.5rem)] leading-none font-semibold tracking-tight tabular-nums"
								>
									{stat.value}
								</dd>
							</div>
						{/each}
					</dl>
				{/if}
				{#if hero}
					<p class="mt-6 max-w-[52ch] text-lg leading-relaxed text-muted-foreground">{hero}</p>
				{/if}
				<div class="mt-8 flex flex-wrap gap-3">
					<a href="#start" class={buttonVariants({ size: 'lg' })}>Get started</a>
					<a href={resolve('/how')} class={buttonVariants({ variant: 'outline', size: 'lg' })}
						>How it works</a
					>
				</div>
			</div>
			<figure class="{container} mt-14 sm:mt-20">
				<img
					src={graphPicture}
					alt="A project's decisions drawn as a graph, each placed under the decision it came out of, with one open beside it and an assistant writing in the same graph."
					width="1600"
					height="1039"
					loading="eager"
					class="screenshot h-auto w-full rounded-xl border"
				/>
			</figure>
		</section>

		<Section id="results" sheet title="Built for large codebases.">
			<Aggregate {summary} invite={false} />
			<div class="mt-12">
				<CrossProject {summary} tier="medium" metrics={['score']} only={largeProjects(summary)} />
			</div>
			{#if points.length}
				<ul class="type-body mt-10 grid gap-6 md:grid-cols-3">
					{#each points as point (point)}
						<li class="border-t pt-4">{point}</li>
					{/each}
				</ul>
			{/if}
			<p class="mt-8 flex flex-wrap gap-x-6 gap-y-2 font-medium">
				<a href={resolve('/results')} class={link}>Every project</a>
				<a href={resolve('/methodology')} class={link}>How we tested</a>
			</p>
		</Section>

		{#if data.featured.length}
			<Section id="evidence" title="What the agent did.">
				<p class="type-body max-w-[62ch]">
					Every run is published: what the agent was sent, every step it took, its answer and its
					grades.
				</p>
				<div class="mt-8 overflow-x-auto">
					<table class="w-full min-w-[40rem] text-sm tabular-nums">
						<caption class="caption-bottom pt-3 text-left text-muted-foreground">
							{model ?? 'One model'} throughout. Scores are each approach's mean over its runs; the steps
							and the downloads are the run closest to that mean.
						</caption>
						<thead class="text-muted-foreground">
							<tr class="border-b">
								<th scope="col" class="py-2 pr-4 text-left font-normal">Question</th>
								<th scope="col" class="px-2 py-2 text-right font-normal"
									>Docs alone<span class="block text-xs">mean score, steps</span></th
								>
								<th scope="col" class="px-2 py-2 text-right font-normal"
									>With Sloppy<span class="block text-xs">mean score, steps</span></th
								>
								<th scope="col" class="py-2 pl-4 text-left font-normal">The record</th>
							</tr>
						</thead>
						<tbody>
							{#each data.featured as row (row.task)}
								<tr class="border-b border-border/60 align-top">
									<th scope="row" class="py-3 pr-4 text-left font-normal">
										<span class="block text-muted-foreground"
											>{row.label} · {FAMILY_LABEL[row.family] ?? row.family}</span
										>
										<span class="block font-medium">{row.question}</span>
									</th>
									{#each [row.plain, row.sloppy] as run (run.runId)}
										<td class="px-2 py-3 text-right">
											<span class="block font-semibold">{run.score.toFixed(2)}</span>
											<span class="block text-muted-foreground">{stepsSaid(run)}</span>
										</td>
									{/each}
									<td class="py-3 pl-4">
										<a
											href="{resolve('/projects/[slug]/questions', { slug: row.slug })}#{row.task}"
											class="{link} block">Answers</a
										>
										<span class="block text-muted-foreground">
											Download:
											<a
												href={resolve('/runs/[id].json', { id: row.plain.runId })}
												download
												class={link}>docs alone</a
											>,
											<a
												href={resolve('/runs/[id].json', { id: row.sloppy.runId })}
												download
												class={link}>with Sloppy</a
											>
										</span>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</Section>
		{/if}

		<Section id="start" title="Try it on your repo.">
			<div class="grid gap-10 lg:grid-cols-12">
				<div class="min-w-0 space-y-4 lg:col-span-5">
					<p class="type-body">MIT licensed; notes stay files in your repository.</p>
					<pre class={code}><code>{SETUP}</code></pre>
					<p class="type-body">
						Then commit this as <code class="font-mono text-[0.9em]">.mcp.json</code>:
					</p>
					<pre class={code}><code>{MCP_JSON}</code></pre>
					<div class="flex flex-wrap gap-3 pt-2">
						<!-- eslint-disable svelte/no-navigation-without-resolve -- links off this site -->
						<a href={REPOSITORY} class={buttonVariants({ size: 'lg' })}>View on GitHub</a>
						<a href={CONTACT} class={buttonVariants({ variant: 'outline', size: 'lg' })}
							>Talk to us</a
						>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					</div>
				</div>
				<figure class="lg:col-span-7">
					<img
						src={outlinePicture}
						alt="The outline view: a project's notes as rows, one opened in place to show what it says and the code it points at."
						width="1600"
						height="1039"
						loading="lazy"
						class="screenshot h-auto w-full rounded-xl border"
					/>
				</figure>
			</div>
			<!-- TODO(SoSweetHam): an npm package and `npx sloppy` belong here once one is published. -->
		</Section>
	</main>

	<SiteFooter generatedAt={summary.generated_at} />
</div>
