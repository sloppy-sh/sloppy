<script lang="ts" module>
	// One shape for one concept: a row in a menu of acts on a note, wherever it
	// is raised from.
	import type { CanvasMenuItem } from './graph/canvas-menu.svelte';

	export type NoteMenuItem = CanvasMenuItem;
</script>

<script lang="ts">
	// What can be done to the note being read, held behind one control so the
	// writing leads — DESIGN.md § Layout.
	import { MediaQuery } from 'svelte/reactivity';
	import { cn } from '$lib/utils.js';
	import CanvasMenu from './graph/canvas-menu.svelte';
	import ResponsiveModal from './responsive-modal.svelte';

	let {
		open = $bindable(false),
		title = 'This note',
		anchor = null,
		items
	}: {
		open?: boolean;
		/** Read out; the rows are the whole surface. */
		title?: string;
		/** What raised it. A hand on a mouse should not cross the window to reach
		 *  the answer, so where there is one the menu opens against this. */
		anchor?: HTMLElement | null;
		items: readonly CanvasMenuItem[];
	} = $props();

	// Pointer, not width: a tablet held in two hands wants the sheet at any size,
	// and a narrow window with a mouse still wants the menu under the control.
	const mouse = new MediaQuery('(pointer: fine)');
	const placed = $derived(mouse.current && anchor !== null);
	const at = $derived.by(() => {
		if (!placed || !open || !anchor) return null;
		const box = anchor.getBoundingClientRect();
		return { clientX: box.right, clientY: box.bottom };
	});

	const acts = $derived(items.filter((item) => !item.destructive));
	const grave = $derived(items.filter((item) => item.destructive));
</script>

{#snippet row(item: CanvasMenuItem)}
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

{#if placed}
	<CanvasMenu {at} items={[...acts, ...grave]} label={title} onclose={() => (open = false)} />
{:else}
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
{/if}
