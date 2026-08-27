<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- the route tree belongs
	   to the shells, so this package has no manifest for `resolve()` to check
	   against. */

	// The chrome and the gate every page sits inside. Both shells mount it from
	// their root layout, which is all a shell knows about any of this.
	import Network from '@lucide/svelte/icons/network';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
	import { AppShell, type NavItem } from '@sloppy/ui';
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import { goto, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '../api.js';
	import { keyboard } from '../keyboard.svelte.js';
	import { prefs } from '../stores/prefs.svelte.js';
	import { session } from '../stores/session.svelte.js';

	let { children }: { children: Snippet } = $props();

	/** Reachable with no account — DESIGN.md § Persistence, on appearance. */
	const OPEN_ROUTES = ['/sign-in', '/settings'];

	const NAV: NavItem[] = [
		{ id: 'graph', label: 'Graph', href: '/', icon: Network },
		{ id: 'settings', label: 'Settings', href: '/settings', icon: SlidersHorizontal }
	];

	// Annotated because SvelteKit types `pathname` against THIS package's route
	// tree, and the real one is the shells'.
	const path: string = $derived(page.url.pathname);
	const activeId = $derived(path === '/settings' ? 'settings' : 'graph');

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
		if (!session.signedIn && !OPEN_ROUTES.includes(path)) {
			const trouble = page.url.searchParams.get('sloppy_error');
			void goto(trouble ? `/sign-in?sloppy_error=${encodeURIComponent(trouble)}` : '/sign-in');
		} else if (session.signedIn && path === '/sign-in') {
			void goto('/');
		}
	});
</script>

<AppShell items={NAV} {activeId} showNav={session.signedIn} keyboardOpen={keyboard.open}>
	{#if session.ready}{@render children()}{/if}
</AppShell>
