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
	// One field for going back to a note — its number, its title, or the words
	// inside it — and for doing something by its name, with every act and its
	// keystroke listed while nothing is typed. PRODUCT.md § Design Principles 3;
	// DESIGN.md § Layout.
	import Search from '@lucide/svelte/icons/search';
	import { untrack } from 'svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { scrollFade } from '$lib/scroll-fade.svelte.js';
	import ResponsiveModal from '../responsive-modal.svelte';
	import { headingAt, type PaletteAct, type PaletteRow, rowsFor } from './palette-rows.js';

	let {
		open = $bindable(false),
		inline = false,
		query,
		found,
		acts = [],
		looking = false,
		settled = false,
		elsewhere = false,
		unreadable = null,
		exact = null,
		onquery,
		onopen,
		onrun
	}: {
		open?: boolean;
		/** What the field opens on. While the surface is up the field's contents
		 *  are its own; a later answer for it is read, not written back. */
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
		/** What the page can do, in the order it is offered; empty is a field
		 *  that only finds notes. */
		acts?: readonly PaletteAct[];
		onquery: (words: string) => void;
		onopen: (ref: OwnedRef) => void;
		onrun?: (id: string) => void;
		/** Standing in a column beside the graph rather than over it: no surface
		 *  of its own, and nothing it opens takes the page away. */
		inline?: boolean;
	} = $props();

	let field = $state<HTMLInputElement | null>(null);
	/** What has been typed. The caller answers for it on its own clock, so a draw
	 *  carrying the words as they were a moment ago would take back everything
	 *  typed since — the field keeps its own. */
	let words = $state(untrack(() => query));

	$effect(() => {
		if (open) untrack(() => (words = query));
	});

	/** Inline, nothing is offered until something is typed: the column it stands
	 *  in already shows its own acts as rows, and would list them twice. */
	const rows = $derived(inline && words.trim() === '' ? [] : rowsFor(words, acts, found, exact));
	/** Which row the arrow keys have reached; none is the field's own Enter. */
	let active = $state<number | null>(null);
	$effect(() => {
		void rows;
		active = null;
	});
	const groups = $derived(words.trim() === '' ? [...new Set(acts.map((act) => act.group))] : []);

	function take(row: PaletteRow): void {
		if (row.kind === 'note') onopen(row.note.ref);
		else if (row.kind === 'act') onrun?.(row.act.id);
	}

	/** The rows the arrows stop on, as indices into `rows`: one that does nothing
	 *  is read past rather than landed on. */
	const stops = $derived(rows.flatMap((row, at) => (row.kind === 'line' ? [] : [at])));

	function onKeys(event: KeyboardEvent): void {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			if (stops.length === 0) return;
			event.preventDefault();
			const step = event.key === 'ArrowDown' ? 1 : -1;
			const was = active === null ? -1 : stops.indexOf(active);
			const to =
				was < 0 ? (step === 1 ? 0 : stops.length - 1) : (was + step + stops.length) % stops.length;
			active = stops[to];
			document.getElementById(rowId(active))?.scrollIntoView({ block: 'nearest' });
			return;
		}
		if (event.key !== 'Enter') return;
		event.preventDefault();
		if (active !== null && rows[active]) take(rows[active]);
		else if (exact) onopen(exact);
		else if (words.trim() !== '' && stops.length === 1) take(rows[stops[0]]);
	}

	function rowId(at: number): string {
		return `palette-row-${at}`;
	}

	/** A row that does nothing is not an answer to what was typed. */
	const nothing = $derived(settled && !looking && found.length === 0 && stops.length === 0);
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

{#snippet body()}
	<div class={inline ? 'flex flex-col gap-1.5' : 'space-y-3 px-2 pt-4 pb-2'}>
		<div class="relative">
			<Search
				class="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
				aria-hidden="true"
			/>
			<Input
				bind:ref={field}
				value={words}
				class="h-control ps-9"
				autocomplete="off"
				role="combobox"
				aria-expanded={rows.length > 0}
				aria-controls="palette-rows"
				aria-activedescendant={active === null ? undefined : rowId(active)}
				aria-label={acts.length === 0
					? 'Find a note by its number, its title or a word in it'
					: 'Find a note by its number, its title or a word in it, or something to do by its name'}
				placeholder={inline
					? 'Find a note, or do something'
					: acts.length === 0
						? '1a3, or a word you wrote'
						: '1a3, a word you wrote, or what to do'}
				oninput={(event) => {
					words = event.currentTarget.value;
					onquery(words);
				}}
				onkeydown={onKeys}
			/>
		</div>

		{#if unreadable}
			<p class="text-sm text-destructive" role="alert">{unreadable}</p>
		{/if}

		{#if rows.length > 0}
			{#if found.length > 0}<p class="sr-only" role="status">{showing}</p>{/if}
			<ul
				id="palette-rows"
				role="listbox"
				aria-label={words.trim() === '' ? 'What you can do here' : 'What matches'}
				class="space-y-0.5 overflow-y-auto scroll-fade-y [--scroll-fade:1rem] {inline
					? 'max-h-[min(20rem,35vh)]'
					: 'max-h-[40vh]'}"
				{@attach scrollFade('y')}
			>
				{#each rows as row, at (row.key)}
					{@const heading = groups.length > 1 ? headingAt(rows, at) : undefined}
					{#if heading}
						<li
							role="presentation"
							class="px-2 pt-2 pb-0.5 text-xs text-muted-foreground first:pt-0"
						>
							{heading}
						</li>
					{/if}
					{#if row.kind === 'line'}
						<li role="presentation" class="px-2 py-2 text-sm text-muted-foreground">{row.text}</li>
					{:else}
						<li
							id={rowId(at)}
							role="option"
							aria-selected={active === at}
							class="rounded-md {active === at ? 'bg-muted' : ''}"
						>
							{#if row.kind === 'note'}
								{@const note = row.note}
								<button
									type="button"
									tabindex="-1"
									class="flex min-h-control w-full flex-col items-start gap-0.5 rounded-md px-2 py-2 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
									onclick={() => onopen(note.ref)}
								>
									<span class="flex w-full min-w-0 items-baseline gap-2 text-sm">
										{#if note.address}<span class="shrink-0 address text-xs">{note.address}</span
											>{/if}
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
							{:else}
								{@const act = row.act}
								<button
									type="button"
									tabindex="-1"
									class="flex min-h-control w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
									onclick={() => onrun?.(act.id)}
								>
									<span class="min-w-0 flex-1 truncate">{act.label}</span>
									{#if act.says}
										<kbd class="shrink-0 font-sans text-xs text-muted-foreground">{act.says}</kbd>
									{/if}
								</button>
							{/if}
						</li>
					{/if}
				{/each}
			</ul>
		{:else if looking}
			<div class="space-y-2 px-2 py-1" aria-hidden="true">
				<Skeleton class="h-4 w-2/3" />
				<Skeleton class="h-4 w-1/2" />
			</div>
		{/if}

		{#if nothing}
			<p class="px-2 text-sm text-muted-foreground" role="status">{noMatch}</p>
		{/if}
	</div>
{/snippet}

{#if inline}
	<div class="flex flex-col">{@render body()}</div>
{:else}
	<ResponsiveModal
		bind:open
		title={acts.length === 0 ? 'Find a note' : 'Find a note, or do something'}
		description={acts.length === 0
			? 'By its number, its title, or a word in it.'
			: 'By its number, its title, a word in it — or the name of something to do.'}
		onOpenAutoFocus={(event) => {
			event.preventDefault();
			field?.focus();
		}}
	>
		{@render body()}
	</ResponsiveModal>
{/if}
