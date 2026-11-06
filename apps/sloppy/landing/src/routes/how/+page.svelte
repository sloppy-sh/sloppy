<script lang="ts">
	import { resolve } from '$app/paths';
	import { buttonVariants } from '@sloppy/ui/button';
	import { outcomeLine } from '$lib/front';
	import Pipeline from '$lib/how/Pipeline.svelte';
	import PageHead from '$lib/sections/PageHead.svelte';
	import SiteFooter from '$lib/sections/SiteFooter.svelte';
	import SiteHeader from '$lib/sections/SiteHeader.svelte';

	let { data } = $props();
	const summary = $derived(data.summary);
</script>

<svelte:head>
	<title>How Sloppy works</title>
	<meta
		name="description"
		content="Sloppy from the notes up: a place people and agents write down why, kept beside the code, shaped by the CLI and served to your agent."
	/>
</svelte:head>

<div class="min-h-dvh bg-background text-foreground">
	<SiteHeader isSample={data.isSample} />
	<main>
		<PageHead trail={[{ label: 'How it works' }]} title="How it works." />
		<section class="mx-auto max-w-6xl px-4 py-12 sm:px-8" aria-label="The pipeline">
			<Pipeline outcome={outcomeLine(summary)} />
			<div class="mt-12 flex flex-wrap gap-3">
				<a href="{resolve('/')}#start" class={buttonVariants({ size: 'lg' })}>Try it on your repo</a
				>
				<a href={resolve('/results')} class={buttonVariants({ variant: 'outline', size: 'lg' })}
					>See the results</a
				>
			</div>
		</section>
	</main>
	<SiteFooter generatedAt={summary.generated_at} />
</div>
