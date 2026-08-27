<script lang="ts" module>
	import { proxied } from '@sloppy/client';
	import type { ProfileView } from '@sloppy/types';
	import type { Person } from '@sloppy/ui';
	import { api } from '../api.js';

	// Who the signed-in person is, as their identity store reports them. Cached
	// and never kept as a copy of record — AI.md § "Sloppy's Vocabulary Stays
	// Out of the Identity Store".
	let held = $state<ProfileView | null>(null);
	let asking: Promise<ProfileView> | null = null;
	// A sign-out that lands while a read is in flight must not be undone by its
	// answer, which belongs to whoever just left.
	let epoch = 0;

	/** What is already known, for a surface that will not wait for a read. */
	export function knownPerson(): ProfileView | null {
		return held;
	}

	/** Deduped: every surface may call it on mount. */
	export function readPerson(): Promise<ProfileView> {
		if (held) return Promise.resolve(held);
		if (asking) return asking;
		const at = epoch;
		const request: Promise<ProfileView> = api
			.profile()
			.then((profile) => {
				if (at === epoch) held = profile;
				return profile;
			})
			.finally(() => {
				if (asking === request) asking = null;
			});
		asking = request;
		return request;
	}

	/** The store's answer after a change, or `null` when the person signs out. */
	export function holdPerson(profile: ProfileView | null): void {
		epoch += 1;
		asking = null;
		held = profile;
	}

	/** Their pictures resolved for an `<img>`; the rest is the store's own answer. */
	export function personFrom(profile: ProfileView): Person {
		return {
			displayName: profile.display_name,
			handle: profile.username,
			bio: profile.bio,
			avatar: profile.avatar_src && proxied(profile.avatar_src),
			banner: profile.banner_src && proxied(profile.banner_src)
		};
	}
</script>

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
	import { serverMessage } from '../stores/errors.js';
	import { nodes } from '../stores/nodes.svelte.js';

	let editing = $state(false);
	let saving = $state(false);
	let replacing = $state<PictureRole | null>(null);
	/** Their profile is not here; it replaces the surface. */
	let unreachable = $state<string | null>(null);
	/** A change was refused while the page is fine; it sits beside the form. */
	let refused = $state<string | null>(null);
	/** False until every branch is in, because a branch still missing would put a
	 *  smaller graph on the page than the person has. */
	let measured = $state(false);

	const shown = $derived.by(() => {
		const profile = knownPerson();
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
			await readPerson();
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
			holdPerson(
				await api.updateProfile({
					display_name: edits.displayName.trim() || null,
					bio: edits.bio.trim() || null
				})
			);
			editing = false;
		} catch (error) {
			refused = serverMessage(error) ?? 'That could not be saved. Try again.';
		} finally {
			saving = false;
		}
	}

	/** Stored the moment it is chosen, so a picture cannot be lost to a form
	 *  somebody navigated away from. */
	async function replace(role: PictureRole, file: File): Promise<void> {
		if (!file.type.startsWith('image/')) {
			refused = 'Choose an image file.';
			return;
		}
		replacing = role;
		refused = null;
		try {
			const asset = await uploadFile(api, file, { role }).asset;
			holdPerson(
				await api.updateProfile(
					role === 'avatar'
						? { avatar_upload_id: asset.upload_id }
						: { banner_upload_id: asset.upload_id }
				)
			);
		} catch (error) {
			refused = serverMessage(error) ?? 'That picture could not be added. Try again.';
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
				onPicture={replace}
				onSave={save}
				onCancel={() => (editing = false)}
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

		{#if refused}
			<p class="text-sm text-destructive" role="alert">{refused}</p>
		{/if}
	</div>
</div>
