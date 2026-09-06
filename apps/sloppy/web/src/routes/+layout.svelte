<script lang="ts">
	import '../app.css';
	import { initRuntime, session, trackKeyboard } from '@sloppy/app-core';
	import Frame from '@sloppy/app-core/pages/frame';
	import { onMount } from 'svelte';

	let { children } = $props();

	// The platform seam, before any page mounts. Every member left out is a
	// choice; `runtime.ts` in @sloppy/app-core states what each absence decides.
	initRuntime({
		apiHost: () => import.meta.env.PUBLIC_SLOPPY_API_URL ?? '',
		onAuthInvalid: () => session.clear()
	});

	// Only the native shell can publish `--safe-area-inset-bottom`; in a browser
	// surfaces fall back to `env()`.
	onMount(() => trackKeyboard());
</script>

<Frame>{@render children()}</Frame>
