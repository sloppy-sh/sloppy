<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- the route tree belongs
	   to the shells, so this package has no manifest for `resolve()` to check
	   against. */

	// The chrome and the gate every page sits inside. Both shells mount it from
	// their root layout, which is all a shell knows about any of this.
	import { AppShell } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import { goto, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '../api.js';
	import { keyboard } from '../keyboard.svelte.js';
	import { conversation } from '../stores/conversation.svelte.js';
	import { deleted } from '../stores/deleted.svelte.js';
	import { find } from '../stores/find.svelte.js';
	import { graphs } from '../stores/graphs.svelte.js';
	import { identity } from '../stores/identity.svelte.js';
	import { nodes } from '../stores/nodes.svelte.js';
	import { offers } from '../stores/offers.svelte.js';
	import { outlineSections } from '../stores/outline-sections.svelte.js';
	import { peers } from '../stores/peers.svelte.js';
	import { people, personFrom } from '../stores/people.svelte.js';
	import { prefs } from '../stores/prefs.svelte.js';
	import { publications } from '../stores/publications.svelte.js';
	import { session } from '../stores/session.svelte.js';
	import { tags } from '../stores/tags.svelte.js';
	import {
		activeRouteId,
		isOpenRoute,
		navRoutes,
		navShows,
		OPEN_ROUTES,
		refFromPath
	} from './routes.js';

	let { children }: { children: Snippet } = $props();

	/** Signing in leaves the app entirely, so the note somebody came for has to
	 *  outlive this document. */
	const RETURN_TO = 'sloppy.return';

	// Annotated because SvelteKit types `pathname` against THIS package's route
	// tree, and the real one is the shells'.
	const path: string = $derived(page.url.pathname);
	const activeId = $derived(activeRouteId(path));
	/** A page mounted a tick before the redirect below would spend a request on a
	 *  credential we already know is missing. */
	const admitted = $derived(session.ready && (session.signedIn || isOpenRoute(path)));
	/** Sending somebody to sign in because Sloppy could not ask who they are puts
	 *  them on a page that cannot help them either — and on a device holding its
	 *  own graph there is no such page to send them to at all. */
	const held = $derived(session.ready && !admitted && (session.unavailable || session.onDevice));
	const me = $derived(people.me && personFrom(people.me));
	/** With nobody signed in and Sloppy out of reach, a page about the reader has
	 *  nobody to be about, so only what stands without an account is offered. */
	const destinations = $derived(
		session.unavailable && !session.signedIn
			? navRoutes(me).filter(({ href }) => href === '/' || OPEN_ROUTES.includes(href))
			: navRoutes(me)
	);

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

	function holdReturn(destination: string): void {
		try {
			sessionStorage.setItem(RETURN_TO, destination);
		} catch {
			// Storage turned off costs the return, not the sign-in.
		}
	}

	function claimReturn(): string | null {
		try {
			const destination = sessionStorage.getItem(RETURN_TO);
			sessionStorage.removeItem(RETURN_TO);
			return destination;
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

	// Signing in, and being sent to it. A graph on this device has nobody to sign
	// in to, so none of this is its business.
	$effect(() => {
		if (!session.ready || session.onDevice) return;
		if (!session.signedIn) {
			// A cited note is read where the reader stands, and signing in from it
			// brings them back to it rather than to the graph.
			if (refFromPath(path)) holdReturn(path + page.url.search);
			if (isOpenRoute(path)) return;
			if (session.unavailable) return;
			if (path !== '/') holdReturn(path + page.url.search);
			const trouble = page.url.searchParams.get('sloppy_error');
			void goto(trouble ? `/sign-in?sloppy_error=${encodeURIComponent(trouble)}` : '/sign-in');
			return;
		}
		const returnTo = claimReturn();
		if (returnTo && returnTo !== path) void goto(returnTo);
		else if (path === '/sign-in') void goto('/');
	});

	$effect(() => {
		if (session.signedIn && !people.me) void people.read().catch(() => {});
	});

	let wasSignedIn = false;

	// A session that ends takes the graph with it however it ended, so nothing of
	// the person who was reading is left for whoever signs in next — DESIGN.md
	// § Persistence. An outage is not an answer about who is signed in, so it
	// leaves the graph standing.
	$effect(() => {
		if (session.unavailable) return;
		const signedIn = session.signedIn;
		if (wasSignedIn && !signedIn) {
			conversation.clear();
			deleted.clear();
			find.clear();
			graphs.clear();
			identity.clear();
			nodes.clear();
			offers.clear();
			outlineSections.clear();
			peers.clear();
			people.hold(null);
			publications.clear();
			tags.clear();
		}
		wasSignedIn = signedIn;
	});
</script>

<AppShell items={destinations} {activeId} showNav={navShows()} keyboardOpen={keyboard.open}>
	{#if admitted}
		{@render children()}
	{:else if held}
		<div class="mx-auto max-w-sm space-y-5 px-5 py-16 text-center">
			<p class="text-muted-foreground" role="alert">
				Sloppy could not load just now. Try again, or come back to it in a moment.
			</p>
			<Button
				variant="outline"
				disabled={session.loading}
				class="h-11"
				onclick={() => void session.refresh()}
			>
				{session.loading ? 'Trying…' : 'Try again'}
			</Button>
		</div>
	{/if}
</AppShell>
