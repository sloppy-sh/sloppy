<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- the route tree belongs
	   to the shells, so this package has no manifest for `resolve()` to check
	   against. */

	// A note reached by the link somebody was handed. Signed in it is the graph,
	// which opens the note in the region it belongs to; signed out it is what its
	// author published, read and nothing else.
	import {
		compareOrd,
		splitOwnedRef,
		type BlockView,
		type NodeView,
		type OwnedRef,
		type PublishedNode,
		type PublishedSubtree
	} from '@sloppy/types';
	import { HeldStack, type NoteEmoji, type PictureSource, type ReferenceReader } from '@sloppy/ui';
	import { Badge } from '@sloppy/ui/badge';
	import { Button } from '@sloppy/ui/button';
	import { Skeleton } from '@sloppy/ui/skeleton';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '../api.js';
	import { serverMessage } from '../stores/errors.js';
	import { session } from '../stores/session.svelte.js';
	import Graph from './graph.svelte';
	import { refFromPath } from './routes.js';

	const asked = $derived(refFromPath(page.url.pathname));

	/** The author's branch as they published it, and which of its notes is open.
	 *  A reference inside one names another of the same branch, so the whole of
	 *  it stays in hand rather than being asked for again. */
	let branch = $state<PublishedSubtree | null>(null);
	let showing = $state<OwnedRef | null>(null);
	let reading = $state(false);
	let says = $state<string | null>(null);
	let asking: OwnedRef | null = null;

	const NOT_OPEN =
		'Sloppy cannot open that note for you without an account. Sign in and look for it.';

	/** How deep in the published region a note sits: the root is 1, and each step
	 *  down the parents the region carries is one more. Read off the genealogy
	 *  rather than the address, which is a label its author writes. */
	function depthOf(published: PublishedNode, of: PublishedSubtree): number {
		const byRef = new Map(of.nodes.map((one) => [one.ref, one]));
		let depth = 1;
		let up = published.parent;
		// Bounded by the region rather than trusted to end: a page that named a
		// cycle would otherwise walk forever.
		for (let step = 0; up !== undefined && step < of.nodes.length; step += 1) {
			depth += 1;
			up = byRef.get(up)?.parent;
		}
		return depth;
	}

	/** The published answer as a reading surface takes it. */
	function noteOf(published: PublishedNode, of: PublishedSubtree): NodeView {
		return {
			ref: published.ref,
			created_by: splitOwnedRef(published.ref).owner,
			...(of.graph === undefined ? {} : { graph: of.graph }),
			...(published.address === undefined ? {} : { address: published.address }),
			depth: depthOf(published, of),
			...(published.parent === undefined ? {} : { parent: published.parent }),
			origin: published.origin,
			title: published.title,
			tags: published.tags,
			links: published.links,
			...(published.look === undefined ? {} : { appearance: published.look }),
			published: true,
			created_at: published.created_at,
			updated_at: published.updated_at
		};
	}

	/** What a peer receives carries none of its author's timestamps for a
	 *  section, so those say when this reading happened. */
	function sectionsOf(of: PublishedSubtree, note: OwnedRef): BlockView[] {
		const at = new Date().toISOString();
		return of.blocks
			.filter((section) => section.node === note)
			.map((section) => ({
				ref: section.ref,
				created_by: splitOwnedRef(section.ref).owner,
				node: section.node,
				ord: section.ord,
				content: section.content,
				created_at: at,
				updated_at: at
			}))
			.sort((a, b) => compareOrd(a.ord, b.ord));
	}

	const open = $derived.by(() => {
		if (!branch || !showing) return null;
		const published = branch.nodes.find((one) => one.ref === showing);
		return published ? noteOf(published, branch) : null;
	});
	const sections = $derived(branch && showing ? sectionsOf(branch, showing) : []);
	/** The address as it is cited: the notebook it is read in comes with it where
	 *  its author named one. */
	const citation = $derived(
		open ? [open.address, branch?.graph_title].filter(Boolean).join(' · ') : ''
	);

	async function read(of: OwnedRef): Promise<void> {
		reading = true;
		says = null;
		try {
			const published = await api.readPublishedSubtree(of);
			if (!published || !published.nodes.some((one) => one.ref === of)) {
				says = NOT_OPEN;
				return;
			}
			branch = published;
			showing = of;
		} catch (error) {
			says = serverMessage(error) ?? 'Sloppy could not open that note. Try again in a moment.';
		} finally {
			reading = false;
		}
	}

	$effect(() => {
		const of = asked;
		if (!session.ready || session.signedIn || !of || asking === of) return;
		asking = of;
		void read(of);
	});

	/** A picture inside a published note. The fetch is the API's, so the author's
	 *  instance never learns who is reading. */
	const pictures: PictureSource = { picture: (upload) => api.publishedPicture(upload) };

	/** A reference leads within the branch that was published, which is all there
	 *  is to read here. */
	const references: ReferenceReader = {
		read: async (note) => {
			const published = branch?.nodes.find((one) => one.ref === note);
			return published && branch ? noteOf(published, branch) : null;
		},
		open: (note) => {
			if (!branch?.nodes.some((one) => one.ref === note)) return;
			showing = note;
		}
	};

	/** Nobody's catalog is readable without an account, so a shortcode stands for
	 *  itself. */
	const emoji: NoteEmoji['catalog'] = async () => [];
</script>

{#if session.ready && session.signedIn}
	<Graph />
{:else if session.ready}
	<article class="mx-auto w-full max-w-2xl px-5 pt-8 pb-16 sm:px-6">
		{#if reading}
			<Skeleton class="h-4 w-24" />
			<Skeleton class="mt-4 h-8 w-2/3" />
			<Skeleton class="mt-6 h-24 w-full" />
		{:else if open}
			{#if citation}
				<p class="address text-sm text-muted-foreground select-text">{citation}</p>
			{/if}
			<h1 class="mt-2 text-2xl leading-snug font-semibold tracking-tight">
				{open.title || 'Untitled'}
			</h1>
			{#if open.tags.length > 0}
				<div class="mt-3 flex flex-wrap items-center gap-1.5">
					{#each open.tags as tag (tag)}
						<Badge variant="outline" class="text-muted-foreground">{tag}</Badge>
					{/each}
				</div>
			{/if}
			{#if sections.length === 0}
				<p class="py-8 text-muted-foreground">There is nothing written in this note.</p>
			{:else}
				{#key open.ref}
					<div class="mt-6">
						<HeldStack
							note={open}
							author={open.created_by}
							blocks={sections}
							{pictures}
							{references}
							{emoji}
						/>
					</div>
				{/key}
			{/if}
		{/if}

		{#if !reading}
			<div class="mt-10 space-y-4 border-t border-border pt-6">
				<p class="text-muted-foreground" role={says ? 'alert' : undefined}>
					{says ?? 'Somebody published this note. Sign in to keep it, or to answer it.'}
				</p>
				<Button class="h-11 w-full sm:w-auto sm:px-8" onclick={() => void goto('/sign-in')}>
					Sign in
				</Button>
			</div>
		{/if}
	</article>
{/if}
