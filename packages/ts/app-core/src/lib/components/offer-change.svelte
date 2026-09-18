<script lang="ts">
	// What somebody is about to offer on a note they do not write, read back to
	// them before it goes — DESIGN.md § "Whose writing".
	import type { OwnedRef } from '@sloppy/types';
	import { ChangedNotes, ResponsiveModal } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { Input } from '@sloppy/ui/input';
	import CompassDifference from './compass-difference.svelte';
	import {
		compassApart,
		offerDifference,
		saysAnything,
		tagsApart,
		type WritingSide
	} from './offer-difference.js';

	let {
		open = $bindable(false),
		note,
		address = undefined,
		owner,
		now,
		offered,
		busy = false,
		says = null,
		onOffer
	}: {
		open?: boolean;
		note: OwnedRef;
		address?: string;
		/** What whoever writes this note is called. */
		owner: string;
		/** The note as it stands. */
		now: WritingSide;
		/** The note as this person would have it. */
		offered: WritingSide;
		busy?: boolean;
		says?: string | null;
		onOffer: (message: string) => Promise<void>;
	} = $props();

	let message = $state('');

	const apart = $derived(
		offerDifference({ ref: note, ...(address === undefined ? {} : { address }) }, now, offered)
	);
	const tags = $derived(tagsApart(now, offered));
	const compass = $derived(compassApart(now, offered));
</script>

<ResponsiveModal
	bind:open
	title="Offer this change"
	description="It goes to {owner}, and shows on the note once they take it in."
>
	<div class="space-y-4 px-2 pt-4 pb-2">
		{#if saysAnything(apart)}
			<ChangedNotes notes={[apart]} />
		{:else if compass.length === 0}
			<p class="px-1 py-2 text-sm text-muted-foreground">You have not changed anything yet.</p>
		{/if}

		<CompassDifference apart={compass} />

		{#if tags.added.length > 0 || tags.removed.length > 0}
			<p class="px-1 text-xs text-muted-foreground">
				{#if tags.added.length > 0}Adds {tags.added.join(', ')}{/if}
				{#if tags.added.length > 0 && tags.removed.length > 0}&nbsp;·&nbsp;{/if}
				{#if tags.removed.length > 0}Takes off {tags.removed.join(', ')}{/if}
			</p>
		{/if}

		<Input
			bind:value={message}
			class="h-11"
			maxlength={2048}
			autocomplete="off"
			placeholder="Say what you changed, if you like"
			aria-label="Say what you changed"
		/>

		<Button class="h-11 w-full" disabled={busy} onclick={() => void onOffer(message)}>
			Offer it
		</Button>

		{#if says}
			<p class="text-sm text-destructive" role="alert">{says}</p>
		{/if}
	</div>
</ResponsiveModal>
