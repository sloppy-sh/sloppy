<script lang="ts">
	import PageHead from '$lib/sections/PageHead.svelte';
	import { resolve } from '$app/paths';
	import Runs from '$lib/sections/Runs.svelte';
	import SiteFooter from '$lib/sections/SiteFooter.svelte';
	import SiteHeader from '$lib/sections/SiteHeader.svelte';

	let { data } = $props();
	const summary = $derived(data.summary);
</script>

<svelte:head>
	<title>Every benchmark run</title>
	<meta
		name="description"
		content="Every run behind Sloppy's benchmark: what each agent was sent, what it answered and how it was graded."
	/>
</svelte:head>

<div class="min-h-dvh bg-background text-foreground">
	<SiteHeader isSample={data.isSample} />
	<main>
		<PageHead
			trail={[{ label: 'Methodology', href: resolve('/methodology') }, { label: 'Runs' }]}
			title="Every run."
		>
			<p>
				Every number on this site comes from runs kept in the repository: what each agent was sent,
				what it answered and how it was graded.
			</p>
		</PageHead>
		<Runs {summary} />
	</main>
	<SiteFooter generatedAt={summary.generated_at} />
</div>
