<script lang="ts">
	// Tagging every note somebody chose, in the same field a single note is
	// tagged in — DESIGN.md § Forms: a tag is written by typing it.
	import type { Tag, TagCount } from '@sloppy/types';
	import ResponsiveModal from '../responsive-modal.svelte';
	import TagField from '../tags/tag-field.svelte';

	let {
		open = $bindable(false),
		count,
		tags,
		suggestions = [],
		refused = null,
		missed = null,
		onadd,
		onremove
	}: {
		open?: boolean;
		count: number;
		/** Every tag the chosen notes carry between them: a chip may be on one of
		 *  them and not the rest, which the description says. */
		tags: readonly Tag[];
		suggestions?: readonly TagCount[];
		refused?: string | null;
		/** What the last act did not reach, having otherwise landed. Said here too:
		 *  this surface covers the bar that says it beside the graph. */
		missed?: string | null;
		/** Puts these on every chosen note; rejecting restores the chips. */
		onadd: (tags: Tag[]) => Promise<void>;
		/** Takes these off every chosen note that carries one. */
		onremove: (tags: Tag[]) => Promise<void>;
	} = $props();

	const description = $derived(
		count === 1
			? 'Anything you add goes on this note, and anything you take off comes off it.'
			: 'A word on any of them shows here. Anything you add goes on all of them, and anything you take off comes off all of them.'
	);

	async function change(next: Tag[]): Promise<void> {
		const before = new Set(tags);
		const after = new Set(next);
		const added = next.filter((tag) => !before.has(tag));
		const removed = tags.filter((tag) => !after.has(tag));
		if (added.length > 0) await onadd(added);
		if (removed.length > 0) await onremove([...removed]);
	}
</script>

<ResponsiveModal
	bind:open
	title={count === 1 ? 'Tag this note' : `Tag ${count} notes`}
	{description}
>
	<div class="space-y-2 px-2 pt-4">
		<TagField
			{tags}
			suggestions={suggestions.map((entry) => entry.tag)}
			label="Tags"
			{refused}
			onchange={change}
		/>
		{#if missed}
			<p class="text-sm text-destructive" role="alert">{missed}</p>
		{/if}
	</div>
</ResponsiveModal>
