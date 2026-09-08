<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- the route tree belongs
	   to the shells, so this package has no manifest for `resolve()` to check
	   against. */

	// Somewhere to put a thought down that arrived from outside Sloppy, before
	// its place has been chosen. The note exists by the time this page is gone,
	// and the ordinary note surface takes it from there.
	import { OwnedRefSchema, type OwnedRef } from '@sloppy/types';
	import { textDocument } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '../api.js';
	import { serverMessage } from '../stores/errors.js';
	import { graphs } from '../stores/graphs.svelte.js';
	import { nodes } from '../stores/nodes.svelte.js';
	import { prefs } from '../stores/prefs.svelte.js';
	import { nodeHref } from './routes.js';

	let refused = $state<string | null>(null);
	/** So a second attempt continues the note the first one already wrote. */
	let written: OwnedRef | null = null;

	/** Which graph a note is in is fixed at creation, so a saved choice is
	 *  confirmed against the listing before anything is written — a listing that
	 *  will not load refuses rather than filing the thought somewhere else. */
	async function graphFor(): Promise<OwnedRef> {
		const saved = prefs.current.graph;
		if (saved && saved !== graphs.home) await graphs.load();
		return graphs.current;
	}

	async function put(): Promise<void> {
		refused = null;
		const asked = page.url.searchParams;
		// An `under` that names no note must not cost somebody the thought, so it
		// writes a note of its own instead.
		const under = OwnedRefSchema.safeParse(asked.get('under'));
		const text = (asked.get('text') ?? '').trim();
		try {
			if (!written) {
				const note = await nodes.create({
					from: under.success
						? { relation: 'under', note: under.data }
						: { relation: 'free', graph: await graphFor() }
				});
				written = note.ref;
			}
			if (text) await api.createBlock({ node: written, content: textDocument(text) });
			await goto(nodeHref(written), { replaceState: true });
		} catch (error) {
			refused = serverMessage(error) ?? 'Sloppy could not put that down. Try again in a moment.';
		}
	}

	onMount(() => {
		void put();
	});
</script>

<svelte:head><title>Sloppy</title></svelte:head>

<div class="pad-bottom-safe flex min-h-dvh items-center justify-center px-5">
	<div class="w-full max-w-sm space-y-5 text-center">
		{#if refused}
			<p class="text-destructive" role="alert">{refused}</p>
			<Button variant="outline" class="h-11" onclick={() => void put()}>Try again</Button>
		{:else}
			<p class="text-muted-foreground" role="status">Putting that down…</p>
		{/if}
	</div>
</div>
