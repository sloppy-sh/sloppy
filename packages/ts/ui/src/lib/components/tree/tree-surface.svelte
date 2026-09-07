<script lang="ts" module>
	import type { OwnedRef, Tag } from '@sloppy/types';
	import type { TreeNote } from './walk.js';

	/** One tree. Several stand side by side where several graphs are being read:
	 *  an address is a place in the graph it was written in, so a run never
	 *  crosses from one to the next. */
	export interface TreeGroup {
		key: string;
		/** Drawn where there is more than one group, or where somebody else wrote
		 *  these notes. */
		title: string;
		notes: readonly TreeNote[];
		/** Whoever wrote them, where that is not the reader — named over the tree
		 *  and in the tree's own name, so a walk says whose graph it is in before
		 *  it reads a title. */
		author?: string;
	}

	export interface TreeSurfaceProps {
		groups: readonly TreeGroup[];
		/** A short run drawn at the head of one group's tree, in the order it is
		 *  given rather than in address order and with nothing under it. It names
		 *  the group it belongs to: an address is read inside the graph it was
		 *  written in, so a run never stands over the trees as one list. */
		lead?: readonly { group: string; title: string; notes: readonly TreeNote[] }[];
		/** The notes whose children are drawn. */
		opened: ReadonlySet<OwnedRef>;
		/** The reader's tags, in selection order — the order the hues go out in,
		 *  and which branches the walk opens of its own accord. */
		selection?: readonly Tag[];
		/** The note in front of the reader, which the tree marks and keeps in view. */
		reading?: OwnedRef | null;
		/** What the chrome over the surface covers at either edge. */
		inset?: { top: string; bottom: string };
		/** The notes picked out to act on — DESIGN.md § "The mark" calls this the
		 *  chosen set, and never a selection, because `selection` above is already
		 *  the reader's tags.
		 *
		 *  PRESENT is a tree somebody is choosing on, an empty set included: a row
		 *  then adds or removes rather than opening. Absent is the ordinary walk. */
		chosen?: ReadonlySet<OwnedRef>;
		/** Add or remove one note. Absent is a walk nothing can be chosen on. */
		onChoose?: (ref: OwnedRef) => void;
		/** Enter and leave choosing, from the tree's own control. Absent leaves the
		 *  mode to whatever else enters it. */
		onChoosing?: (on: boolean) => void;
		onToggle: (ref: OwnedRef, open: boolean) => void;
		onOpen: (ref: OwnedRef) => void;
		/** Writing a note under a row, from the row: `keys` spells the chord for
		 *  `aria-keyshortcuts` and `typed` matches it, so the row advertises and
		 *  answers the one the app binds for the same act elsewhere. Absent leaves
		 *  the walk a way to read these notes and no way to continue them. */
		writeUnder?: {
			keys: string;
			typed: (event: KeyboardEvent) => boolean;
			write: (ref: OwnedRef) => void;
		};
	}
</script>

<script lang="ts">
	// The graph walked rather than drawn: down into a note's children, along the
	// run to the note after it, and back up. The notes a note names are the
	// note's own to show, so neither a reference nor a hand-drawn link branches
	// here; DESIGN.md § Layout is why a plain tap replaces the note being read.
	import Check from '@lucide/svelte/icons/check';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import CornerDownRight from '@lucide/svelte/icons/corner-down-right';
	import Globe from '@lucide/svelte/icons/globe';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import { assignTagHueSlots } from '@sloppy/types';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { Button } from '$lib/components/ui/button/index.js';
	import { scrollFade } from '$lib/scroll-fade.svelte.js';
	import { RUN_PAGE, type TreeRow, walkTree } from './walk.js';

	let {
		groups,
		lead,
		opened,
		selection = [],
		reading = null,
		inset = { top: '0px', bottom: '0px' },
		chosen,
		onChoose,
		onChoosing,
		onToggle,
		onOpen,
		writeUnder
	}: TreeSurfaceProps = $props();

	const choosing = $derived(chosen !== undefined);

	/** The deepest a row is set in. Past it every generation sits at the same
	 *  offset: a phone has run out of room, and the address already says how far
	 *  down the note is. */
	const DEEPEST_INDENT = 8;

	/** How much of a run has been asked for, per group, keyed as `walk.ts` keys
	 *  it. A group holds its own, so two graphs cannot page each other. */
	const paged = new SvelteMap<string, SvelteMap<string, number>>();
	const EMPTY: ReadonlyMap<string, number> = new Map();

	/** Which row in each group carries the tab stop — ARIA's roving tabindex, so
	 *  one Tab reaches the tree and the arrows walk it. */
	const tabbed = new SvelteMap<string, string>();

	/** The branches the reader folded back up, so a selected tag stops opening
	 *  them. */
	const shut = new SvelteSet<OwnedRef>();
	let shutFor = '';
	$effect(() => {
		const now = selection.join('\n');
		if (now === shutFor) return;
		shutFor = now;
		shut.clear();
	});

	function toggle(ref: OwnedRef, open: boolean): void {
		if (open) shut.delete(ref);
		else shut.add(ref);
		onToggle(ref, open);
	}

	const slots = $derived(assignTagHueSlots(selection));

	const drawn = $derived(
		groups.flatMap((group) => {
			const head = lead?.find((one) => one.group === group.key);
			return [
				...(head && head.notes.length > 0
					? [
							{
								key: `lead:${group.key}`,
								title: head.title,
								author: group.author,
								lead: true,
								rows: leadRows(head.notes)
							}
						]
					: []),
				{
					key: group.key,
					title: group.title,
					author: group.author,
					lead: false,
					rows: walkTree({
						notes: group.notes,
						opened,
						shown: paged.get(group.key) ?? EMPTY,
						reading,
						selection,
						shut
					})
				}
			];
		})
	);

	function leadRows(notes: readonly TreeNote[]): TreeRow[] {
		return notes.map((note, at) => ({
			kind: 'note',
			note,
			depth: 0,
			children: 0,
			under: 0,
			open: false,
			at: at + 1,
			of: notes.length
		}));
	}

	/** The lead's rows key apart from the trees', so a note in both is one row in
	 *  each and the walk lands on the tree's rather than on the lead's. */
	const rowKey = (heads: boolean, row: TreeRow): string =>
		`${heads ? 'lead:' : ''}${row.kind === 'note' ? row.note.ref : `rest:${row.key}`}`;

	/** The tab stop: wherever focus was left, else the note being read, else the
	 *  first row — so arriving on the tree lands where the reader is. */
	function stop(key: string, heads: boolean, rows: readonly TreeRow[]): string {
		const held = tabbed.get(key);
		if (held !== undefined && rows.some((row) => rowKey(heads, row) === held)) return held;
		const here = rows.find((row) => row.kind === 'note' && row.note.ref === reading);
		if (reading && here) return rowKey(heads, here);
		return rows.length > 0 ? rowKey(heads, rows[0]) : '';
	}

	/** The selected tags a note carries, earliest-selected first: DESIGN.md § Hue
	 *  gives a note in several sets the first one's hue and no other. */
	function askedOf(note: TreeNote): Tag[] {
		return [...slots.keys()].filter((tag) => note.tags.includes(tag));
	}

	/** A note's tags as the row says them, the asked-about ones first so the hue
	 *  sits beside the tag it stands for. */
	function tagsOf(note: TreeNote, asked: readonly Tag[]): Tag[] {
		return [...asked, ...note.tags.filter((tag) => !asked.includes(tag))];
	}

	function reveal(group: string, row: Extract<TreeRow, { kind: 'rest' }>): void {
		const held = paged.get(group) ?? new SvelteMap<string, number>();
		held.set(row.key, row.drawn + RUN_PAGE);
		paged.set(group, held);
	}

	function act(group: string, row: TreeRow): void {
		if (row.kind === 'rest') reveal(group, row);
		else if (choosing && onChoose) onChoose(row.note.ref);
		else onOpen(row.note.ref);
	}

	function keys(event: KeyboardEvent, group: string, rows: readonly TreeRow[]): void {
		const item = event.currentTarget as HTMLElement;
		const tree = item.closest('[role="tree"]');
		if (!tree) return;
		const items = [...tree.querySelectorAll<HTMLElement>('[role="treeitem"]')];
		const here = items.indexOf(item);
		if (here < 0) return;
		const row = rows[here];
		// Enter held with a key goes past the tree, save for the one that writes.
		if (event.key === 'Enter' && (event.metaKey || event.ctrlKey || event.altKey)) {
			if (!writeUnder?.typed(event) || row.kind !== 'note') return;
			writeUnder.write(row.note.ref);
			event.preventDefault();
			return;
		}
		// The way in from a keyboard, as a tap is the way in from a phone: the
		// chord ARIA gives a tree several rows can be picked from.
		if (onChoose && event.key === ' ' && (event.metaKey || event.ctrlKey) && row.kind === 'note') {
			onChoose(row.note.ref);
			event.preventDefault();
			return;
		}
		const move = (to: number): void => {
			const next = items[Math.max(0, Math.min(items.length - 1, to))];
			if (!next) return;
			tabbed.set(group, next.dataset.row ?? '');
			next.focus();
		};
		switch (event.key) {
			case 'ArrowDown':
				move(here + 1);
				break;
			case 'ArrowUp':
				move(here - 1);
				break;
			case 'Home':
				move(0);
				break;
			case 'End':
				move(items.length - 1);
				break;
			case 'ArrowRight':
				if (row.kind === 'note' && row.children > 0 && !row.open) toggle(row.note.ref, true);
				else move(here + 1);
				break;
			case 'ArrowLeft':
				if (row.kind === 'note' && row.open) toggle(row.note.ref, false);
				else move(above(rows, here));
				break;
			case 'Enter':
			case ' ':
				act(group, row);
				break;
			default:
				return;
		}
		event.preventDefault();
	}

	/** The row this one hangs off, or itself where it hangs off nothing. */
	function above(rows: readonly TreeRow[], here: number): number {
		for (let at = here - 1; at >= 0; at--) {
			if (rows[at].depth < rows[here].depth) return at;
		}
		return here;
	}

	let scroller = $state<HTMLElement>();
	let landed: OwnedRef | null = null;

	/** The note being read, once there is a row for it. The branches above it
	 *  unfold after the note itself arrives, so the walk has to wait for them. */
	const landing = $derived(
		reading !== null &&
			drawn.some(
				(one) =>
					!one.lead && one.rows.some((row) => row.kind === 'note' && row.note.ref === reading)
			)
			? reading
			: null
	);

	// The note being read is where the reader is, so the tree goes to it — a note
	// opened from anywhere else lands the walk beside it rather than at the top.
	// Once per note, so a reader who has scrolled away is left where they are.
	$effect(() => {
		if (!landing || !scroller || landed === landing) return;
		landed = landing;
		scroller
			.querySelector<HTMLElement>(`[data-row="${CSS.escape(landing)}"]`)
			?.scrollIntoView?.({ block: 'nearest' });
	});
</script>

<div
	bind:this={scroller}
	class="size-full overflow-y-auto overscroll-contain scroll-fade-y [--scroll-fade:1rem] [--tree-step:0.625rem] sm:[--tree-step:1rem]"
	style="padding-top: {inset.top}; padding-bottom: {inset.bottom}; scroll-padding-top: {inset.top}; scroll-padding-bottom: {inset.bottom}"
	{@attach scrollFade('y')}
>
	<div class="mx-auto w-full max-w-4xl px-2 pb-4 sm:px-6">
		{#if onChoosing}
			<div class="flex justify-end pt-2">
				<Button
					variant="ghost"
					class="h-9 gap-1.5 rounded-full text-xs"
					onclick={() => onChoosing?.(!choosing)}
				>
					{#if choosing}
						<Check class="size-4" />
						Done choosing
					{:else}
						<ListChecks class="size-4" />
						Choose notes
					{/if}
				</Button>
			</div>
		{/if}

		{#each drawn as { key: group, title, author, lead: heads, rows } (group)}
			{#if rows.length > 0}
				{@const held = stop(group, heads, rows)}
				{@const by = author ? `${title || 'Notes'} by ${author}` : null}
				<section class="pt-2">
					{#if by || heads || groups.length > 1}
						<!-- Stuck below the chrome the tree is inset off, not under it. -->
						<h2
							class="sticky z-10 truncate bg-background/95 py-2 text-xs font-medium text-muted-foreground backdrop-blur"
							style="top: {inset.top}"
						>
							{by ?? (title || 'Untitled')}
						</h2>
					{/if}

					<div
						role="tree"
						aria-label={by ?? (title || 'Notes')}
						aria-multiselectable={choosing ? true : undefined}
					>
						{#each rows as row (rowKey(heads, row))}
							{@const key = rowKey(heads, row)}
							{@const step = `calc(${Math.min(row.depth, DEEPEST_INDENT)} * var(--tree-step))`}
							{#if row.kind === 'note'}
								{@const asked = askedOf(row.note)}
								{@const listed = tagsOf(row.note, asked)}
								<div
									role="treeitem"
									data-row={key}
									tabindex={key === held ? 0 : -1}
									aria-level={row.depth + 1}
									aria-posinset={row.at}
									aria-setsize={row.of}
									aria-expanded={row.children > 0 ? row.open : undefined}
									aria-selected={row.note.ref === reading}
									aria-checked={chosen ? chosen.has(row.note.ref) : undefined}
									aria-keyshortcuts={onChoose ? 'Control+Space Meta+Space' : undefined}
									onclick={() => act(group, row)}
									onkeydown={(event) => keys(event, group, rows)}
									onfocusin={() => tabbed.set(group, key)}
									class="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg pe-2 text-start hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-selected:bg-muted {selection.length >
										0 && asked.length === 0
										? 'opacity-45'
										: ''}"
									style="padding-inline-start: {step}"
								>
									{#if row.children > 0}
										<button
											type="button"
											tabindex="-1"
											aria-label={row.open
												? `Fold ${row.note.address}`
												: `Unfold ${row.note.address}`}
											onclick={(event) => {
												event.stopPropagation();
												toggle(row.note.ref, !row.open);
											}}
											class="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
										>
											<ChevronRight
												class="size-4 transition-transform motion-reduce:transition-none {row.open
													? 'rotate-90'
													: ''}"
											/>
										</button>
									{:else}
										<span class="size-11 shrink-0" aria-hidden="true"></span>
									{/if}

									<span class="shrink-0 address text-xs text-muted-foreground">
										{row.note.address}
									</span>
									<span class="min-w-0 flex-1 truncate text-sm">
										{row.note.title || 'Untitled'}
									</span>

									{#if listed.length > 0}
										<span
											class="flex max-w-[45%] min-w-0 shrink items-center gap-1.5 text-xs text-muted-foreground"
										>
											{#if asked.length > 0}
												<span
													class="size-2 shrink-0 rounded-full"
													style="background-color: var(--facet-{slots.get(asked[0])})"
													aria-hidden="true"
												></span>
											{/if}
											<span class="truncate">{listed.join(', ')}</span>
										</span>
									{/if}

									{#if row.note.published}
										<span class="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
											<Globe class="size-3" aria-hidden="true" />
											Published
										</span>
									{/if}

									{#if chosen?.has(row.note.ref)}
										<span
											class="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
											aria-hidden="true"
										>
											<Check class="size-3" />
											Chosen
										</span>
									{/if}

									{#if row.under > 0}
										<span
											class="shrink-0 text-xs text-muted-foreground tabular-nums"
											aria-hidden="true"
										>
											{row.under.toLocaleString()}
										</span>
										<span class="sr-only">
											{`${row.under.toLocaleString()} ${row.under === 1 ? 'note' : 'notes'} under this`}
										</span>
									{/if}

									{#if writeUnder}
										<button
											type="button"
											tabindex="-1"
											aria-label="Write a note under {row.note.address}"
											aria-keyshortcuts={writeUnder.keys}
											onclick={(event) => {
												event.stopPropagation();
												writeUnder?.write(row.note.ref);
											}}
											class="-me-1 flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
										>
											<CornerDownRight class="size-4" />
										</button>
									{/if}
								</div>
							{:else}
								<div
									role="treeitem"
									data-row={key}
									tabindex={key === held ? 0 : -1}
									aria-level={row.depth + 1}
									aria-selected={false}
									onclick={() => reveal(group, row)}
									onkeydown={(event) => keys(event, group, rows)}
									onfocusin={() => tabbed.set(group, key)}
									class="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg pe-2 text-sm text-muted-foreground hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
									style="padding-inline-start: {step}"
								>
									<span class="size-11 shrink-0" aria-hidden="true"></span>
									<span class="min-w-0 truncate">
										{row.rest.toLocaleString()} more{row.parent
											? ` under ${row.parent}`
											: ''}{row.lit > 0 ? `, ${row.lit.toLocaleString()} lit up` : ''}
									</span>
								</div>
							{/if}
						{/each}
					</div>
				</section>
			{/if}
		{/each}
	</div>
</div>
