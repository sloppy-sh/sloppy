<script lang="ts" module>
	import { noteLabel, type OwnedRef } from '@sloppy/types';

	/** How tall the strip stands. */
	const STRIP = '2.75rem';

	/** One note open in the panel. The address leads where there is one, because
	 *  it is what a person cites; a note with none is read by its title. */
	export interface ReadingTab {
		ref: OwnedRef;
		address?: string;
		title: string;
		/** The graph the address is read in. Null where every open note is in one
		 *  graph, which the strip does not repeat. */
		graph?: string | null;
	}
</script>

<script lang="ts">
	// The surface a note is read and worked in — DESIGN.md § Layout. A dock
	// beside the graph, and a strip across its head once several notes are open.
	import X from '@lucide/svelte/icons/x';
	import type { Snippet } from 'svelte';
	import { scrollFade } from '$lib/scroll-fade.svelte.js';
	import { cn } from '$lib/utils.js';
	import SideDock, { DOCK_COLUMN } from './side-dock.svelte';

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

	let head = $state<HTMLElement | null>(null);
	let headHeight = $state(0);
	const stripped = $derived(tabs.length > 1);
	const headed = $derived(stripped || !!says);

	/** The strip scrolls sideways, so the tab being read is brought into it: a tab
	 *  opened past its edge is otherwise open with nothing on screen to say so. */
	const keepInView = (showing: boolean) => (tab: Element) => {
		if (showing) tab.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
	};

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
						aria-label={tab.graph
							? `${[tab.address, tab.title || 'Untitled'].filter(Boolean).join(' ')}, in ${tab.graph}`
							: undefined}
						onclick={() => onActivate?.(tab.ref)}
						class={cn(
							'flex items-center gap-1.5 rounded-l-md pr-1 pl-2.5 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
							tab.graph ? 'max-w-60' : 'max-w-44',
							showing ? 'text-foreground' : 'text-muted-foreground'
						)}
					>
						{#if tab.address}<span class="shrink-0 address text-xs">{tab.address}</span>{/if}
						<span class="truncate">{tab.title || 'Untitled'}</span>
						{#if tab.graph}
							<span class="max-w-24 shrink-0 truncate text-xs text-muted-foreground"
								>{tab.graph}</span
							>
						{/if}
					</button>
					<button
						type="button"
						aria-label={tab.graph
							? `Close ${noteLabel(tab)} in ${tab.graph}`
							: `Close ${noteLabel(tab)}`}
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

<SideDock
	bind:open
	{onOpenChange}
	{title}
	{width}
	{onWidthChange}
	wall="How much room the note takes"
>
	<div style="--reading-column: {DOCK_COLUMN}px;{headed ? ` --reading-head: ${headHeight}px` : ''}">
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
</SideDock>
