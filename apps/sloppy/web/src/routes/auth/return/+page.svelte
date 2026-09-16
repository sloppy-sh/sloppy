<script lang="ts">
	// Where an identity store puts somebody down on the way back to the app on
	// their device — docs/ARCHITECTURE.md § "A graph off the device". Nothing
	// here reads what it is carrying; it hands the whole of it on.
	import { page } from '$app/state';
	import { Button } from '@sloppy/ui/button';
	import { onMount } from 'svelte';

	const back = $derived(`sloppy://auth/callback${page.url.search}`);

	let waited = $state(false);

	onMount(() => {
		location.assign(back);
		const settle = setTimeout(() => (waited = true), 1200);
		return () => clearTimeout(settle);
	});
</script>

<svelte:head><title>Back to Sloppy</title></svelte:head>

<div
	class="min-h-dvh px-5 pt-[max(4rem,calc(env(safe-area-inset-top)+3rem))] pad-bottom-safe sm:px-8"
>
	<div class="mx-auto w-full max-w-md space-y-6">
		<h1 class="text-2xl font-semibold tracking-tight">Back to Sloppy</h1>
		<p class="text-muted-foreground">
			{#if waited}
				Sloppy didn't open by itself. Open it here, and you'll be writing as yourself.
			{:else}
				Taking you back to Sloppy…
			{/if}
		</p>
		<Button href={back} class="h-11 w-full">Open Sloppy</Button>
	</div>
</div>
