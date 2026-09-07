<script lang="ts" module>
	import type { OwnedRef } from '@sloppy/types';

	/** Where a note may be carried, as this sheet offers it. */
	export interface MoveTarget {
		ref: OwnedRef;
		address: string;
		title: string;
		/** The address the note takes under this one and alongside it, or the
		 *  words for why it cannot go here at all. */
		lands: { under: string; after: string } | { refused: string };
	}
</script>

<script lang="ts">
	// Carrying a note somewhere else in the graph it was written in, by naming
	// the note it is going to. PRODUCT.md § Design Principles 3.
	import Search from '@lucide/svelte/icons/search';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { scrollFade } from '$lib/scroll-fade.svelte.js';
	import ResponsiveModal from '../responsive-modal.svelte';

	let {
		open = $bindable(false),
		query,
		found,
		settled = false,
		refused = null,
		busy = false,
		onquery,
		onmove
	}: {
		open?: boolean;
		query: string;
		/** Best first; the caller decides how many are worth showing. */
		found: readonly MoveTarget[];
		/** Nothing more is coming, so an empty list means there is no such note. */
		settled?: boolean;
		/** Why the move did not land, in words to show. */
		refused?: string | null;
		/** The move is with the server, so the placements stop taking taps. */
		busy?: boolean;
		onquery: (words: string) => void;
		onmove: (to: { relation: 'under' | 'after'; note: OwnedRef }) => void;
	} = $props();

	let field = $state<HTMLInputElement | null>(null);
	let chosen = $state<MoveTarget | null>(null);

	$effect(() => {
		if (!open) chosen = null;
	});

	const lands = $derived(chosen && !('refused' in chosen.lands) ? chosen.lands : null);
	const nothing = $derived(settled && query.trim() !== '' && found.length === 0);

	const nameOf = (target: MoveTarget) => target.title || 'Untitled';
	const refusedHere = (target: MoveTarget) =>
		'refused' in target.lands ? target.lands.refused : null;
</script>

<ResponsiveModal
	bind:open
	title="Move this note"
	description="Everything under it goes too, and the address it has now keeps leading to it."
	onOpenAutoFocus={(event) => {
		event.preventDefault();
		field?.focus();
	}}
>
	<div class="space-y-3 px-2 pt-4 pb-2">
		{#if chosen && lands}
			{@const target = chosen}
			<p class="px-2 text-sm">
				<span class="address">{target.address}</span>
				<span class="text-muted-foreground">{nameOf(target)}</span>
			</p>

			<Button
				variant="outline"
				class="h-auto min-h-11 w-full flex-col items-start gap-0.5 py-2 text-left whitespace-normal"
				disabled={busy}
				onclick={() => onmove({ relation: 'under', note: target.ref })}
			>
				<span class="text-sm">Put it under {target.address}</span>
				<span class="text-xs font-normal text-muted-foreground">
					It becomes {lands.under}, or the next one free.
				</span>
			</Button>

			<Button
				variant="outline"
				class="h-auto min-h-11 w-full flex-col items-start gap-0.5 py-2 text-left whitespace-normal"
				disabled={busy}
				onclick={() => onmove({ relation: 'after', note: target.ref })}
			>
				<span class="text-sm">Put it beside {target.address}</span>
				<span class="text-xs font-normal text-muted-foreground">
					It becomes {lands.after}, or the next one free.
				</span>
			</Button>

			{#if refused}
				<p class="px-2 text-sm text-destructive" role="alert">{refused}</p>
			{/if}

			<Button variant="ghost" class="h-11 w-full" disabled={busy} onclick={() => (chosen = null)}>
				Choose another note
			</Button>
		{:else}
			<div class="relative">
				<Search
					class="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
					aria-hidden="true"
				/>
				<Input
					bind:ref={field}
					value={query}
					class="h-11 ps-9"
					autocapitalize="none"
					autocomplete="off"
					spellcheck="false"
					aria-label="Move it to a note, by title or address"
					placeholder="1a, or a title"
					oninput={(event) => onquery(event.currentTarget.value)}
				/>
			</div>

			{#if refused}
				<p class="px-2 text-sm text-destructive" role="alert">{refused}</p>
			{/if}

			{#if found.length > 0}
				<ul
					aria-label="Notes to move it to"
					class="max-h-64 space-y-0.5 overflow-y-auto scroll-fade-y"
					{@attach scrollFade('y')}
				>
					{#each found as target (target.ref)}
						{@const why = refusedHere(target)}
						<li>
							<button
								type="button"
								disabled={why !== null}
								onclick={() => (chosen = target)}
								class="flex min-h-11 w-full flex-col items-start gap-0.5 rounded-md px-2 py-2 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-60"
							>
								<span class="flex w-full min-w-0 items-baseline gap-3 text-sm">
									<span class="shrink-0 address text-muted-foreground">{target.address}</span>
									<span class="min-w-0 flex-1 truncate">{nameOf(target)}</span>
								</span>
								{#if why}
									<span class="text-xs text-muted-foreground">{why}</span>
								{/if}
							</button>
						</li>
					{/each}
				</ul>
			{:else if nothing}
				<p class="px-2 text-sm text-muted-foreground" role="status">
					Nothing in this graph matches that.
				</p>
			{/if}
		{/if}
	</div>
</ResponsiveModal>
