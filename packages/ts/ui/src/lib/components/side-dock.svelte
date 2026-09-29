<script lang="ts" module>
	/** Below this a dock would leave the graph beside it too little to read. */
	export const DOCK_FROM_PX = 900;

	/** The widest a column of words grows inside a dock, in px. A note reads it
	 *  back as `--reading-column`, so the words and the wall stop at one number
	 *  rather than two — DESIGN.md § Layout. */
	export const DOCK_COLUMN = 672;

	/** The room a dock keeps either side of that column. */
	const GUTTERS = 32;

	/** What a docked panel may take, in px: never narrower than words read well
	 *  in, never wider than the point the column stops growing, and never so wide
	 *  that the graph beside it stops being a graph. */
	const LEAST = 352;
	const MOST = DOCK_COLUMN + GUTTERS;
	const GRAPH_KEEPS = 448;

	/** What one press of an arrow key is worth, in px. */
	const STEP = 24;

	const DOCK_SIDES = 'pr-[max(1rem,env(safe-area-inset-right))] pl-4';
	const DOCK_FOOT = 'pb-[calc(var(--safe-area-inset-bottom,env(safe-area-inset-bottom))+1rem)]';

	function widthWithin(room: number): { least: number; most: number } {
		return { least: LEAST, most: Math.max(LEAST, Math.min(MOST, room - GRAPH_KEEPS)) };
	}

	function dockedWidth(want: number, room: number): number {
		const { least, most } = widthWithin(room);
		return Math.min(most, Math.max(least, Math.round(want)));
	}
</script>

<script lang="ts">
	// A panel docked down the side of the graph — DESIGN.md § Layout. Beside the
	// graph where there is room for both, a full-height sheet where there is not,
	// with a wall the reader moves and the width it takes owed to the page.
	import type { Snippet } from 'svelte';
	import { untrack } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { cn } from '$lib/utils.js';
	import { chromeInset } from './chrome-inset.svelte.js';
	import { docksRight } from './dock-stack.svelte.js';
	import ResponsiveModal from './responsive-modal.svelte';

	let {
		open = $bindable(false),
		onDocked,
		onOpenChange,
		title,
		wall,
		outer = 0,
		scrolls = true,
		width = null,
		onWidthChange,
		children
	}: {
		open?: boolean;
		/** Whether this is standing as a dock or as a sheet. The dock's own answer,
		 *  for a surface inside it that decides what a tap leads to. */
		onDocked?: (docked: boolean) => void;
		/** For the unbound `open={expr}` pattern; a bound `open` needs nothing. */
		onOpenChange?: (open: boolean) => void;
		/** Read out; the body draws its own header. */
		title: string;
		/** What the wall between this dock and the graph is called. */
		wall: string;
		/** Where this stands in the stack of docks: the higher, the further from the
		 *  graph, and the higher it draws — so the wall an outer dock owns, which
		 *  hangs over its neighbour's edge, stays a target a finger hits. Read once,
		 *  and fixed for the dock's life. */
		outer?: number;
		/** False where the body scrolls its own parts rather than being scrolled
		 *  whole — a thread over a composer that stays put. */
		scrolls?: boolean;
		/** How much room this reader last took for a docked panel, in px. Null is
		 *  the width it opens at, and any number is safe to hand over: it is
		 *  bounded against the room the window and the docks outside it leave. */
		width?: number | null;
		/** A width the reader settled on, to keep for their next one. */
		onWidthChange?: (width: number) => void;
		children: Snippet;
	} = $props();

	const stack = untrack(() => outer);
	const place = docksRight(stack);
	$effect(() => () => place.leaves());

	const room = new MediaQuery(`(min-width: ${DOCK_FROM_PX}px)`);

	let across = $state(untrack(() => (typeof window === 'undefined' ? 0 : window.innerWidth)));
	/** The window every dock bounds itself against: what is left of it once the
	 *  chrome at the other edge has taken its room. */
	const free = $derived(across - chromeInset.start);

	/** Whether there is room to dock beside what is already docked and still
	 *  leave a graph worth the name. The first dock answers the breakpoint; a
	 *  second one answers what the first left. */
	const wouldDock = $derived(room.current && free - place.others >= LEAST + GRAPH_KEEPS);
	// Fixed for as long as something is open in it: a presentation that moved
	// under a mounted editor would tear it down mid-edit and lose the caret.
	let asDock = $state(untrack(() => wouldDock));
	$effect(() => {
		if (!open) asDock = wouldDock;
	});
	$effect(() => {
		onDocked?.(asDock);
	});

	let panel = $state<HTMLElement | null>(null);
	/** What the dock measures, for the widths that are the stylesheet's. */
	let measured = $state(0);
	/** The width the reader has dragged to. It stands ahead of {@link width},
	 *  which answers a frame later — the dock must not snap back in that frame. */
	let dragged = $state<number | null>(null);
	let dragging = $state(false);
	let grabbedAt = 0;
	let grabbedWidth = 0;
	/** What the dock stood at when the wall was grabbed, and whether the grab
	 *  became a drag. A press that never moved is put back: a width nobody chose,
	 *  written down, would pin a panel that had been sizing itself to the
	 *  window. */
	let ungrabbed: number | null = null;
	let moved = false;

	const wanted = $derived(dragged ?? width);
	const stands = $derived(
		across > 0 && wanted !== null ? dockedWidth(wanted, free - place.others) : null
	);
	const bounds = $derived(widthWithin((across > 0 ? free : DOCK_FROM_PX) - place.others));

	const handle = (v: boolean) => {
		open = v;
		onOpenChange?.(v);
	};

	$effect(() => {
		if (!asDock || !open) return;
		const from = untrack(() => document.activeElement);
		panel?.focus();
		return () => {
			const ours = panel?.contains(document.activeElement) ?? false;
			if (ours && from instanceof HTMLElement && from.isConnected) from.focus();
		};
	});

	$effect(() => {
		const measure = () => (across = window.innerWidth);
		measure();
		window.addEventListener('resize', measure);
		return () => window.removeEventListener('resize', measure);
	});

	$effect(() => {
		const el = panel;
		if (!asDock || !open || !el) return;
		const measure = () => (measured = el.offsetWidth);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => {
			observer.disconnect();
			place.takes(null);
		};
	});

	// `stands` is read here rather than measured, so a width the reader is still
	// dragging reaches the chrome beside the dock in the frame it is applied.
	$effect(() => {
		if (!asDock || !open || !panel) return;
		place.takes(stands ?? measured);
	});

	function startDrag(event: PointerEvent): void {
		if (event.button !== 0) return;
		// The wall lies over the edge of the canvas, and what starts on the wall is
		// the wall's — never a pan of the graph underneath it.
		event.preventDefault();
		event.stopPropagation();
		grabbedAt = event.clientX;
		grabbedWidth = stands ?? measured;
		ungrabbed = dragged;
		moved = false;
		dragging = true;
		dragged = dockedWidth(grabbedWidth, across - place.others);
		(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
	}

	function onDrag(event: PointerEvent): void {
		if (!dragging) return;
		if (event.clientX !== grabbedAt) moved = true;
		dragged = dockedWidth(grabbedWidth + (grabbedAt - event.clientX), across - place.others);
	}

	function endDrag(): void {
		if (!dragging) return;
		dragging = false;
		if (!moved) {
			dragged = ungrabbed;
			return;
		}
		if (dragged !== null) onWidthChange?.(dragged);
	}

	function onWallKey(event: KeyboardEvent): void {
		const at = stands ?? measured;
		const to =
			event.key === 'ArrowLeft'
				? at + STEP
				: event.key === 'ArrowRight'
					? at - STEP
					: event.key === 'Home'
						? bounds.least
						: event.key === 'End'
							? bounds.most
							: null;
		if (to === null) return;
		event.preventDefault();
		dragged = dockedWidth(to, across - place.others);
		onWidthChange?.(dragged);
	}
</script>

{#if asDock}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<aside
		bind:this={panel}
		tabindex="-1"
		aria-label={title}
		inert={!open}
		style="top: calc(var(--app-chrome-top, 0px) + env(safe-area-inset-top, 0px)); right: {place.from}px; z-index: {40 +
			stack}; transform: translateX({open ? '0px' : `calc(100% + ${place.from}px)`});{stands
			? ` width: ${stands}px`
			: ''}"
		onkeydown={(e) => {
			if (e.key === 'Escape') handle(false);
		}}
		class={cn(
			'fixed bottom-0 flex w-[clamp(22rem,38vw,34rem)] flex-col border-l border-border bg-background shadow-lg transition-[transform,opacity] duration-200 ease-out outline-none motion-reduce:transition-none',
			open ? 'opacity-100' : 'pointer-events-none opacity-0'
		)}
	>
		<div
			class={cn(
				'min-h-0 flex-1',
				scrolls
					? 'overflow-x-hidden overflow-y-auto overscroll-contain'
					: 'flex flex-col overflow-hidden',
				DOCK_SIDES,
				DOCK_FOOT
			)}
		>
			{@render children()}
		</div>

		<!-- Last in the dock, so the way out of what it holds is what a keyboard
		     reader reaches first. A separator a reader can focus and move IS a
		     widget; the rule reads the role as decoration either way. -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			role="separator"
			tabindex="0"
			aria-orientation="vertical"
			aria-label={wall}
			aria-valuenow={stands ?? measured}
			aria-valuemin={bounds.least}
			aria-valuemax={bounds.most}
			onpointerdown={startDrag}
			onpointermove={onDrag}
			onpointerup={endDrag}
			onpointercancel={endDrag}
			onlostpointercapture={endDrag}
			onkeydown={onWallKey}
			class="group absolute inset-y-0 -left-3 z-10 flex w-6 cursor-col-resize touch-none items-center justify-center focus-visible:outline-none"
		>
			<!-- A grip at rest, because the tablet this docks on has no hover. -->
			<span
				class={cn(
					'transition-[background-color,height,width] duration-150 ease-out motion-reduce:transition-none',
					dragging
						? 'h-full w-0.5 bg-ring'
						: 'h-10 w-1 rounded-full bg-border group-hover:bg-muted-foreground/60 group-focus-visible:bg-ring'
				)}
			></span>
		</div>
	</aside>
{:else}
	<ResponsiveModal {open} onOpenChange={handle} {title} {scrolls} headed={false} fill>
		{@render children()}
	</ResponsiveModal>
{/if}
