<script lang="ts">
	// Meeting somebody a surface named: what they publish, and whether the reader
	// follows them or holds any of it — PRODUCT.md § Users, "The peer".
	import { type OwnedRef, peerOrigin, splitOwnedRef } from '@sloppy/types';
	import { PersonSheet } from '@sloppy/ui';
	import { untrack } from 'svelte';
	import { peers } from '../stores/peers.svelte.js';
	import { people } from '../stores/people.svelte.js';
	import { session } from '../stores/session.svelte.js';

	/** Whom to meet; `null` closes the sheet, and closing it writes `null` back. */
	let { did = $bindable() }: { did: string | null } = $props();

	let open = $state(false);
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
			(one) => splitOwnedRef(one.publication).did === met
		)?.source_url;
		const followed = peers.following.find((one) => one.did === met)?.provider_url;
		return region ?? peerOrigin(followed ?? '') ?? undefined;
	});

	$effect(() => {
		const who = did;
		// Meeting yourself is nothing to open a sheet on.
		if (who === null || who === session.viewer?.did) {
			open = false;
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
