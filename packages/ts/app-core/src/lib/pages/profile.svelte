<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- the route tree belongs
	   to the shells, so this package has no manifest for `resolve()` to check
	   against. */

	// How somebody appears to anyone who pulls a note of theirs, and the one
	// place they change it.
	import Pencil from '@lucide/svelte/icons/pencil';
	import { uploadFile } from '@sloppy/client';
	import type { IdentityHere } from '@sloppy/local';
	import { type CommentAccess, graphRef, splitOwnedRef } from '@sloppy/types';
	import { IdentityLine, PersonEditor, PersonHeader, type PictureRole } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { Skeleton } from '@sloppy/ui/skeleton';
	import { onMount } from 'svelte';
	import { api } from '../api.js';
	import { givenName, kept } from '../held-identity.js';
	import { runtime } from '../runtime.js';
	import { serverMessage } from '../stores/errors.js';
	import { graphs } from '../stores/graphs.svelte.js';
	import { nodes } from '../stores/nodes.svelte.js';
	import { people, personFrom } from '../stores/people.svelte.js';
	import { publications } from '../stores/publications.svelte.js';
	import { session } from '../stores/session.svelte.js';
	import { nodeHref } from './routes.js';

	/** An invitation the author sets, in the words the publishing sheet sets it
	 *  with: it decides what Sloppy offers a reader, and never what they can do. */
	const ANSWERS: Record<CommentAccess, string> = {
		anyone: 'Anyone reading it can answer',
		nobody: 'You are not taking answers'
	};

	let editing = $state(false);
	let saving = $state(false);
	let replacing = $state<PictureRole | null>(null);
	/** Their profile is not here; it replaces the surface. */
	let unreachable = $state<string | null>(null);
	/** A change was refused while the page is fine; the editor puts it beside the
	 *  control that asked for it. */
	let refused = $state<{ picture: PictureRole | null; message: string } | null>(null);

	const shown = $derived.by(() => {
		const profile = people.me;
		return profile && { profile, person: personFrom(profile) };
	});

	const identities = runtime.identities();
	let held = $state<IdentityHere[]>([]);
	/** The one the writing here carries, as this device holds it. Undefined is a
	 *  device that holds none of its own, which is every deployment but local. */
	const writingAs = $derived(held.find((one) => one.did === session.viewer?.did));

	$effect(() => {
		if (!identities) return;
		const asOf = session.viewer?.did;
		void identities.list().then(
			(listed) => {
				if (asOf === session.viewer?.did) held = listed;
			},
			() => {
				// The identity is on screen either way; only what it is called and
				// where it lives are missing.
			}
		);
	});

	/** The branches a peer can read, each named the way the reader would find it
	 *  again: an address, the notebook it is read in where they keep more than
	 *  one, and the terms they set on answers. */
	const published = $derived(
		publications.all.map((branch) => {
			const root = nodes.get(branch.root);
			const notebook = graphs.all.find(
				(graph) => graph.ref === graphRef(splitOwnedRef(branch.ref).owner, branch.graph)
			);
			return {
				ref: branch.ref,
				root: branch.root,
				address: branch.root_address,
				title: root === undefined ? null : root.title.trim() || 'Untitled',
				notebook: graphs.all.length > 1 ? (notebook?.title ?? null) : null,
				answers: ANSWERS[branch.comments]
			};
		})
	);

	async function readProfile(): Promise<void> {
		unreachable = null;
		try {
			await people.read();
		} catch (error) {
			unreachable =
				serverMessage(error) ?? 'Sloppy could not read your profile. Try again in a moment.';
		}
	}

	/** Only what is published, and only the note each branch is rooted at: the
	 *  page says what a peer can read, so it costs what that list costs. */
	async function readPublished(): Promise<void> {
		try {
			const [branches] = await Promise.all([publications.load(), graphs.load()]);
			await Promise.all(branches.map((branch) => nodes.fetch(branch.root)));
		} catch {
			// The graph page is where a graph that cannot be reached is news; here
			// the branches simply do not appear.
		}
	}

	async function save(edits: { displayName: string; bio: string }): Promise<void> {
		saving = true;
		refused = null;
		try {
			people.hold(
				await api.updateProfile({
					display_name: edits.displayName.trim() || null,
					bio: edits.bio.trim() || null
				})
			);
			editing = false;
		} catch (error) {
			refused = {
				picture: null,
				message: serverMessage(error) ?? 'That could not be saved. Try again.'
			};
		} finally {
			saving = false;
		}
	}

	/** Stored the moment it is chosen, so a picture cannot be lost to a form
	 *  somebody navigated away from. */
	async function replace(role: PictureRole, file: File): Promise<void> {
		if (!file.type.startsWith('image/')) {
			refused = { picture: role, message: 'Choose an image file.' };
			return;
		}
		replacing = role;
		refused = null;
		try {
			const asset = await uploadFile(api, file, { role }).asset;
			people.hold(
				await api.updateProfile(
					role === 'avatar'
						? { avatar_upload_id: asset.upload_id }
						: { banner_upload_id: asset.upload_id }
				)
			);
		} catch (error) {
			refused = {
				picture: role,
				message: serverMessage(error) ?? 'That picture could not be added. Try again.'
			};
		} finally {
			replacing = null;
		}
	}

	onMount(() => {
		if (session.onDevice) return;
		void readProfile();
		void readPublished();
	});
</script>

<svelte:head><title>You · Sloppy</title></svelte:head>

<div class="clear-sysnav">
	<div
		class="mx-auto w-full max-w-2xl space-y-6 px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-12 sm:px-8"
	>
		{#if session.onDevice}
			<h1 class="text-2xl font-semibold tracking-tight">You</h1>
			<section class="space-y-2 border-t border-border pt-6">
				<h2 class="text-sm font-medium">Your identity</h2>
				{#if session.viewer}
					{#if writingAs}
						{@const given = givenName(writingAs)}
						{#if given}
							<p class="text-base font-medium">{given}</p>
						{/if}
						<p class="text-sm text-muted-foreground">{kept(writingAs)}</p>
					{/if}
					<IdentityLine identity={session.viewer.did} label="Copy your identity" />
					<p class="text-sm text-muted-foreground">
						Everything you write here is written under this, and none of it leaves this device.
					</p>
				{:else}
					<p class="text-sm text-muted-foreground">Your graph is opening.</p>
				{/if}
			</section>
		{:else if unreachable}
			<p class="text-sm text-destructive" role="alert">{unreachable}</p>
		{:else if !shown}
			<div class="space-y-3">
				<Skeleton class="h-28 w-full rounded-lg sm:h-40" />
				<Skeleton class="-mt-12 size-20 rounded-full sm:-mt-14" />
				<Skeleton class="h-7 w-48" />
				<Skeleton class="h-4 w-32" />
			</div>
		{:else if editing}
			<h1 class="text-2xl font-semibold tracking-tight">You</h1>
			<PersonEditor
				person={shown.person}
				{replacing}
				{saving}
				{refused}
				onPicture={replace}
				onSave={save}
				onCancel={() => {
					refused = null;
					editing = false;
				}}
			/>
		{:else}
			<PersonHeader person={shown.person}>
				{#snippet actions()}
					<Button variant="outline" class="h-11 sm:h-9" onclick={() => (editing = true)}>
						<Pencil class="size-4" aria-hidden="true" />
						Edit
					</Button>
				{/snippet}
			</PersonHeader>

			<section class="space-y-2 border-t border-border pt-6">
				<h2 class="text-sm font-medium">What you publish</h2>
				{#if published.length === 0}
					<p class="text-sm text-muted-foreground">
						Nothing yet. A branch you publish can be read by anyone who has its address.
					</p>
				{:else}
					<ul class="space-y-1">
						{#each published as branch (branch.ref)}
							<li>
								<a
									href={nodeHref(branch.root)}
									class="flex min-h-11 items-center gap-3 rounded-md px-1 transition-colors duration-150 ease-out hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
								>
									<span class="shrink-0 address">{branch.address}</span>
									<span class="min-w-0 flex-1">
										<span class="block truncate text-sm">{branch.title ?? ''}</span>
										{#if branch.notebook}
											<span class="block truncate text-xs text-muted-foreground"
												>{branch.notebook}</span
											>
										{/if}
									</span>
									<span class="shrink-0 text-xs text-muted-foreground">{branch.answers}</span>
								</a>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<section class="space-y-2 border-t border-border pt-6">
				<h2 class="text-sm font-medium">Your identity</h2>
				<IdentityLine identity={shown.profile.did} label="Copy your identity" />
				<p class="text-sm text-muted-foreground">
					Hand this to somebody who wants to read what you publish.
				</p>
			</section>
		{/if}
	</div>
</div>
