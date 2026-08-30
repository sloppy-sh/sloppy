<script lang="ts" module>
	import type { Component } from 'svelte';

	export interface CanvasMenuItem {
		label: string;
		icon: Component;
		onSelect: () => void;
		/** The one act that cannot be taken back. */
		destructive?: boolean;
	}
</script>

<script lang="ts">
	// The menu the canvas answers a right-click and a press-and-hold with. It is
	// placed against a point on the screen rather than against a trigger, which
	// is what `caret-menu.svelte` does inside a note.
	import { cn } from '$lib/utils.js';

	let {
		at,
		items,
		label,
		onclose
	}: {
		/** Where it was asked for, in viewport coordinates; null is closed. */
		at: { clientX: number; clientY: number } | null;
		items: readonly CanvasMenuItem[];
		label: string;
		onclose: () => void;
	} = $props();

	const ROW = 44;
	const PADDING = 8;
	/** Between the point and the menu, and between the menu and the edge. */
	const GAP = 6;
	const EDGE = 8;
	const WIDTH = 240;

	const open = $derived(at !== null && items.length > 0);
	const height = $derived(items.length * ROW + PADDING);

	const place = $derived.by(() => {
		if (!at || !open) return null;
		const below = at.clientY + GAP;
		const room = window.innerHeight - below;
		return {
			top: room < height ? Math.max(EDGE, at.clientY - height - GAP) : below,
			left: Math.max(EDGE, Math.min(at.clientX, window.innerWidth - WIDTH - EDGE))
		};
	});

	let menu = $state<HTMLElement | null>(null);

	$effect(() => {
		if (place) menu?.querySelector('button')?.focus();
	});

	/** The bar the platform draws over the bottom of the screen, which the menu
	 *  has to sit clear of — DESIGN.md § "The four inset vars". */
	const CLEAR_BOTTOM =
		'var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)) + var(--sysnav-inset-bottom, 0px)';
</script>

<svelte:window
	onkeydown={(event) => {
		if (open && event.key === 'Escape') onclose();
	}}
/>

{#if place}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-40"
		onpointerdown={onclose}
		oncontextmenu={(event) => {
			event.preventDefault();
			onclose();
		}}
	></div>

	<div
		bind:this={menu}
		role="menu"
		aria-label={label}
		class="fixed z-50 rounded-xl border bg-popover p-1 text-popover-foreground shadow-md"
		style="left: {place.left}px; width: {WIDTH}px; top: min({place.top}px, calc(100dvh - {height}px - ({CLEAR_BOTTOM}) - {EDGE}px));"
	>
		{#each items as item (item.label)}
			<button
				type="button"
				role="menuitem"
				onclick={() => {
					onclose();
					item.onSelect();
				}}
				class={cn(
					'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm transition-colors duration-150 ease-out hover:bg-muted/70 focus-visible:bg-muted/70 focus-visible:outline-none motion-reduce:transition-none',
					item.destructive && 'text-destructive'
				)}
			>
				<item.icon class="size-4 shrink-0" />
				<span class="min-w-0 flex-1 truncate">{item.label}</span>
			</button>
		{/each}
	</div>
{/if}
