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
		onadd,
		onremove
	}: {
		open?: boolean;
		count: number;
		/** Every tag the chosen notes carry between them. */
		tags: readonly Tag[];
		suggestions?: readonly TagCount[];
		refused?: string | null;
		/** Puts these on every chosen note; rejecting restores the chips. */
		onadd: (tags: Tag[]) => Promise<void>;
		/** Takes these off every chosen note that carries one. */
		onremove: (tags: Tag[]) => Promise<void>;
	} = $props();

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
	description="A word here goes on every one of them; taking one off takes it off all of them."
>
	<div class="px-2 pt-4">
		<TagField
			{tags}
			suggestions={suggestions.map((entry) => entry.tag)}
			label="Tags"
			{refused}
			onchange={change}
		/>
	</div>
</ResponsiveModal>
