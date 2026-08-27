<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- the route tree belongs
	   to the shells, so this package has no manifest for `resolve()` to check
	   against. */

	// The chrome and the gate every page sits inside. Both shells mount it from
	// their root layout, which is all a shell knows about any of this.
	import { AppShell } from '@sloppy/ui';
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import { goto, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '../api.js';
	import { keyboard } from '../keyboard.svelte.js';
	import { prefs } from '../stores/prefs.svelte.js';
	import { session } from '../stores/session.svelte.js';
	import { activeRouteId, APP_ROUTES, OPEN_ROUTES, refFromPath } from './routes.js';

	let { children }: { children: Snippet } = $props();

	/** Signing in leaves the app entirely, so the note somebody came for has to
	 *  outlive this document. */
	const CITED = 'sloppy.cited';

	// Annotated because SvelteKit types `pathname` against THIS package's route
	// tree, and the real one is the shells'.
	const path: string = $derived(page.url.pathname);
	const activeId = $derived(activeRouteId(path));
	/** A page mounted a tick before the redirect below would spend a request on a
	 *  credential we already know is missing. */
	const admitted = $derived(session.ready && (session.signedIn || OPEN_ROUTES.includes(path)));

	/**
	 * A shell that caught the consent callback itself is handed a code to spend
	 * rather than a session — `AuthController` decides which, from where the
	 * person asked to land.
	 */
	async function finishSignIn(code: string, state: string): Promise<void> {
		try {
			const opened = await api.exchangeSession({ code, state });
			session.adopt(opened.viewer, opened.token);
		} catch {
			await session.load();
		}
	}

	function holdCited(note: string): void {
		try {
			sessionStorage.setItem(CITED, note);
		} catch {
			// Storage turned off costs the citation, not the sign-in.
		}
	}

	function claimCited(): string | null {
		try {
			const note = sessionStorage.getItem(CITED);
			sessionStorage.removeItem(CITED);
			return note;
		} catch {
			return null;
		}
	}

	function stripHandOff(): void {
		const url = new URL(page.url);
		for (const key of ['sloppy_code', 'sloppy_state']) url.searchParams.delete(key);
		replaceState(url, page.state);
	}

	onMount(async () => {
		prefs.init();
		const code = page.url.searchParams.get('sloppy_code');
		const state = page.url.searchParams.get('sloppy_state');
		if (code && state) {
			await finishSignIn(code, state);
			stripHandOff();
		} else {
			await session.load();
		}
	});

	$effect(() => {
		if (!session.ready) return;
		if (!session.signedIn) {
			if (OPEN_ROUTES.includes(path)) return;
			if (refFromPath(path)) holdCited(path);
			const trouble = page.url.searchParams.get('sloppy_error');
			void goto(trouble ? `/sign-in?sloppy_error=${encodeURIComponent(trouble)}` : '/sign-in');
			return;
		}
		const cited = claimCited();
		if (cited && cited !== path) void goto(cited);
		else if (path === '/sign-in') void goto('/');
	});
</script>

<AppShell items={APP_ROUTES} {activeId} showNav={session.signedIn} keyboardOpen={keyboard.open}>
	{#if admitted}{@render children()}{/if}
</AppShell>
