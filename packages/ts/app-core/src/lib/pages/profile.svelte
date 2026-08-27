<script lang="ts">
	// How somebody appears to anyone who pulls a note of theirs, and the one
	// place they change it.
	import Pencil from '@lucide/svelte/icons/pencil';
	import { uploadFile } from '@sloppy/client';
	import type { NodeView } from '@sloppy/types';
	import { PersonEditor, PersonHeader, type PictureRole } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { Skeleton } from '@sloppy/ui/skeleton';
	import { onMount } from 'svelte';
	import { api } from '../api.js';
	import { serverMessage } from '../stores/errors.js';
	import { nodes } from '../stores/nodes.svelte.js';
	import { people, personFrom } from '../stores/people.svelte.js';

	let editing = $state(false);
	let saving = $state(false);
	let replacing = $state<PictureRole | null>(null);
	/** Their profile is not here; it replaces the surface. */
	let unreachable = $state<string | null>(null);
	/** A change was refused while the page is fine; the editor puts it beside the
	 *  control that asked for it. */
	let refused = $state<{ picture: PictureRole | null; message: string } | null>(null);
	/** False until every branch is in, because a branch still missing would put a
	 *  smaller graph on the page than the person has. */
	let measured = $state(false);

	const shown = $derived.by(() => {
		const profile = people.me;
		return profile && { profile, person: personFrom(profile) };
	});

	const branches = $derived(nodes.region());
	const written = $derived.by(() => {
		let total = 0;
		const walk = (list: NodeView[]) => {
			for (const node of list) {
				total += 1;
				walk(nodes.children(node.ref));
			}
		};
		walk(branches);
		return total;
	});

	function count(n: number, one: string, many: string): string {
		return `${n.toLocaleString()} ${n === 1 ? one : many}`;
	}

	async function readProfile(): Promise<void> {
		unreachable = null;
		try {
			await people.read();
		} catch (error) {
			unreachable =
				serverMessage(error) ?? 'Sloppy could not read your profile. Try again in a moment.';
		}
	}

	async function measureGraph(): Promise<void> {
		try {
			const mine = await nodes.load();
			await Promise.all(mine.map((root) => nodes.load({ origin: root.ref })));
			measured = true;
		} catch {
			// A graph that cannot be reached is the graph page's news to break; here
			// the line about its shape simply does not appear.
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
		void readProfile();
		void measureGraph();
	});
</script>

<svelte:head><title>You · Sloppy</title></svelte:head>

<div class="clear-sysnav">
	<div
		class="mx-auto w-full max-w-2xl space-y-6 px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-12 sm:px-8"
	>
		{#if unreachable}
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

			{#if measured && written > 0}
				<p class="text-sm text-muted-foreground">
					{count(written, 'note', 'notes')} across {count(branches.length, 'branch', 'branches')}.
				</p>
			{/if}

			<section class="space-y-2 border-t border-border pt-6">
				<h2 class="text-sm font-medium">Your identity</h2>
				<p class="address text-sm break-all select-text">{shown.profile.did}</p>
			</section>
		{/if}
	</div>
</div>
