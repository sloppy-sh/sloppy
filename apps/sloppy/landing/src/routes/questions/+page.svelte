<script lang="ts">
	import { resolve } from '$app/paths';
	import { PROJECTS } from '$lib/projects';
	import QuestionList from '$lib/questions/QuestionList.svelte';
	import PageHead from '$lib/sections/PageHead.svelte';
	import SiteFooter from '$lib/sections/SiteFooter.svelte';
	import SiteHeader from '$lib/sections/SiteHeader.svelte';

	let { data } = $props();
	const labels = $derived(data.labels);
	const subjects = $derived(Object.keys(labels));
	const projects = $derived(
		PROJECTS.filter((p) => subjects.includes(p.subject)).map((p) => ({
			slug: p.slug,
			label: labels[p.subject]
		}))
	);
</script>

<svelte:head>
	<title>The questions: Sloppy's results</title>
	<meta
		name="description"
		content="Every question of the final test, each approach's score and answer, and why one scored higher."
	/>
</svelte:head>

<div class="min-h-dvh bg-background text-foreground">
	<SiteHeader isSample={data.isSample} />
	<main>
		<PageHead
			trail={[{ label: 'Results', href: resolve('/results') }, { label: 'Questions' }]}
			title="The questions behind the scores."
		>
			<p>
				Every question of the final test, {data.rows.length} across {projects.length} projects. Each approach
				answered each one three times; the score is the mean. Sloppy's largest gains over the docs alone
				come first, its losses last.
			</p>
		</PageHead>

		<section class="mx-auto max-w-6xl px-4 pt-10 pb-24 sm:px-8" aria-label="Questions">
			<nav class="flex flex-wrap gap-x-4 gap-y-2 text-sm" aria-label="By project">
				<span class="text-muted-foreground">By project:</span>
				{#each projects as p (p.slug)}
					<a
						href={resolve('/projects/[slug]/questions', { slug: p.slug })}
						class="underline underline-offset-2 hover:text-muted-foreground">{p.label}</a
					>
				{/each}
			</nav>
			<p class="mt-4 mb-6 max-w-[62ch] text-sm text-muted-foreground">
				Open a question for each approach's answer: the one of its three runs that scored closest to
				its mean, with how it was graded.
			</p>
			<QuestionList rows={data.rows} {labels} />
		</section>
	</main>
	<SiteFooter generatedAt={data.generatedAt} />
</div>
