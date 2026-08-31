<script lang="ts" module>
	import type { OwnedRef } from '@sloppy/types';

	/** Below this the panel would leave the graph beside it too little to read. */
	const DOCK_FROM_PX = 900;

	/** How tall the strip stands. */
	const STRIP = '2.75rem';

	/** What a docked panel may take, in px: never narrower than the column a note
	 *  is worked in, never wider than the graph beside it can give up and still be
	 *  a graph — DESIGN.md § Layout. */
	const LEAST = 352;
	const MOST = 960;
	const GRAPH_KEEPS = 448;

	function widthWithin(room: number): { least: number; most: number } {
		return { least: LEAST, most: Math.max(LEAST, Math.min(MOST, room - GRAPH_KEEPS)) };
	}

	function dockedWidth(want: number, room: number): number {
		const { least, most } = widthWithin(room);
		return Math.min(most, Math.max(least, Math.round(want)));
	}

	/** One note open in the panel. The address leads, because it is what a person
	 *  cites and the one label that is never blank. */
	export interface ReadingTab {
		ref: OwnedRef;
		address: string;
		title: string;
	}
</script>

<script lang="ts">
	// The surface a note is read and worked in — DESIGN.md § Layout. Docked
	// beside the graph where there is room for both, a full-height sheet where
	// there is not, and a strip across its head once several notes are open.
	import X from '@lucide/svelte/icons/x';
	import type { Snippet } from 'svelte';
	import { untrack } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { scrollFade } from '$lib/scroll-fade.svelte.js';
	import { cn } from '$lib/utils.js';
	import ResponsiveModal from './responsive-modal.svelte';

	let {
		open = $bindable(false),
		onOpenChange,
		title,
		tabs = [],
		active = null,
		says = null,
		width = null,
		onWidthChange,
		onActivate,
		onCloseTab,
		children
	}: {
		open?: boolean;
		/** For the unbound `open={expr}` pattern; a bound `open` needs nothing. */
		onOpenChange?: (open: boolean) => void;
		/** Read out; the body draws its own header. */
		title: string;
		/** The notes open here, in the order they were opened. Fewer than two draws
		 *  no strip: one note has nothing to switch to. */
		tabs?: readonly ReadingTab[];
		/** Why another note could not be opened here, for the reader who asked. */
		says?: string | null;
		/** How much room this reader last took for a docked note, in px. Null is the
		 *  width it opens at, and any number is safe to hand over: it is bounded
		 *  against the window the panel is actually in. */
		width?: number | null;
		/** A width the reader settled on, to keep for their next note. */
		onWidthChange?: (width: number) => void;
		/** The one {@link children} is showing, of {@link tabs}. */
		active?: OwnedRef | null;
		onActivate?: (ref: OwnedRef) => void;
		onCloseTab?: (ref: OwnedRef) => void;
		children: Snippet;
	} = $props();

	const room = new MediaQuery(`(min-width: ${DOCK_FROM_PX}px)`);
	// Fixed for as long as something is open in it: a presentation that moved
	// under a mounted editor would tear it down mid-edit and lose the caret.
	let docked = $state(untrack(() => room.current));
	$effect(() => {
		if (!open) docked = room.current;
	});

	let panel = $state<HTMLElement | null>(null);
	let head = $state<HTMLElement | null>(null);
	let headHeight = $state(0);
	const stripped = $derived(tabs.length > 1);
	const headed = $derived(stripped || !!says);

	/** The window the panel bounds itself against. */
	let across = $state(0);
	/** What the panel measures, for the widths that are the stylesheet's. */
	let standing = $state(0);
	/** The width the reader has dragged to. It stands ahead of {@link width},
	 *  which answers a frame later — the panel must not snap back in that frame. */
	let dragged = $state<number | null>(null);
	let dragging = $state(false);
	let grabbedAt = 0;
	let grabbedWidth = 0;

	const wanted = $derived(dragged ?? width);
	const stands = $derived(across > 0 && wanted !== null ? dockedWidth(wanted, across) : null);
	const bounds = $derived(widthWithin(across || DOCK_FROM_PX));

	/** The strip scrolls sideways, so the tab being read is brought into it: a tab
	 *  opened past its edge is otherwise open with nothing on screen to say so. */
	const keepInView = (showing: boolean) => (tab: Element) => {
		if (showing) tab.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
	};

	const handle = (v: boolean) => {
		open = v;
		onOpenChange?.(v);
	};

	$effect(() => {
		if (!docked || !open) return;
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

	// Measured rather than assumed: the head stands as tall as everything in it,
	// which is the strip and whatever the surface has to say — DESIGN.md
	// § "The four inset vars".
	$effect(() => {
		const el = head;
		if (!el) {
			headHeight = 0;
			return;
		}
		const measure = () => {
			headHeight = el.offsetHeight;
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	});

	// The panel owes the width it takes to whatever it is beside — DESIGN.md
	// § "The four inset vars". The canvas there resizes to its parent on a window
	// `resize` and nothing else, and the window did not change: only the box the
	// panel left it.
	let taken = '';
	function takes(width: string): void {
		if (width === taken) return;
		taken = width;
		const root = document.documentElement;
		if (width) root.style.setProperty('--reading-dock-inset-right', width);
		else root.style.removeProperty('--reading-dock-inset-right');
		window.dispatchEvent(new Event('resize'));
	}

	$effect(() => {
		const el = panel;
		if (!docked || !open || !el) return;
		const measure = () => (standing = el.offsetWidth);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => {
			observer.disconnect();
			takes('');
		};
	});

	// `stands` is read here rather than measured, so a width the reader is still
	// dragging reaches the chrome beside the panel in the frame it is applied.
	$effect(() => {
		if (!docked || !open || !panel) return;
		takes(`${stands ?? standing}px`);
	});

	function startDrag(event: PointerEvent): void {
		// The wall lies over the edge of the canvas, and what starts on the wall is
		// the wall's — never a pan of the graph underneath it.
		event.preventDefault();
		event.stopPropagation();
		grabbedAt = event.clientX;
		grabbedWidth = stands ?? standing;
		dragging = true;
		dragged = dockedWidth(grabbedWidth, across);
		(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
	}

	function onDrag(event: PointerEvent): void {
		if (!dragging) return;
		dragged = dockedWidth(grabbedWidth + (grabbedAt - event.clientX), across);
	}

	function endDrag(): void {
		if (!dragging) return;
		dragging = false;
		if (dragged !== null) onWidthChange?.(dragged);
	}

	/** What one press of an arrow key is worth, in px. */
	const STEP = 24;

	function onWallKey(event: KeyboardEvent): void {
		const at = stands ?? standing;
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
		dragged = dockedWidth(to, across);
		onWidthChange?.(dragged);
	}
</script>

{#snippet strip()}
	<nav
		aria-label="Open notes"
		style="height: {STRIP}"
		class="flex items-stretch border-b border-border bg-background"
	>
		<div
			class="flex flex-1 items-stretch gap-1 overflow-x-auto scroll-fade-x [scrollbar-width:none]"
			{@attach scrollFade('x')}
		>
			{#each tabs as tab (tab.ref)}
				{@const showing = tab.ref === active}
				<div
					{@attach keepInView(showing)}
					class={cn(
						'flex shrink-0 items-stretch rounded-md transition-colors duration-150 ease-out motion-reduce:transition-none',
						showing ? 'bg-muted' : 'hover:bg-muted/50'
					)}
				>
					<button
						type="button"
						aria-current={showing ? 'page' : undefined}
						onclick={() => onActivate?.(tab.ref)}
						class={cn(
							'flex max-w-44 items-center gap-1.5 rounded-l-md pr-1 pl-2.5 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
							showing ? 'text-foreground' : 'text-muted-foreground'
						)}
					>
						<span class="shrink-0 address text-xs">{tab.address}</span>
						<span class="truncate">{tab.title || 'Untitled'}</span>
					</button>
					<button
						type="button"
						aria-label="Close {tab.address}"
						onclick={() => onCloseTab?.(tab.ref)}
						class="flex w-11 shrink-0 items-center justify-center rounded-r-md text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
					>
						<X class="size-3.5" />
					</button>
				</div>
			{/each}
		</div>
	</nav>
{/snippet}

{#snippet body()}
	<div style={headed ? `--reading-head: ${headHeight}px` : undefined}>
		<!-- What the surface has to say about the strip keeps the strip's place:
		     the row that asks for a note is a scroll down inside a long note, and a
		     refusal left back up there is one nobody reads. -->
		{#if headed}
			<div bind:this={head} class="sticky top-0 z-30 bg-background">
				{#if stripped}{@render strip()}{/if}
				{#if says}<p class="px-2 py-2 text-sm text-destructive" role="alert">{says}</p>{/if}
			</div>
		{/if}
		{@render children()}
	</div>
{/snippet}

{#if docked}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<aside
		bind:this={panel}
		tabindex="-1"
		aria-label={title}
		inert={!open}
		style="top: calc(var(--app-chrome-top, 0px) + env(safe-area-inset-top, 0px));{stands
			? ` width: ${stands}px`
			: ''}"
		onkeydown={(e) => {
			if (e.key === 'Escape') handle(false);
		}}
		class={cn(
			'fixed right-0 bottom-0 z-40 flex w-[clamp(22rem,38vw,34rem)] flex-col border-l border-border bg-background shadow-lg transition-[transform,opacity] duration-200 ease-out outline-none motion-reduce:transition-none',
			open ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-full opacity-0'
		)}
	>
		<!-- A separator a reader can focus and move IS a widget; the rule reads the
		     role as decoration either way. -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			role="separator"
			tabindex="0"
			aria-orientation="vertical"
			aria-label="How much room the note takes"
			aria-valuenow={stands ?? standing}
			aria-valuemin={bounds.least}
			aria-valuemax={bounds.most}
			onpointerdown={startDrag}
			onpointermove={onDrag}
			onpointerup={endDrag}
			onpointercancel={endDrag}
			onlostpointercapture={endDrag}
			onkeydown={onWallKey}
			class="group absolute inset-y-0 -left-2 z-10 flex w-4 cursor-col-resize touch-none justify-center focus-visible:outline-none"
		>
			<span
				class={cn(
					'h-full transition-[background-color,width] duration-150 ease-out motion-reduce:transition-none',
					dragging
						? 'w-0.5 bg-ring'
						: 'w-px bg-transparent group-hover:w-0.5 group-hover:bg-border group-focus-visible:w-0.5 group-focus-visible:bg-ring'
				)}
			></span>
		</div>

		<div
			class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pr-[max(1rem,env(safe-area-inset-right))] pb-[calc(var(--safe-area-inset-bottom,env(safe-area-inset-bottom))+1rem)] pl-4"
		>
			{@render body()}
		</div>
	</aside>
{:else}
	<ResponsiveModal {open} onOpenChange={handle} {title} headed={false} fill>
		{@render body()}
	</ResponsiveModal>
{/if}
