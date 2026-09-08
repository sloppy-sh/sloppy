<script lang="ts" module>
	import type { OwnedRef } from '@sloppy/types';

	/** One note the words reached, as the list offers it. */
	export interface FoundNote {
		ref: OwnedRef;
		/** Absent on a note its author gave none; the title names it. */
		address?: string;
		title: string;
		/** What the graph this address is read in is called, or null where naming
		 *  it would tell the reader nothing. */
		graph: string | null;
		/** An address this note has been carried away from that the typed number
		 *  reached, absent where its own address or its title is what matched. */
		wasAt?: string;
		/** The writing around what matched, already cut to length. Empty where the
		 *  number or the title matched on its own. */
		snippet: string;
		/** A copy of somebody else's note rather than one of the reader's own. */
		held: boolean;
	}
</script>

<script lang="ts">
	// One field for going back to a note: its number, its title, or the words
	// inside it. PRODUCT.md § Design Principles 3 — the address is what a person
	// navigates by, so it is what they may type.
	import Search from '@lucide/svelte/icons/search';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { scrollFade } from '$lib/scroll-fade.svelte.js';
	import ResponsiveModal from '../responsive-modal.svelte';

	let {
		open = $bindable(false),
		query,
		found,
		looking = false,
		settled = false,
		elsewhere = false,
		unreadable = null,
		exact = null,
		onquery,
		onopen
	}: {
		open?: boolean;
		query: string;
		/** Best first; the caller decides how many are worth showing. */
		found: readonly FoundNote[];
		/** More is still to come for what has been typed. */
		looking?: boolean;
		/** Nothing more is coming, so an empty list means there is no such note. */
		settled?: boolean;
		/** The reader keeps a graph that is not on the canvas, so there is
		 *  somewhere else left to look. */
		elsewhere?: boolean;
		/** Why part of what was asked for could not be read, in words to show. */
		unreadable?: string | null;
		/** The one note the typed address resolves to; Enter goes straight there. */
		exact?: OwnedRef | null;
		onquery: (words: string) => void;
		onopen: (ref: OwnedRef) => void;
	} = $props();

	let field = $state<HTMLInputElement | null>(null);

	const nothing = $derived(settled && !looking && found.length === 0);
	const showing = $derived(
		found.length === 1 ? 'Showing 1 note.' : `Showing ${found.length} notes.`
	);
	const noMatch = $derived(
		elsewhere
			? 'Nothing on the canvas matches that. Show another graph to look in it too.'
			: 'Nothing on the canvas matches that.'
	);

	function nameOf(note: FoundNote): string {
		return note.title || 'Untitled';
	}

	function beneath(note: FoundNote): string {
		return [note.graph, note.held ? "Somebody else's" : null].filter(Boolean).join(' · ');
	}
</script>

<ResponsiveModal
	bind:open
	title="Find a note"
	description="By its number, its title, or a word in it."
	onOpenAutoFocus={(event) => {
		event.preventDefault();
		field?.focus();
	}}
>
	<div class="space-y-3 px-2 pt-4 pb-2">
		<div class="relative">
			<Search
				class="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
				aria-hidden="true"
			/>
			<Input
				bind:ref={field}
				value={query}
				class="h-11 ps-9"
				autocomplete="off"
				aria-label="Find a note by its number, its title or a word in it"
				placeholder="1a3, or a word you wrote"
				oninput={(event) => onquery(event.currentTarget.value)}
				onkeydown={(event) => {
					if (event.key !== 'Enter') return;
					event.preventDefault();
					if (exact) onopen(exact);
				}}
			/>
		</div>

		{#if unreadable}
			<p class="text-sm text-destructive" role="alert">{unreadable}</p>
		{/if}

		{#if found.length > 0}
			<p class="sr-only" role="status">{showing}</p>
			<ul
				class="max-h-[40vh] space-y-0.5 overflow-y-auto scroll-fade-y [--scroll-fade:1rem]"
				{@attach scrollFade('y')}
			>
				{#each found as note (note.ref)}
					<li>
						<button
							type="button"
							class="flex min-h-11 w-full flex-col items-start gap-0.5 rounded-md px-2 py-2 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
							onclick={() => onopen(note.ref)}
						>
							<span class="flex w-full min-w-0 items-baseline gap-2 text-sm">
								{#if note.address}<span class="shrink-0 address text-xs">{note.address}</span>{/if}
								<span class="min-w-0 flex-1 truncate">{nameOf(note)}</span>
							</span>
							{#if note.wasAt}
								<span class="text-xs text-muted-foreground"
									>Was at <span class="address">{note.wasAt}</span></span
								>
							{/if}
							{#if note.snippet}
								<span class="line-clamp-2 text-xs text-muted-foreground">{note.snippet}</span>
							{/if}
							{#if beneath(note)}
								<span class="text-xs text-muted-foreground">{beneath(note)}</span>
							{/if}
						</button>
					</li>
				{/each}
			</ul>
		{:else if looking}
			<div class="space-y-2 px-2 py-1" aria-hidden="true">
				<Skeleton class="h-4 w-2/3" />
				<Skeleton class="h-4 w-1/2" />
			</div>
		{:else if nothing}
			<p class="px-2 text-sm text-muted-foreground" role="status">{noMatch}</p>
		{/if}
	</div>
</ResponsiveModal>
