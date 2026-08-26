<script lang="ts" module>
	import { initRuntime } from '@sloppy/app-core';
	import { session } from '$lib/session.svelte';

	// The platform seam, bound before anything mounts. `openExternal` and
	// `createApi` are left out deliberately; `runtime.ts` in @sloppy/app-core
	// states what each absence decides.
	initRuntime({
		apiHost: () => import.meta.env.PUBLIC_SLOPPY_API_URL ?? '',
		onAuthInvalid: () => session.forget()
	});
</script>

<script lang="ts">
	import '@fontsource-variable/inter';
	import '@fontsource-variable/jetbrains-mono';
	import '../app.css';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { prefs } from '$lib/prefs.svelte';

	let { children } = $props();

	/** Reachable with no account — DESIGN.md § Persistence, on appearance. */
	const OPEN_ROUTES = ['/sign-in', '/settings'];

	onMount(() => {
		prefs.init();
		void session.load();
	});

	$effect(() => {
		if (!session.loaded) return;
		const path = page.url.pathname;
		if (!session.viewer && !OPEN_ROUTES.includes(path)) void goto(resolve('/sign-in'));
		else if (session.viewer && path === '/sign-in') void goto(resolve('/'));
	});
</script>

<div class="min-h-dvh px-5 pt-10 pad-bottom-safe sm:px-8 sm:pt-16">
	<main class="mx-auto w-full max-w-xl">
		{#if session.loaded}
			{@render children()}
		{/if}
	</main>
</div>
