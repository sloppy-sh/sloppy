<script lang="ts">
	import { resolve } from '$app/paths';
	import QuestionList from '$lib/questions/QuestionList.svelte';
	import PageHead from '$lib/sections/PageHead.svelte';
	import SiteFooter from '$lib/sections/SiteFooter.svelte';
	import SiteHeader from '$lib/sections/SiteHeader.svelte';

	let { data } = $props();
	const subject = $derived(data.rows[0].project);
	const label = $derived(data.labels[subject]);
</script>

<svelte:head>
	<title>{label}'s questions: Sloppy's results</title>
	<meta
		name="description"
		content="The final test's questions on {label}, each approach's score and answer, and why one scored higher."
	/>
</svelte:head>

<div class="min-h-dvh bg-background text-foreground">
	<SiteHeader isSample={data.isSample} />
	<main>
		<PageHead
			trail={[
				{ label: 'Results', href: resolve('/results') },
				{ label, href: resolve('/projects/[slug]', { slug: data.slug }) },
				{ label: 'Questions' }
			]}
			title="The questions on {label}."
		>
			<p>
				The final test's {data.rows.length} questions on {label}. Each approach answered each one
				three times; the score is the mean. Sloppy's largest gains over the docs alone come first,
				its losses last.
			</p>
		</PageHead>

		<section class="mx-auto max-w-6xl px-4 pt-10 pb-24 sm:px-8" aria-label="Questions">
			<p class="mb-6 max-w-[62ch] text-sm text-muted-foreground">
				Open a question for each approach's answer: the one of its three runs that scored closest to
				its mean, with how it was graded.
				<a href={resolve('/questions')} class="underline underline-offset-2"
					>Every project's questions</a
				>.
			</p>
			<QuestionList rows={data.rows} labels={data.labels} />
		</section>
	</main>
	<SiteFooter generatedAt={data.generatedAt} />
</div>
