<script lang="ts" module>
	/** Below this the panel would leave the graph beside it too little to read. */
	const DOCK_FROM_PX = 900;
</script>

<script lang="ts">
	// The surface a note is read and worked in — DESIGN.md § Layout. Docked
	// beside the graph where there is room for both, a full-height sheet where
	// there is not.
	import type { Snippet } from 'svelte';
	import { untrack } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { cn } from '$lib/utils.js';
	import ResponsiveModal from './responsive-modal.svelte';

	let {
		open = $bindable(false),
		onOpenChange,
		title,
		children
	}: {
		open?: boolean;
		/** For the unbound `open={expr}` pattern; a bound `open` needs nothing. */
		onOpenChange?: (open: boolean) => void;
		/** Read out; the body draws its own header. */
		title: string;
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
			{@render children()}
		</div>
	</aside>
{:else}
	<ResponsiveModal {open} onOpenChange={handle} {title} headed={false} fill>
		{@render children()}
	</ResponsiveModal>
{/if}
