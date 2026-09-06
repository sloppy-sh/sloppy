<script lang="ts">
	// Who wrote the note on screen, and the way to meet them — DESIGN.md
	// § "Show, don't tell".
	import { type OwnedRef, peerOrigin, splitOwnedRef } from '@sloppy/types';
	import { PersonChip, PersonSheet, unplacedPerson } from '@sloppy/ui';
	import { peers } from '../stores/peers.svelte.js';
	import { people } from '../stores/people.svelte.js';
	import { session } from '../stores/session.svelte.js';

	let { did }: { did: string } = $props();

	let meeting = $state(false);

	const person = $derived(people.of(did));
	const shown = $derived(person ?? unplacedPerson(did));
	const mine = $derived(did === session.viewer?.did);
	const following = $derived(peers.following.some((one) => one.did === did));
	const held = $derived(new Set<OwnedRef>(peers.regions.map((region) => region.publication)));

	/** Where to ask about them: an instance a region of theirs came from, else
	 *  the provider recorded beside their identity. Neither is more than a best
	 *  guess — an identity names a person and never a place. */
	const from = $derived.by(() => {
		const region = peers.regions.find(
			(one) => splitOwnedRef(one.publication).did === did
		)?.source_url;
		const followed = peers.following.find((one) => one.did === did)?.provider_url;
		return region ?? peerOrigin(followed ?? '') ?? undefined;
	});

	$effect(() => {
		people.resolve(did);
	});

	function meet(): void {
		meeting = true;
		void peers.load();
	}
</script>

{#if mine}
	<PersonChip person={shown} size={24} handle={false} class="gap-2 text-sm" />
{:else}
	<button
		type="button"
		class="-mx-1 flex min-h-9 min-w-0 items-center rounded-md px-1 transition-colors duration-150 ease-out hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
		onclick={meet}
	>
		<PersonChip person={shown} size={24} handle={false} class="gap-2 text-sm" />
	</button>

	<PersonSheet
		bind:open={meeting}
		identity={did}
		{person}
		{following}
		{held}
		busy={peers.busy}
		says={peers.says}
		onLook={async (cursor) => {
			const page = await peers.publishedBy(did, { sourceUrl: from, cursor });
			return page && { publications: page.publications, nextCursor: page.next_cursor };
		}}
		onPull={(publication) => void peers.pull({ publication, sourceUrl: from })}
		onFollow={() => void peers.follow(did)}
		onUnfollow={() => void peers.unfollow(did)}
	/>
{/if}
