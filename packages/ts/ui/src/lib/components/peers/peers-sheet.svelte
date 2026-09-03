<script lang="ts">
	// Reading somebody else's graph: the regions already held, the people the
	// reader follows, and the way to find somebody who is neither.
	import Search from '@lucide/svelte/icons/search';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import UserMinus from '@lucide/svelte/icons/user-minus';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import { type OwnedRef, peerOrigin } from '@sloppy/types';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import PersonChip from '../identity/person-chip.svelte';
	import { nameOf } from '../identity/person.js';
	import ResponsiveModal from '../responsive-modal.svelte';
	import type { HeldRegion, Peer, PublishedThere } from './peer.js';
	import PublishedRoots from './published-roots.svelte';

	let {
		open = $bindable(false),
		regions,
		following,
		busy = false,
		says = null,
		onEnter,
		onDrop,
		onLook,
		onPull,
		onFollow,
		onUnfollow,
		onRetry
	}: {
		open?: boolean;
		regions: readonly HeldRegion[];
		following: readonly Peer[];
		busy?: boolean;
		/** Why the last thing asked for did not happen. */
		says?: string | null;
		/** Given while one of the two lists above is still to be read, so the
		 *  reader can ask for it again. */
		onRetry?: () => void;
		/** Read this region on the canvas. */
		onEnter: (ref: HeldRegion['ref']) => void;
		onDrop: (ref: HeldRegion['ref']) => void;
		/** What somebody publishes, on the instance named or on this one. A page at
		 *  a time; `cursor` asks for the one after. */
		onLook: (
			identity: string,
			where: string | undefined,
			cursor?: string
		) => Promise<PublishedThere | null>;
		/** Take a copy of one of them; the publication names its own author. */
		onPull: (where: string | undefined, publication: OwnedRef) => void;
		onFollow: (identity: string) => void;
		onUnfollow: (identity: string) => void;
	} = $props();

	let identity = $state('');
	let where = $state('');
	/** Whose listing is on screen, and where it was read from. */
	let looking = $state<{ identity: string; where: string | undefined } | null>(null);
	let found = $state<PublishedThere | null>(null);
	let refused = $state<string | null>(null);

	const heldPublications = $derived(new Set(regions.map((region) => region.publication)));
	const lookingAt = $derived(following.find((one) => one.identity === looking?.identity) ?? null);

	/** Nothing typed is this instance, which is the whole of it for somebody
	 *  whose graph is kept here. */
	function instance(): string | undefined | null {
		if (where.trim() === '') return undefined;
		return peerOrigin(where);
	}

	/** Somebody the reader already follows is asked at the instance known for
	 *  them rather than at whatever the box was last used for, and the box then
	 *  shows it so it can be changed. */
	async function lookAtFollowed(peer: Peer): Promise<void> {
		where = peer.from ?? '';
		await look(peer.identity);
	}

	async function look(who: string): Promise<void> {
		const at = instance();
		if (at === null) {
			refused = 'Enter an instance address, like https://sloppy.example';
			return;
		}
		refused = null;
		identity = who;
		found = null;
		looking = { identity: who, where: at };
		found = await onLook(who, at);
	}

	async function more(cursor: string): Promise<void> {
		if (!looking) return;
		const page = await onLook(looking.identity, looking.where, cursor);
		if (!page) return;
		found = {
			publications: [...(found?.publications ?? []), ...page.publications],
			nextCursor: page.nextCursor
		};
	}
</script>

<ResponsiveModal
	bind:open
	title="Other people's graphs"
	description="A branch somebody publishes can be read here, with the addresses its author gave it."
>
	<div class="space-y-6 px-2 pt-4 pb-2">
		{#if regions.length > 0}
			<section class="space-y-2">
				<h3 class="text-sm font-medium">What you are holding</h3>
				<ul class="space-y-1">
					{#each regions as region (region.ref)}
						<li class="flex items-center gap-3">
							<button
								type="button"
								class="flex min-w-0 flex-1 items-center gap-3 rounded-md py-2 text-left hover:bg-muted"
								onclick={() => {
									open = false;
									onEnter(region.ref);
								}}
							>
								<span class="shrink-0 address">{region.address}</span>
								<span class="min-w-0 flex-1 truncate text-sm">
									{region.person ? nameOf(region.person) : region.identity}
								</span>
							</button>
							<Button
								variant="ghost"
								size="icon"
								class="size-9 shrink-0 rounded-full"
								aria-label="Let this region go"
								disabled={busy}
								onclick={() => onDrop(region.ref)}
							>
								<Trash2 class="size-4" />
							</Button>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if following.length > 0}
			<section class="space-y-2">
				<h3 class="text-sm font-medium">Who you follow</h3>
				<ul class="space-y-1">
					{#each following as one (one.identity)}
						<li class="flex items-center gap-3">
							{#if one.person}
								<PersonChip person={one.person} size={32} class="min-w-0 flex-1" />
							{:else}
								<span class="min-w-0 flex-1 truncate font-mono text-xs">{one.identity}</span>
							{/if}
							<Button
								variant="ghost"
								class="h-9 shrink-0 rounded-full"
								disabled={busy}
								onclick={() => lookAtFollowed(one)}
							>
								What they publish
							</Button>
							<Button
								variant="ghost"
								size="icon"
								class="size-9 shrink-0 rounded-full"
								aria-label="Stop following them"
								disabled={busy}
								onclick={() => onUnfollow(one.identity)}
							>
								<UserMinus class="size-4" />
							</Button>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<section class="space-y-2">
			<h3 class="text-sm font-medium">Find somebody</h3>
			<Input
				bind:value={identity}
				class="h-11"
				autocomplete="off"
				spellcheck="false"
				placeholder="did:syr:…"
				aria-label="Who to read"
			/>
			<Input
				bind:value={where}
				class="h-11"
				autocomplete="off"
				spellcheck="false"
				inputmode="url"
				placeholder="https://sloppy.example"
				aria-label="Where their graph is"
			/>
			<p class="text-xs text-muted-foreground">
				Leave the second line empty if their graph is kept here.
			</p>
			<Button
				variant="outline"
				class="h-11 w-full"
				disabled={busy || identity.trim() === ''}
				onclick={() => look(identity.trim())}
			>
				<Search class="size-4" />
				See what they publish
			</Button>
		</section>

		{#if refused}
			<p class="text-sm text-destructive" role="alert">{refused}</p>
		{/if}
		{#if says}
			<p class="text-sm text-destructive" role="alert">{says}</p>
		{/if}
		{#if onRetry && !busy}
			<Button variant="outline" class="h-11 w-full" onclick={onRetry}>Try again</Button>
		{/if}

		{#if looking}
			{@const at = looking}
			<section class="space-y-2 border-t pt-4">
				<div class="flex items-center gap-3">
					{#if lookingAt?.person}
						<PersonChip person={lookingAt.person} size={32} class="min-w-0 flex-1" />
					{:else}
						<span class="min-w-0 flex-1 truncate font-mono text-xs">{at.identity}</span>
					{/if}
					{#if lookingAt === null}
						<Button
							variant="ghost"
							class="h-9 shrink-0 rounded-full"
							disabled={busy}
							onclick={() => onFollow(at.identity)}
						>
							<UserPlus class="size-4" />
							Follow
						</Button>
					{/if}
				</div>
				{#if found}
					<PublishedRoots
						publications={found.publications}
						nextCursor={found.nextCursor}
						{busy}
						held={heldPublications}
						onpull={(publication) => onPull(at.where, publication)}
						onmore={more}
					/>
				{/if}
			</section>
		{/if}
	</div>
</ResponsiveModal>
