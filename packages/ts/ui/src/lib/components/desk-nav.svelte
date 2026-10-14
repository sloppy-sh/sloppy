<script lang="ts" module>
	/** What an open column may take, in px: never narrower than its destinations'
	 *  words read in, never wider than its own parts grow, and never so wide that
	 *  the graph beside it stops being a graph — the bargain `side-dock` strikes
	 *  at the other edge, DESIGN.md § Layout. */
	const LEAST = 224;
	const MOST = 448;
	const GRAPH_KEEPS = 448;

	/** What one press of an arrow key is worth, in px. */
	const STEP = 24;

	/** `room` is what the window has left once the docks have taken theirs. */
	export function columnWithin(room: number): { least: number; most: number } {
		return { least: LEAST, most: Math.max(LEAST, Math.min(MOST, room - GRAPH_KEEPS)) };
	}

	export function columnWidth(want: number, room: number): number {
		const { least, most } = columnWithin(room);
		return Math.min(most, Math.max(least, Math.round(want)));
	}
</script>

<script lang="ts">
	// The chrome beside the graph on a desk — DESIGN.md § Layout. Presentational
	// like the pill it stands in place of: the destinations are handed to it, and
	// the page on screen fills the rest through `deskNav`. Not shadcn's Sidebar:
	// that one lays the page out around itself where `main` must stay `contents`,
	// and keeps a breakpoint and a cookie of its own where the dock width and
	// `prefs` already decide both.
	import PanelLeftClose from '@lucide/svelte/icons/panel-left-close';
	import PanelLeftOpen from '@lucide/svelte/icons/panel-left-open';
	import { untrack } from 'svelte';
	import { cn } from '$lib/utils.js';
	import { chromeInset } from './chrome-inset.svelte.js';
	import { deskNav, DESK_FROM_PX } from './desk-nav.svelte.js';
	import { docksTake } from './dock-stack.svelte.js';
	import Avatar from './identity/avatar.svelte';
	import type { NavAction, NavItem } from './nav-pill.svelte';

	let {
		items,
		activeId,
		action,
		open = true,
		onOpenChange,
		width = null,
		onWidthChange
	}: {
		items: NavItem[];
		activeId?: string;
		action?: NavAction;
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		/** How much room this reader last took for the open column, in px. Null is
		 *  the width it opens at, and any number is safe to hand over: it is
		 *  bounded against the room the window and the docks leave. */
		width?: number | null;
		/** A width the reader settled on, to keep for their next one. */
		onWidthChange?: (width: number) => void;
	} = $props();

	const collapsed = $derived(!open);

	const control =
		'flex min-h-control min-w-control items-center gap-3 rounded-lg px-2.5 text-sm font-medium transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none';
	const quiet = 'text-foreground/70 hover:bg-muted/70 hover:text-foreground';

	let column = $state<HTMLElement | null>(null);
	/** What the column measures, for the widths that are the stylesheet's. */
	let measured = $state(0);
	/** The width the reader has dragged to. It stands ahead of {@link width},
	 *  which answers a frame later — the column must not snap back in that
	 *  frame. */
	let dragged = $state<number | null>(null);
	let dragging = $state(false);
	let grabbedAt = 0;
	let grabbedWidth = 0;
	/** What the column stood at when the wall was grabbed, and whether the grab
	 *  became a drag. A press that never moved is put back: a width nobody chose,
	 *  written down, would pin a column that had been sizing itself to the
	 *  window. */
	let ungrabbed: number | null = null;
	let moved = false;

	let across = $state(untrack(() => (typeof window === 'undefined' ? 0 : window.innerWidth)));
	const room = $derived((across > 0 ? across : DESK_FROM_PX) - docksTake());

	const wanted = $derived(dragged ?? width);
	const stands = $derived(
		!collapsed && across > 0 && wanted !== null ? columnWidth(wanted, room) : null
	);
	const bounds = $derived(columnWithin(room));

	$effect(() => {
		const measure = () => (across = window.innerWidth);
		measure();
		window.addEventListener('resize', measure);
		return () => window.removeEventListener('resize', measure);
	});

	$effect(() => {
		const el = column;
		if (!el) return;
		const measure = () => (measured = el.offsetWidth);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	});

	// Owes its width as `--app-chrome-inset-start` — DESIGN.md § "The four inset
	// vars". `stands` is read here rather than measured, so a width the reader is
	// still dragging reaches the docks in the frame it is applied.
	$effect(() => {
		const root = document.documentElement;
		if (!column) {
			root.style.removeProperty('--app-chrome-inset-start');
			chromeInset.takes(0);
			return;
		}
		const px = stands ?? measured;
		root.style.setProperty('--app-chrome-inset-start', `${px}px`);
		chromeInset.takes(px);
	});

	$effect(() => () => {
		document.documentElement.style.removeProperty('--app-chrome-inset-start');
		chromeInset.takes(0);
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
		dragged = columnWidth(grabbedWidth, room);
		(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
	}

	function onDrag(event: PointerEvent): void {
		if (!dragging) return;
		if (event.clientX !== grabbedAt) moved = true;
		dragged = columnWidth(grabbedWidth + (event.clientX - grabbedAt), room);
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
			event.key === 'ArrowRight'
				? at + STEP
				: event.key === 'ArrowLeft'
					? at - STEP
					: event.key === 'Home'
						? bounds.least
						: event.key === 'End'
							? bounds.most
							: null;
		if (to === null) return;
		event.preventDefault();
		dragged = columnWidth(to, room);
		onWidthChange?.(dragged);
	}
</script>

<aside
	bind:this={column}
	aria-label="Sloppy"
	style="top: var(--app-chrome-top, 0px){stands === null ? '' : `; width: ${stands}px`}"
	class={cn(
		'fixed start-0 bottom-0 z-40 flex flex-col gap-2 border-e bg-card/95 pt-[max(0.75rem,calc(env(safe-area-inset-top,0px)-var(--app-chrome-top,0px)))] pb-[calc(var(--safe-area-inset-bottom,env(safe-area-inset-bottom))+0.75rem)] backdrop-blur',
		collapsed
			? 'w-(--desk-nav-rail) px-1.5'
			: stands === null
				? 'w-(--desk-nav-width) px-2'
				: 'px-2'
	)}
>
	<!-- The head is where the page is looked at differently — the column narrowed,
	     and whatever the page puts beside that — so those stand together. -->
	<div class={cn('flex gap-1', collapsed ? 'flex-col items-center' : 'items-center')}>
		{#if deskNav.head && !collapsed}
			<!-- Named, so what the page puts here can draw itself to the room left
			     beside the toggle rather than over it. -->
			<div class="@container/desk-nav-head flex min-w-0 flex-1 items-center">
				{@render deskNav.head({ collapsed })}
			</div>
		{/if}
		<button
			type="button"
			aria-expanded={open}
			aria-label={open ? 'Narrow this column' : 'Widen this column'}
			onclick={() => onOpenChange?.(!open)}
			class={cn(control, quiet, 'ms-auto justify-center px-2.5')}
		>
			{#if open}
				<PanelLeftClose class="size-5" />
			{:else}
				<PanelLeftOpen class="size-5" />
			{/if}
		</button>
		{#if deskNav.head && collapsed}
			{@render deskNav.head({ collapsed })}
		{/if}
	</div>

	{#if deskNav.parts}
		<div class="flex min-h-0 flex-1 flex-col gap-2">
			{@render deskNav.parts({ collapsed })}
		</div>
	{:else}
		<div class="flex-1"></div>
	{/if}

	<nav aria-label="Primary" class="flex flex-col gap-0.5 border-t pt-2">
		{#each items as item (item.id)}
			{@const active = item.id === activeId}
			<a
				href={item.href}
				aria-current={active ? 'page' : undefined}
				aria-label={collapsed ? item.label : undefined}
				title={collapsed ? item.label : undefined}
				class={cn(
					control,
					active ? 'bg-primary/10 text-primary' : quiet,
					collapsed && 'justify-center px-2.5'
				)}
			>
				<span class="relative flex shrink-0">
					{#if item.person}
						<Avatar person={item.person} size={20} />
					{:else}
						<item.icon class="size-5" />
					{/if}
					{#if item.badge}
						<span
							class="absolute -top-1 -right-2 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground"
						>
							{item.badge > 9 ? '9+' : item.badge}
						</span>
					{/if}
				</span>
				{#if !collapsed}
					<span class="min-w-0 truncate">{item.label}</span>
				{/if}
			</a>
		{/each}

		{#if action}
			<button
				type="button"
				onclick={action.onSelect}
				aria-label={collapsed ? action.label : undefined}
				title={collapsed ? action.label : undefined}
				class={cn(control, quiet, collapsed && 'justify-center px-2.5')}
			>
				<action.icon class="size-5 shrink-0" />
				{#if !collapsed}
					<span class="min-w-0 truncate">{action.label}</span>
				{/if}
			</button>
		{/if}
	</nav>

	<!-- Last in the column, so the destinations come before it for a keyboard
	     reader. A separator a reader can focus and move IS a widget; the rule
	     reads the role as decoration either way. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		hidden={collapsed}
		role="separator"
		tabindex="0"
		aria-orientation="vertical"
		aria-label="How much room this column takes"
		aria-valuenow={stands ?? measured}
		aria-valuemin={bounds.least}
		aria-valuemax={bounds.most}
		onpointerdown={startDrag}
		onpointermove={onDrag}
		onpointerup={endDrag}
		onpointercancel={endDrag}
		onlostpointercapture={endDrag}
		onkeydown={onWallKey}
		class="group absolute inset-y-0 -end-3 z-10 flex w-6 cursor-col-resize touch-none items-center justify-center focus-visible:outline-none"
	>
		<!-- A grip at rest, because the tablet this stands on has no hover. -->
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
