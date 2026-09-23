<script lang="ts" module>
	import type { OwnedRef } from '@sloppy/types';
	import type { PublishedThere } from '../peers/peer.js';
	import type { Person } from './person.js';

	export interface PersonSheetProps {
		open?: boolean;
		/** Whoever this is about, as they are followed and cited. */
		identity: string;
		/** Absent where nobody could place them, which is somebody unnamed. */
		person: Person | null;
		following: boolean;
		busy?: boolean;
		/** Why the last thing asked for did not happen. */
		says?: string | null;
		/** The publications the reader already holds a copy of. */
		held?: ReadonlySet<OwnedRef>;
		/** What they publish, a page at a time; `cursor` asks for the one after.
		 *  `null` where the ask did not land, with {@link says} carrying why. */
		onLook: (cursor?: string) => Promise<PublishedThere | null>;
		onPull: (publication: OwnedRef) => void;
		onFollow: () => void;
		onUnfollow: () => void;
	}
</script>

<script lang="ts">
	// Somebody a reader just met: who they are, what they publish, and whether
	// the reader follows them — PRODUCT.md § Users, "The peer".
	import UserMinus from '@lucide/svelte/icons/user-minus';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import PublishedRoots from '../peers/published-roots.svelte';
	import ResponsiveModal from '../responsive-modal.svelte';
	import Avatar from './avatar.svelte';
	import IdentityLine from './identity-line.svelte';
	import PersonHeader from './person-header.svelte';
	import { nameOf, unnamedPerson } from './person.js';

	let {
		open = $bindable(false),
		identity,
		person,
		following,
		busy = false,
		says = null,
		held = new Set<OwnedRef>(),
		onLook,
		onPull,
		onFollow,
		onUnfollow
	}: PersonSheetProps = $props();

	let found = $state<PublishedThere | null>(null);
	let looking = $state(false);
	/** Whose listing {@link found} is, so a sheet reopened on somebody else does
	 *  not draw the last person's branches while theirs arrive. Dropped on close,
	 *  so a listing that did not land is asked for again next time. */
	let listed: string | null = null;

	const shown = $derived(person ?? unnamedPerson(identity));

	$effect(() => {
		if (!open) {
			listed = null;
			return;
		}
		if (listed === identity) return;
		const who = identity;
		listed = who;
		found = null;
		looking = true;
		void onLook()
			.then((page) => {
				if (listed === who) found = page;
			})
			.finally(() => {
				if (listed === who) looking = false;
			});
	});

	async function more(cursor: string): Promise<void> {
		const page = await onLook(cursor);
		if (!page) return;
		found = {
			identity: found?.identity ?? page.identity,
			publications: [...(found?.publications ?? []), ...page.publications],
			nextCursor: page.nextCursor
		};
	}
</script>

{#snippet follow()}
	{#if following}
		<Button
			variant="ghost"
			class="h-11 shrink-0 rounded-full sm:h-9"
			disabled={busy}
			onclick={onUnfollow}
		>
			<UserMinus class="size-4" />
			Stop following
		</Button>
	{:else}
		<Button
			variant="outline"
			class="h-11 shrink-0 rounded-full sm:h-9"
			disabled={busy}
			onclick={onFollow}
		>
			<UserPlus class="size-4" />
			Follow
		</Button>
	{/if}
{/snippet}

<ResponsiveModal bind:open title={nameOf(shown)} headed={false}>
	<div class="space-y-6 px-2 pt-4 pb-2">
		{#if person}
			<PersonHeader {person} actions={follow} />
		{:else}
			<div class="flex items-center gap-3">
				<Avatar person={shown} size={48} />
				<div class="min-w-0 flex-1 space-y-0.5">
					<p class="truncate text-lg font-semibold tracking-tight">{nameOf(shown)}</p>
					<p class="text-sm text-muted-foreground">Nobody here could say who this is.</p>
				</div>
				{@render follow()}
			</div>
		{/if}

		<section class="space-y-2 border-t border-border pt-4">
			<h3 class="text-sm font-medium">Their identity</h3>
			<IdentityLine {identity} label="Copy their identity" />
		</section>

		<section class="space-y-2 border-t border-border pt-4">
			<h3 class="text-sm font-medium">What they publish</h3>
			{#if looking}
				<Skeleton class="h-11 w-full" />
			{:else if found}
				<PublishedRoots
					publications={found.publications}
					nextCursor={found.nextCursor}
					{busy}
					{held}
					onpull={onPull}
					onmore={more}
				/>
			{/if}
			{#if says}
				<p class="text-sm text-destructive" role="alert">{says}</p>
			{/if}
		</section>
	</div>
</ResponsiveModal>
