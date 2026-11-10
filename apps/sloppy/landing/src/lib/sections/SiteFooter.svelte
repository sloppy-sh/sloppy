<script lang="ts">
	import { resolve } from '$app/paths';
	import { CONTACT, REPOSITORY } from '$lib/links';

	let { generatedAt }: { generatedAt: string } = $props();

	const exported = $derived(
		new Date(generatedAt).toLocaleDateString('en-GB', {
			day: 'numeric',
			month: 'long',
			year: 'numeric',
			timeZone: 'UTC'
		})
	);
</script>

<footer class="border-t py-10 text-sm text-muted-foreground">
	<div class="mx-auto max-w-6xl space-y-3 px-4 sm:px-8">
		<p class="flex flex-wrap gap-x-5 gap-y-1">
			<!-- eslint-disable svelte/no-navigation-without-resolve -- links off this site -->
			<a href={REPOSITORY} class="hover:text-foreground">GitHub</a>
			<a href={CONTACT} class="hover:text-foreground">Talk to us</a>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
			<a href={resolve('/')} class="hover:text-foreground">Home</a>
			<a href={resolve('/how')} class="hover:text-foreground">How it works</a>
			<a href={resolve('/results')} class="hover:text-foreground">Results</a>
			<a href={resolve('/practices')} class="hover:text-foreground">Practices</a>
			<a href={resolve('/methodology')} class="hover:text-foreground">Methodology</a>
			<a href={resolve('/runs')} class="hover:text-foreground">Every run</a>
		</p>
		<p>Benchmark figures exported {exported}.</p>
	</div>
</footer>
