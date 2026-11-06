<script lang="ts">
	import graphPicture from '../../../../../docs/images/reading-the-graph.jpg';
	import outlinePicture from '../../../../../docs/images/reading-the-outline.jpg';
	import { resolve } from '$app/paths';
	import { buttonVariants } from '@sloppy/ui/button';
	import { largeProjects } from '$lib/aggregate';
	import { frontPoints, heroLine } from '$lib/front';
	import { CONTACT, REPOSITORY } from '$lib/links';
	import Aggregate from '$lib/sections/Aggregate.svelte';
	import CrossProject from '$lib/sections/CrossProject.svelte';
	import Section from '$lib/sections/Section.svelte';
	import SiteFooter from '$lib/sections/SiteFooter.svelte';
	import SiteHeader from '$lib/sections/SiteHeader.svelte';

	let { data } = $props();

	const summary = $derived(data.summary);
	const points = $derived(frontPoints(summary));
	const hero = $derived(heroLine(summary));

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
	<title>Sloppy: same models, better outputs</title>
	<meta
		name="description"
		content="Sloppy keeps the reasons behind your code beside it. Your team owns them; coding agents read them before they change anything."
	/>
</svelte:head>

<div class="min-h-dvh bg-background text-foreground">
	<SiteHeader isSample={data.isSample} />

	<main>
		<section id="top" class="pt-[clamp(3.5rem,10vw,7rem)]" aria-labelledby="headline">
			<div class={container}>
				<h1 id="headline" class="type-display max-w-[18ch]">Same models, better outputs.</h1>
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
