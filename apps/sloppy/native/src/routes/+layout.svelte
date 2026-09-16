<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { answerBack } from '$lib/back';
	import { forwardDeepLinks } from '$lib/deep-link';
	import { trackKeyboardInset } from '$lib/keyboard';
	import { LOCAL_MODE } from '$lib/local-mode';
	import { IS_MOBILE, TAURI_PLATFORM } from '$lib/platform';
	import { initNativeRuntime, openRememberedVault, vaultIsMissing } from '$lib/runtime';
	import { session } from '@sloppy/app-core';
	import FirstRun from '@sloppy/app-core/pages/first-run';
	import Frame from '@sloppy/app-core/pages/frame';

	let { children } = $props();

	// The AppRuntime contract: before any page mounts.
	initNativeRuntime();

	/** Undefined until the boot read answers, so nobody is offered a folder they
	 *  already have. A build that talks to a server has one from the start. */
	let opened = $state<boolean | undefined>(LOCAL_MODE ? undefined : true);
	let missing = $state(false);

	/** Consent at somebody's identity store comes back through the web app and
	 *  re-enters this document, so the folder is opened first and what the store
	 *  says a person is called lands in the graph that is there. */
	async function pickUpSignIn(): Promise<void> {
		const came = new URLSearchParams(location.search);
		if (!came.has('state')) return;
		await session.finishSignInHere(came);
		history.replaceState(history.state, '', location.pathname);
	}

	onMount(() => {
		if (LOCAL_MODE)
			void openRememberedVault().then(
				async (folder) => {
					opened = Boolean(folder);
					missing = vaultIsMissing();
					await pickUpSignIn();
				},
				() => (opened = false)
			);
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

{#if opened === undefined}
	<div class="min-h-dvh"></div>
{:else if opened}
	<Frame>{@render children()}</Frame>
{:else}
	<FirstRun {missing} onopened={() => (opened = true)} />
{/if}
