<script lang="ts">
	import '../app.css';
	import { initRuntime, session, trackKeyboard } from '@sloppy/app-core';
	import { graphHere } from '@sloppy/app-core/graph-here';
	import OpenHere from '@sloppy/app-core/components/open-here';
	import Frame from '@sloppy/app-core/pages/frame';
	import { onMount } from 'svelte';

	let { children } = $props();

	// The platform seam, before any page mounts. Every member left out is a
	// choice; `runtime.ts` in @sloppy/app-core states what each absence decides.
	initRuntime({
		apiHost: () => import.meta.env.PUBLIC_SLOPPY_API_URL ?? '',
		onAuthInvalid: () => session.clear()
	});

	// A tab can open a graph kept on this device beside the one it is served —
	// docs/ARCHITECTURE.md § "A graph on this device, beside the one a Sloppy serves".
	graphHere.offerHere();

	onMount(() => {
		// Only the native shell can publish `--safe-area-inset-bottom`; in a
		// browser surfaces fall back to `env()`.
		const stopKeyboard = trackKeyboard();
		// Nobody is asked for a folder on a launch: one this browser is still
		// allowed to read opens, and anything else waits to be asked for.
		void graphHere.boot();
		return stopKeyboard;
	});
</script>

{#if !graphHere.ready}
	<div class="min-h-dvh"></div>
{:else if graphHere.waiting}
	<main class="min-h-dvh px-5 pt-[max(4rem,calc(env(safe-area-inset-top)+3rem))] sm:px-8">
		<div class="mx-auto w-full max-w-md space-y-4">
			<OpenHere />
		</div>
	</main>
{:else}
	<Frame>{@render children()}</Frame>
{/if}
