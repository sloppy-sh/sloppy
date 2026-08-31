<script lang="ts" module>
	import type { OwnedRef } from '@sloppy/types';

	/** Below this the panel would leave the graph beside it too little to read. */
	const DOCK_FROM_PX = 900;

	/** How tall the strip stands. Published as `--reading-head` so the note under
	 *  it can keep its own head in place below the strip rather than beneath it. */
	const HEAD = '2.75rem';

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
	const stripped = $derived(tabs.length > 1);

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

	// The panel owes the width it takes to whatever it is beside — DESIGN.md
	// § "The four inset vars". The canvas there resizes to its parent on a window
	// `resize` and nothing else, and the window did not change: only the box the
	// panel left it.
	$effect(() => {
		const root = document.documentElement;
		let taken = '';
		const settle = (width: string) => {
			if (width === taken) return;
			taken = width;
			if (width) root.style.setProperty('--reading-dock-inset-right', width);
			else root.style.removeProperty('--reading-dock-inset-right');
			window.dispatchEvent(new Event('resize'));
		};
		const el = panel;
		if (!docked || !open || !el) return;
		const publish = () => settle(`${el.offsetWidth}px`);
		publish();
		const observer = new ResizeObserver(publish);
		observer.observe(el);
		return () => {
			observer.disconnect();
			settle('');
		};
	});
</script>

{#snippet strip()}
	<nav
		aria-label="Open notes"
		style="height: var(--reading-head)"
		class="sticky top-0 z-30 flex items-stretch border-b border-border bg-background"
	>
		<div
			class="flex flex-1 items-stretch gap-1 overflow-x-auto scroll-fade-x [scrollbar-width:none]"
			{@attach scrollFade('x')}
		>
			{#each tabs as tab (tab.ref)}
				{@const showing = tab.ref === active}
				<div
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
						class="flex w-7 shrink-0 items-center justify-center rounded-r-md text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
					>
						<X class="size-3.5" />
					</button>
				</div>
			{/each}
		</div>
	</nav>
{/snippet}

{#snippet body()}
	<div style={stripped ? `--reading-head: ${HEAD}` : undefined}>
		{#if stripped}{@render strip()}{/if}
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
		style="top: calc(var(--app-chrome-top, 0px) + env(safe-area-inset-top, 0px))"
		onkeydown={(e) => {
			if (e.key === 'Escape') handle(false);
		}}
		class={cn(
			'fixed right-0 bottom-0 z-40 flex w-[clamp(22rem,38vw,34rem)] flex-col border-l border-border bg-background shadow-lg transition-[transform,opacity] duration-200 ease-out outline-none motion-reduce:transition-none',
			open ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-full opacity-0'
		)}
	>
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
