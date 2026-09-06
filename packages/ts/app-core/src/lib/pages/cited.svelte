<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- the route tree belongs
	   to the shells, so this package has no manifest for `resolve()` to check
	   against. */

	// A note reached by the link somebody was handed. Signed in it is the graph,
	// which opens the note in the region it belongs to; signed out it is what its
	// author published, read and nothing else.
	import {
		addressDepth,
		compareOrd,
		splitOwnedRef,
		type BlockView,
		type NodeView,
		type OwnedRef,
		type PublishedNode,
		type PublishedSubtree
	} from '@sloppy/types';
	import { HeldNote, type NoteEmoji, type PictureSource, type ReferenceReader } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '../api.js';
	import { serverMessage } from '../stores/errors.js';
	import { people } from '../stores/people.svelte.js';
	import { session } from '../stores/session.svelte.js';
	import Graph from './graph.svelte';
	import { refFromPath } from './routes.js';

	const asked = $derived(refFromPath(page.url.pathname));
	const author = $derived(asked ? splitOwnedRef(asked).did : '');

	/** The author's branch as they published it, and which of its notes is open.
	 *  A reference inside one names another of the same branch, so the whole of
	 *  it stays in hand rather than being asked for again. */
	let branch = $state<PublishedSubtree | null>(null);
	let showing = $state<OwnedRef | null>(null);
	let reading = $state(false);
	let says = $state<string | null>(null);
	/** The panel put away, leaving the page it stands on. */
	let dismissed = $state(false);
	/** Which note has been asked for, so an answer that lands does not ask again. */
	let asking: OwnedRef | null = null;

	const NOTHING_THERE =
		'There is nothing to read at this address. Whoever wrote it may have taken it down, or may keep their graph somewhere else.';

	/**
	 * The published answer as a reading surface takes it. What a peer receives
	 * carries none of its author's timestamps for a section, so those say when
	 * this reading happened — the same thing they say on a copy somebody holds.
	 */
	function noteOf(published: PublishedNode, of: PublishedSubtree): NodeView {
		return {
			ref: published.ref,
			created_by: splitOwnedRef(published.ref).did,
			...(of.graph === undefined ? {} : { graph: of.graph }),
			address: published.address,
			depth: addressDepth(published.address),
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

	function sectionsOf(of: PublishedSubtree, note: OwnedRef): BlockView[] {
		const at = new Date().toISOString();
		return of.blocks
			.filter((section) => section.node === note)
			.map((section) => ({
				ref: section.ref,
				created_by: splitOwnedRef(section.ref).did,
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

	async function read(of: OwnedRef): Promise<void> {
		reading = true;
		says = null;
		try {
			const published = await api.readPublishedSubtree(of);
			if (!published || !published.nodes.some((one) => one.ref === of)) {
				says = NOTHING_THERE;
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

	$effect(() => {
		if (author) people.resolve(author);
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
			dismissed = false;
		}
	};

	/** Nobody's catalog is readable without an account, so a shortcode stands for
	 *  itself. */
	const emoji: NoteEmoji['catalog'] = async () => [];
</script>

{#if session.ready && session.signedIn}
	<Graph />
{:else if session.ready}
	<div class="mx-auto max-w-sm space-y-5 px-5 py-16 text-center">
		{#if reading}
			<p class="text-muted-foreground">Opening that note…</p>
		{:else if says}
			<p class="text-muted-foreground" role="alert">{says}</p>
			<p class="text-sm text-muted-foreground">Sign in to look for it among the graphs you hold.</p>
		{:else}
			<p class="text-muted-foreground">
				Somebody published this note. Sign in to keep it, or to answer it.
			</p>
		{/if}

		<div class="flex flex-col items-center gap-3">
			{#if dismissed && open}
				<Button variant="outline" class="h-11 w-full" onclick={() => (dismissed = false)}>
					Read it again
				</Button>
			{/if}
			<Button class="h-11 w-full" onclick={() => void goto('/sign-in')}>Sign in</Button>
		</div>
	</div>

	{#if !dismissed}
		<!-- Nobody's profile resolves without an account, and an identity is not a
		     name to put in front of a reader — AI.md § "User-Facing Copy". -->
		<HeldNote
			note={open}
			author={{ identity: 'Somebody else', person: people.of(author) }}
			blocks={sections}
			{pictures}
			{references}
			{emoji}
			onClose={() => (dismissed = true)}
		/>
	{/if}
{/if}
