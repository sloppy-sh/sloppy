<script lang="ts">
	// What somebody has chosen on the canvas, and the acts on it. Pinned to the
	// bottom, above the nav pill and the system bar under it.
	import CircleDashed from '@lucide/svelte/icons/circle-dashed';
	import Globe from '@lucide/svelte/icons/globe';
	import Tag from '@lucide/svelte/icons/tag';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { Button } from '$lib/components/ui/button/index.js';

	let {
		count,
		says = null,
		onTags,
		onLook,
		onPublish,
		onDelete,
		onDone
	}: {
		count: number;
		/** What the last act left to say — why it did not land, or what it did not
		 *  reach where the rest of it did. In the caller's words. */
		says?: string | null;
		onTags: () => void;
		onLook: () => void;
		onPublish: () => void;
		onDelete: () => void;
		onDone: () => void;
	} = $props();

	const tally = $derived(
		count === 0
			? 'Tap the notes you mean'
			: `${count.toLocaleString()} ${count === 1 ? 'note chosen' : 'notes chosen'}`
	);

	const acts = $derived([
		{ label: 'Tags', icon: Tag, onSelect: onTags },
		{ label: 'Look', icon: CircleDashed, onSelect: onLook },
		{ label: 'Publish', icon: Globe, onSelect: onPublish },
		{ label: 'Delete', icon: Trash2, onSelect: onDelete, destructive: true }
	]);
</script>

<div
	class="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3"
	style="right: var(--reading-dock-inset-right, 0px); padding-bottom: calc(var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)) + var(--sysnav-inset-bottom, 0px) + 0.5rem)"
>
	<div
		class="pointer-events-auto w-full max-w-md rounded-2xl border bg-card/95 p-2 shadow-lg backdrop-blur"
	>
		<div class="flex items-center gap-2 px-2 {count > 0 ? 'pb-1' : ''}">
			<p class="min-w-0 flex-1 truncate text-sm" aria-live="polite">{tally}</p>
			<Button variant="ghost" class="h-9 shrink-0 rounded-full" onclick={onDone}>Done</Button>
		</div>

		{#if says}
			<p class="px-2 pb-2 text-sm text-destructive" role="alert">{says}</p>
		{/if}

		{#if count > 0}
			<div class="grid grid-cols-4 gap-1">
				{#each acts as act (act.label)}
					<Button
						variant="ghost"
						onclick={act.onSelect}
						class="h-14 flex-col gap-1 rounded-xl {act.destructive
							? 'text-destructive hover:text-destructive'
							: ''}"
					>
						<act.icon class="size-5" />
						<span class="text-xs leading-none">{act.label}</span>
					</Button>
				{/each}
			</div>
		{/if}
	</div>
</div>
