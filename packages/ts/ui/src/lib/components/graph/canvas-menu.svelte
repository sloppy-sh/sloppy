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
	/** The rule that sets the grave act apart, and the room it takes. */
	const RULE = 9;
	/** Between the point and the menu, and between the menu and the edge. */
	const GAP = 6;
	const EDGE = 8;
	const WIDTH = 240;

	const open = $derived(at !== null && items.length > 0);
	/** Where a grave act follows an ordinary one, a rule sets it apart — the order
	 *  is the caller's, and only the gap is ours. */
	const rules = $derived(
		items.map((item, at) => item.destructive === true && at > 0 && !items[at - 1].destructive)
	);
	const height = $derived(items.length * ROW + PADDING + rules.filter(Boolean).length * RULE);

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
	// A transform or `contain` on an ancestor — the reading panel has both — makes
	// it the containing block for fixed children, so viewport coordinates alone
	// put the menu outside the window. `frame` stands at the origin they resolve
	// against, and is measured rather than worked out.
	let frame = $state<HTMLElement | null>(null);
	const origin = $derived.by(() => {
		if (!place) return { top: 0, left: 0 };
		const box = frame?.getBoundingClientRect();
		return { top: box?.top ?? 0, left: box?.left ?? 0 };
	});

	$effect(() => {
		if (place) menu?.querySelector('button')?.focus();
	});

	/** Focus stays inside an open menu, so Tab wraps rather than stranding it
	 *  behind a reader who has moved on. */
	function rove(event: KeyboardEvent): void {
		const acts = [...(menu?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
		if (acts.length === 0) return;
		const here = acts.indexOf(document.activeElement as HTMLButtonElement);
		let to: number;
		switch (event.key) {
			case 'ArrowDown':
				to = here + 1;
				break;
			case 'ArrowUp':
				to = here - 1;
				break;
			case 'Tab':
				to = here + (event.shiftKey ? -1 : 1);
				break;
			case 'Home':
				to = 0;
				break;
			case 'End':
				to = acts.length - 1;
				break;
			default:
				return;
		}
		event.preventDefault();
		acts[((to % acts.length) + acts.length) % acts.length].focus();
	}

	/** The bar the platform draws over the bottom of the screen, which the menu
	 *  has to sit clear of — DESIGN.md § "The four inset vars". */
	const CLEAR_BOTTOM = 'var(--sysnav-clearance)';
</script>

<svelte:window
	onkeydown={(event) => {
		if (open && event.key === 'Escape') onclose();
	}}
/>

<div bind:this={frame} class="pointer-events-none fixed top-0 left-0 h-0 w-0"></div>

{#if place}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		data-menu-scrim
		class="fixed z-40 h-[100dvh] w-[100vw]"
		style="top: {-origin.top}px; left: {-origin.left}px;"
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
		style="left: {place.left - origin.left}px; width: {WIDTH}px; top: min({place.top -
			origin.top}px, calc(100dvh - {height}px - ({CLEAR_BOTTOM}) - {EDGE}px - {origin.top}px));"
	>
		{#each items as item, at (item.label)}
			{#if rules[at]}<div class="my-1 border-t border-border"></div>{/if}
			<button
				type="button"
				role="menuitem"
				onkeydown={rove}
				onclick={() => {
					onclose();
					item.onSelect();
				}}
				class={cn(
					'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm transition-colors duration-150 ease-out hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none',
					item.destructive && 'text-destructive'
				)}
			>
				<item.icon class="size-4 shrink-0" />
				<span class="min-w-0 flex-1 truncate">{item.label}</span>
			</button>
		{/each}
	</div>
{/if}
