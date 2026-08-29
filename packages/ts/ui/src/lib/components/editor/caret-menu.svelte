<script lang="ts">
	// A menu the caret carries: `:` for emoji, `[[` for notes.
	//
	// bits-ui gives the sheet `contain: layout`, which makes it the containing
	// block for fixed descendants, so viewport coordinates alone put the menu a
	// scroll offset away from the caret. `frame` stands at the origin they
	// resolve against, and is measured rather than worked out.
	import type { Snippet } from 'svelte';

	let {
		open,
		rect,
		width,
		rows,
		rowHeight,
		maxHeight,
		label,
		children
	}: {
		open: boolean;
		/** Where the caret is, in viewport coordinates. */
		rect: DOMRect | null;
		width: number;
		rows: number;
		/** What one row takes, which is what decides above or below. */
		rowHeight: number;
		maxHeight: number;
		label: string;
		children: Snippet;
	} = $props();

	/** Between the caret and the menu, and between the menu and the edge. */
	const GAP = 6;
	const EDGE = 8;
	/** The border box a row sits in. */
	const PADDING = 8;

	let frame = $state<HTMLElement | null>(null);

	const height = $derived(Math.min(rows * rowHeight + PADDING, maxHeight));

	const at = $derived.by(() => {
		if (!open || !rect) return null;
		const below = rect.bottom + GAP;
		const room = window.innerHeight - below;
		const top = room < height ? Math.max(EDGE, rect.top - height - GAP) : below;
		const left = Math.max(EDGE, Math.min(rect.left, window.innerWidth - width - EDGE));
		const origin = frame?.getBoundingClientRect();
		return { top: top - (origin?.top ?? 0), left: left - (origin?.left ?? 0) };
	});
</script>

<div bind:this={frame} class="pointer-events-none fixed top-0 left-0 z-50">
	{#if at}
		<div
			class="pointer-events-auto absolute overflow-y-auto overscroll-contain rounded-lg border bg-popover scroll-fade-y p-1 text-popover-foreground shadow-md [--scroll-fade:0.75rem]"
			style="top: {at.top}px; left: {at.left}px; width: {width}px; max-height: {maxHeight}px"
			role="listbox"
			aria-label={label}
		>
			{@render children()}
		</div>
	{/if}
</div>
