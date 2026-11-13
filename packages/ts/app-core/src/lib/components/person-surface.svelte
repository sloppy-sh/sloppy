<script lang="ts">
	// Meeting somebody a surface named: what they publish, and whether the reader
	// follows them or holds any of it — PRODUCT.md § Users, "The peer".
	import { type OwnedRef, peerOrigin, principalScheme, splitOwnedRef } from '@sloppy/types';
	import {
		IdentityLine,
		nameOf,
		PersonAvatar,
		PersonHeader,
		PersonSheet,
		ResponsiveModal,
		unnamedPerson
	} from '@sloppy/ui';
	import { untrack } from 'svelte';
	import { peers } from '../stores/peers.svelte.js';
	import { people } from '../stores/people.svelte.js';
	import { session } from '../stores/session.svelte.js';

	/** Whom to meet; `null` closes the sheet, and closing it writes `null` back. */
	let { did = $bindable() }: { did: string | null } = $props();

	let open = $state(false);
	let openW3id = $state(false);
	/** Whom the sheet is about, which trails {@link did}: the instance to ask is
	 *  read off the reader's follows and regions, and those arrive first. */
	let met = $state<string | null>(null);

	const person = $derived(met === null ? null : people.of(met));
	const following = $derived(peers.following.some((one) => one.did === met));
	const held = $derived(new Set<OwnedRef>(peers.regions.map((region) => region.publication)));

	/** Where to ask about them: an instance a region of theirs came from, else
	 *  the provider recorded beside their identity. Neither is more than a best
	 *  guess — an identity names a person and never a place. */
	const from = $derived.by(() => {
		if (met === null) return undefined;
		const region = peers.regions.find(
			(one) => splitOwnedRef(one.publication).owner === met
		)?.source_url;
		const followed = peers.following.find((one) => one.did === met)?.provider_url;
		return region ?? peerOrigin(followed ?? '') ?? undefined;
	});

	$effect(() => {
		const who = did;
		// Meeting yourself is nothing to open a sheet on.
		if (who === null || who === session.viewer?.did) {
			open = false;
			openW3id = false;
			return;
		}
		// Somebody named by a W3ID publishes nowhere this app reads, so there is
		// only who they are to show.
		if (principalScheme(who) === 'w3id') {
			untrack(() => {
				people.resolve(who);
				met = who;
				openW3id = true;
			});
			return;
		}
		untrack(() => {
			people.resolve(who);
			void peers.load().then(() => {
				if (did !== who) return;
				met = who;
				open = true;
			});
		});
	});
</script>

{#if met !== null && principalScheme(met) === 'w3id'}
	{@const shown = person ?? unnamedPerson(met)}
	{@const said = people.said(met)}
	<ResponsiveModal
		bind:open={
			() => openW3id,
			(showing) => {
				openW3id = showing;
				if (!showing) did = null;
			}
		}
		title={nameOf(shown)}
		headed={false}
	>
		<div class="space-y-6 px-2 pt-4 pb-2">
			{#if person}
				<PersonHeader {person} />
			{:else}
				<div class="flex items-center gap-3">
					<PersonAvatar person={shown} size={48} />
					<div class="min-w-0 flex-1 space-y-0.5">
						<p class="truncate text-lg font-semibold tracking-tight">{nameOf(shown)}</p>
						{#if said}
							<p class="text-sm text-muted-foreground">{said}</p>
						{/if}
					</div>
				</div>
			{/if}

			<section class="space-y-2 border-t border-border pt-4">
				<h3 class="text-sm font-medium">Their identity</h3>
				<IdentityLine identity={met.slice('w3id:'.length)} label="Copy their identity" />
			</section>
		</div>
	</ResponsiveModal>
{/if}

<PersonSheet
	bind:open={
		() => open,
		(shown) => {
			open = shown;
			if (!shown) did = null;
		}
	}
	identity={met ?? ''}
	{person}
	{following}
	{held}
	busy={peers.busy}
	says={peers.says}
	onLook={async (cursor) => {
		const who = met;
		if (who === null) return null;
		const page = await peers.publishedBy(who, { sourceUrl: from, cursor });
		return page && { identity: who, publications: page.publications, nextCursor: page.next_cursor };
	}}
	onPull={(publication) => void peers.pull({ publication, sourceUrl: from })}
	onFollow={() => {
		if (met !== null) void peers.follow(met);
	}}
	onUnfollow={() => {
		if (met !== null) void peers.unfollow(met);
	}}
/>
