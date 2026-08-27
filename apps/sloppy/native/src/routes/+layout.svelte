<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { forwardDeepLinks } from '$lib/deep-link';
	import { trackKeyboardInset } from '$lib/keyboard';
	import { IS_MOBILE } from '$lib/platform';
	import { initNativeRuntime } from '$lib/runtime';
	import Frame from '@sloppy/app-core/pages/frame';

	let { children } = $props();

	// The AppRuntime contract: before any page mounts.
	initNativeRuntime();

	onMount(() => {
		void forwardDeepLinks();
		// Publishes the real system-bar insets — DESIGN.md § "The four inset vars".
		if (IS_MOBILE) void import('@saurl/tauri-plugin-safe-area-insets-css-api');
		// Mobile only: a desktop pinch-zoom shrinks the visual viewport the same
		// way a keyboard does, and would be read as one.
		return IS_MOBILE ? trackKeyboardInset() : undefined;
	});
</script>

<Frame>{@render children()}</Frame>
