<script lang="ts" module>
	import type { Component } from 'svelte';

	export interface NoteMenuItem {
		label: string;
		icon: Component;
		onSelect: () => void;
		/** The one act that cannot be taken back. It is set apart at the foot,
		 *  away from where a hand lands on its way to anything else. */
		destructive?: boolean;
	}
</script>

<script lang="ts">
	// What can be done to the note being read, held behind one control so the
	// writing leads — DESIGN.md § Layout.
	import { cn } from '$lib/utils.js';
	import ResponsiveModal from './responsive-modal.svelte';

	let {
		open = $bindable(false),
		title = 'This note',
		items
	}: {
		open?: boolean;
		/** Read out; the rows are the whole surface. */
		title?: string;
		items: readonly NoteMenuItem[];
	} = $props();

	const acts = $derived(items.filter((item) => !item.destructive));
	const grave = $derived(items.filter((item) => item.destructive));
</script>

{#snippet row(item: NoteMenuItem)}
	<button
		type="button"
		onclick={() => {
			open = false;
			item.onSelect();
		}}
		class={cn(
			'flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-sm transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none',
			item.destructive ? 'text-destructive hover:bg-destructive/10' : 'hover:bg-muted/70'
		)}
	>
		<item.icon class="size-4 shrink-0" />
		<span class="min-w-0 flex-1 truncate">{item.label}</span>
	</button>
{/snippet}

<ResponsiveModal bind:open {title} headed={false} class="sm:max-w-xs">
	<div class="px-1 pt-2">
		{#each acts as item (item.label)}
			{@render row(item)}
		{/each}
		{#if grave.length > 0 && acts.length > 0}
			<div class="my-2 border-t border-border"></div>
		{/if}
		{#each grave as item (item.label)}
			{@render row(item)}
		{/each}
	</div>
</ResponsiveModal>
