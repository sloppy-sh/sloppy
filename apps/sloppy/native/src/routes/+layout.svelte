<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { forwardDeepLinks } from '$lib/deep-link';
	import { trackKeyboardInset } from '$lib/keyboard';
	import { IS_MOBILE, TAURI_PLATFORM } from '$lib/platform';
	import { initNativeRuntime } from '$lib/runtime';
	import Frame from '@sloppy/app-core/pages/frame';
	import { overlay } from '@sloppy/ui';

	let { children } = $props();

	// The AppRuntime contract: before any page mounts.
	initNativeRuntime();

	/** Android's back gesture, offered to the app before the system takes it:
	 *  the sheet on top, then the way back to the graph, then out. MainActivity.kt
	 *  leaves only where this refuses. */
	function answerBack(event: Event): void {
		if (overlay.closeTop()) event.preventDefault();
		else if (page.url.pathname !== '/') {
			event.preventDefault();
			history.back();
		}
	}

	onMount(() => {
		void forwardDeepLinks();
		// Publishes the real system-bar insets — DESIGN.md § "The four inset vars".
		if (IS_MOBILE) void import('@saurl/tauri-plugin-safe-area-insets-css-api');
		if (TAURI_PLATFORM === 'android') window.addEventListener('sloppy:back', answerBack);
		// Mobile only: a desktop pinch-zoom shrinks the visual viewport the same
		// way a keyboard does, and would be read as one.
		const stopKeyboard = IS_MOBILE ? trackKeyboardInset() : undefined;
		return () => {
			window.removeEventListener('sloppy:back', answerBack);
			stopKeyboard?.();
		};
	});
</script>

<Frame>{@render children()}</Frame>
