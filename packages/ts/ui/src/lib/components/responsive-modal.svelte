<script lang="ts">
	// The one modal — DESIGN.md § Layout. A bottom sheet on a phone, a centered
	// dialog from 640px, driven by a single bound `open` so no caller branches.
	import type { Snippet } from 'svelte';
	import { onDestroy, untrack } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { cn } from '$lib/utils.js';
	import * as Dialog from './ui/dialog/index.js';
	import * as Sheet from './ui/sheet/index.js';
	import { overlay } from './overlay.svelte.js';

	let {
		open = $bindable(false),
		onOpenChange,
		title,
		description,
		headed = true,
		class: className,
		children
	}: {
		open?: boolean;
		/** For the unbound `open={expr}` pattern; a bound `open` needs nothing. */
		onOpenChange?: (open: boolean) => void;
		/** Shown unless {@link headed} is false, and read out either way. */
		title: string;
		description?: string;
		/** False where the body draws its own header. */
		headed?: boolean;
		/** Extra classes for the sheet / dialog surface. */
		class?: string;
		children: Snippet;
	} = $props();

	// Latched for this component's life: the branch must not move under a mounted
	// sheet, which would tear the surface down mid-edit. `untrack` is a no-op here
	// at init and keeps the latch if this is ever read somewhere that tracks.
	const viewport = new MediaQuery('(max-width: 639px)');
	const asSheet = untrack(() => viewport.current);

	const handle = (v: boolean) => {
		open = v;
		onOpenChange?.(v);
	};

	$effect(() => {
		if (!open) return;
		// untrack: push() reads the count it also writes, and would re-run forever.
		return untrack(() => overlay.push());
	});

	// Drag-to-dismiss, on the grabber alone so the body still scrolls.
	const DRAG_DISMISS_PX = 110;
	let dragY = $state(0);
	let dragging = $state(false);
	let startY = 0;
	let dismissTimer: ReturnType<typeof setTimeout> | undefined;

	const dragStyle = $derived(
		dragging
			? `transform: translateY(${dragY}px); transition: none`
			: dragY > 0
				? `transform: translateY(${dragY}px)`
				: undefined
	);

	function onGrabStart(e: PointerEvent) {
		dragging = true;
		startY = e.clientY;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function onGrabMove(e: PointerEvent) {
		if (dragging) dragY = Math.max(0, e.clientY - startY);
	}
	function onGrabEnd() {
		if (!dragging) return;
		dragging = false;
		if (dragY > DRAG_DISMISS_PX) {
			dragY = window.innerHeight;
			dismissTimer = setTimeout(() => handle(false), 200);
		} else {
			dragY = 0;
		}
	}

	$effect(() => {
		if (open) dragY = 0;
	});

	onDestroy(() => clearTimeout(dismissTimer));
</script>

{#if asSheet}
	<Sheet.Root {open} onOpenChange={handle}>
		<Sheet.Content
			side="bottom"
			showCloseButton={false}
			style={dragStyle}
			class={cn(
				// No `clear-sysnav`: the pill is hidden while this is up, so there is
				// nothing of it to clear.
				'flex max-h-[calc(100dvh-env(safe-area-inset-top)-1rem)] flex-col gap-0 overflow-x-hidden overflow-y-auto overscroll-contain rounded-t-2xl pt-1 pr-[max(0.75rem,env(safe-area-inset-right))] pb-[calc(var(--safe-area-inset-bottom,env(safe-area-inset-bottom))+1rem)] pl-[max(0.75rem,env(safe-area-inset-left))]',
				className
			)}
		>
			<!-- Sticky and opaque so a tall body cannot scroll the drag affordance
			     away; pointer capture keeps tracking once the body has scrolled. -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				data-slot="modal-grabber"
				class="sticky top-0 z-10 flex shrink-0 cursor-grab touch-none justify-center bg-popover pt-1 pb-2.5"
				onpointerdown={onGrabStart}
				onpointermove={onGrabMove}
				onpointerup={onGrabEnd}
				onpointercancel={onGrabEnd}
			>
				<div class="h-1 w-9 rounded-full bg-muted-foreground/30"></div>
			</div>
			{#if headed}
				<Sheet.Header class="shrink-0 gap-1 px-2 text-left">
					<Sheet.Title>{title}</Sheet.Title>
					{#if description}<Sheet.Description>{description}</Sheet.Description>{/if}
				</Sheet.Header>
			{:else}
				<Sheet.Title class="sr-only">{title}</Sheet.Title>
				{#if description}<Sheet.Description class="sr-only">{description}</Sheet.Description>{/if}
			{/if}
			{@render children()}
		</Sheet.Content>
	</Sheet.Root>
{:else}
	<Dialog.Root {open} onOpenChange={handle}>
		<Dialog.Content
			class={cn(
				'flex max-h-[85vh] flex-col gap-4 overflow-x-hidden overflow-y-auto sm:max-w-lg',
				className
			)}
		>
			{#if headed}
				<!-- The close button overlaps the content box's end edge; the gutter
				     wraps a long title beside it rather than under it. -->
				<Dialog.Header class="pr-6">
					<Dialog.Title>{title}</Dialog.Title>
					{#if description}<Dialog.Description>{description}</Dialog.Description>{/if}
				</Dialog.Header>
			{:else}
				<Dialog.Title class="sr-only">{title}</Dialog.Title>
				{#if description}<Dialog.Description class="sr-only">{description}</Dialog.Description>{/if}
			{/if}
			{@render children()}
		</Dialog.Content>
	</Dialog.Root>
{/if}
