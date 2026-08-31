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
	import { overlay } from './overlay.svelte.js';

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

	// Declared like a modal though it is beside the graph rather than over it:
	// the nav pill is `fixed` and would float across the panel's foot.
	$effect(() => {
		if (!docked || !open) return;
		// untrack: push() reads the count it also writes, and would re-run forever.
		return untrack(() => overlay.push());
	});

	$effect(() => {
		if (docked && open) panel?.focus();
	});

	// Docked means beside, so the panel owes the width it takes to whatever it is
	// beside — which would otherwise go on drawing its own chrome underneath.
	$effect(() => {
		const root = document.documentElement;
		const drop = () => root.style.removeProperty('--reading-dock-inset-right');
		const el = panel;
		if (!docked || !open || !el) {
			drop();
			return;
		}
		const publish = () =>
			root.style.setProperty('--reading-dock-inset-right', `${el.offsetWidth}px`);
		publish();
		const observer = new ResizeObserver(publish);
		observer.observe(el);
		return () => {
			observer.disconnect();
			drop();
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
