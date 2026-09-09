<script lang="ts">
	// What somebody has chosen on the canvas, and the acts on it. Pinned to the
	// bottom, above the nav pill and the system bar under it.
	import CircleDashed from '@lucide/svelte/icons/circle-dashed';
	import Globe from '@lucide/svelte/icons/globe';
	import Tag from '@lucide/svelte/icons/tag';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { Button } from '$lib/components/ui/button/index.js';

	let {
		count,
		says = null,
		onTags,
		onLook,
		onPublish,
		onDelete,
		onDone
	}: {
		count: number;
		/** What the last act left to say — why it did not land, or what it did not
		 *  reach where the rest of it did. In the caller's words. */
		says?: string | null;
		onTags: () => void;
		onLook: () => void;
		onPublish?: (() => void) | undefined;
		onDelete: () => void;
		onDone: () => void;
	} = $props();

	const tally = $derived(
		count === 0
			? 'Pick the notes you mean'
			: `${count.toLocaleString()} ${count === 1 ? 'note chosen' : 'notes chosen'}`
	);

	const acts = $derived([
		{ label: 'Tags', icon: Tag, onSelect: onTags },
		{ label: 'Look', icon: CircleDashed, onSelect: onLook },
		...(onPublish ? [{ label: 'Publish', icon: Globe, onSelect: onPublish }] : []),
		{ label: 'Delete', icon: Trash2, onSelect: onDelete, destructive: true }
	]);

	let bar = $state<HTMLElement | null>(null);

	// The bar stands over surfaces that also scroll, so it owes the space it takes
	// as `--chosen-bar-inset-bottom` — DESIGN.md § "The four inset vars", which
	// also says the var is UNSET wherever the bar is down. Measured off the whole
	// box, so the acts row and a refusal line are both in it.
	$effect(() => {
		const root = document.documentElement;
		const drop = () => root.style.removeProperty('--chosen-bar-inset-bottom');
		const el = bar;
		if (!el) {
			drop();
			return;
		}
		const publish = () =>
			root.style.setProperty('--chosen-bar-inset-bottom', `${el.offsetHeight}px`);
		publish();
		const observer = new ResizeObserver(publish);
		observer.observe(el);
		return () => {
			observer.disconnect();
			drop();
		};
	});
</script>

<div
	bind:this={bar}
	class="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-3 pb-2"
	style="right: var(--reading-dock-inset-right, 0px); bottom: var(--sysnav-clearance)"
>
	<div
		class="pointer-events-auto w-full max-w-md rounded-2xl border bg-card/95 p-2 shadow-lg backdrop-blur"
	>
		<div class="flex items-center gap-2 px-2 {count > 0 ? 'pb-1' : ''}">
			<p class="min-w-0 flex-1 truncate text-sm" aria-live="polite">{tally}</p>
			<Button variant="ghost" class="h-9 shrink-0 rounded-full" onclick={onDone}>Done</Button>
		</div>

		{#if says}
			<p class="px-2 pb-2 text-sm text-destructive" role="alert">{says}</p>
		{/if}

		{#if count > 0}
			<div class="grid gap-1 {acts.length === 4 ? 'grid-cols-4' : 'grid-cols-3'}">
				{#each acts as act (act.label)}
					<Button
						variant="ghost"
						onclick={act.onSelect}
						class="h-14 flex-col gap-1 rounded-xl {act.destructive
							? 'text-destructive hover:text-destructive'
							: ''}"
					>
						<act.icon class="size-5" />
						<span class="text-xs leading-none">{act.label}</span>
					</Button>
				{/each}
			</div>
		{/if}
	</div>
</div>
