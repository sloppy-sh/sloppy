<script lang="ts" module>
	import type { NoteDestination, OwnedRef, Tag } from '@sloppy/types';
	import type { OutlineSections } from './sections.js';
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
		/** The notes picked out to act on — DESIGN.md § "The mark". PRESENT is a
		 *  tree somebody is choosing on, an empty set included: a row then adds or
		 *  removes rather than opening. Absent is the ordinary walk. */
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
			/** Writing a note after a row instead, which the same control offers
			 *  when it is dragged level with a row rather than past it. Absent
			 *  leaves the control a tap and the accelerator. */
			beside?: (ref: OwnedRef) => void;
		};
		/** A note's sections, drawn under its row where the reader has asked for
		 *  them and arranged there by their handles. Absent leaves the walk the
		 *  notes alone, which is what a region pulled from somebody else is. */
		sections?: OutlineSections;
		/** Carrying a note itself to another run, from its address. Absent leaves
		 *  every note where it is, which is what a region pulled from somebody
		 *  else is. */
		moveNote?: {
			move: (ref: OwnedRef, to: NoteDestination) => void;
			/** Why the last note asked for did not go; empty says nothing. */
			refused?: string;
		};
	}
</script>

<script lang="ts">
	// The graph walked rather than drawn: down into a note's children, along the
	// run to the note after it, and back up. The notes a note names are the
	// note's own to show, so neither a reference nor a hand-drawn link branches
	// here; DESIGN.md § Layout is why a plain tap replaces the note being read.
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import Check from '@lucide/svelte/icons/check';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import CornerDownRight from '@lucide/svelte/icons/corner-down-right';
	import Globe from '@lucide/svelte/icons/globe';
	import GripVertical from '@lucide/svelte/icons/grip-vertical';
	import List from '@lucide/svelte/icons/list';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import { type Address, assignTagHueSlots } from '@sloppy/types';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { Button } from '$lib/components/ui/button/index.js';
	import { scrollFade } from '$lib/scroll-fade.svelte.js';
	import {
		aimSection,
		landingAt,
		landingBy,
		type OutlineRow,
		type SectionAim,
		type SectionBand,
		sectionSays,
		withSections
	} from './sections.js';
	import {
		aimAt,
		aimSays,
		dragFrom,
		type MoveLanding,
		movesTo,
		runFor,
		type TreeAim,
		type TreeBox
	} from './tree-drag.js';
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
		writeUnder,
		sections,
		moveNote
	}: TreeSurfaceProps = $props();

	const choosing = $derived(chosen !== undefined);

	/** How tall the control band over the run stands, so the group headings stick
	 *  below it rather than under it. */
	let band = $state(0);

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
					rows: rowsWithSections(
						walkTree({
							notes: group.notes,
							opened,
							shown: paged.get(group.key) ?? EMPTY,
							reading,
							selection,
							shut
						})
					)
				}
			];
		})
	);

	/** The lead is the same notes drawn a second time, so its rows stay notes: a
	 *  stack shown in both places would be one stack with two handles on it. */
	function rowsWithSections(rows: TreeRow[]): OutlineRow[] {
		return sections ? withSections(rows, sections) : rows;
	}

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
	const rowKey = (heads: boolean, row: OutlineRow): string => {
		const held =
			row.kind === 'note'
				? row.note.ref
				: row.kind === 'section'
					? `section:${row.section.ref}`
					: row.kind === 'says'
						? `says:${row.note}`
						: `rest:${row.key}`;
		return `${heads ? 'lead:' : ''}${held}`;
	};

	/** The tab stop: wherever focus was left, else the note being read, else the
	 *  first row — so arriving on the tree lands where the reader is. */
	function stop(key: string, heads: boolean, rows: readonly OutlineRow[]): string {
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

	/** The click a drag ends with is the drag ending, not a tap. A finger's drag
	 *  may send none at all, so the next press in the tree clears it too. */
	let dragged = false;

	function act(group: string, row: OutlineRow): void {
		if (dragged) {
			dragged = false;
			return;
		}
		if (row.kind === 'rest') {
			reveal(group, row);
			return;
		}
		if (row.kind === 'says') {
			if (row.again) sections?.onShow(row.note, true);
			return;
		}
		const note = row.kind === 'section' ? row.note : row.note.ref;
		if (choosing && onChoose) onChoose(note);
		else onOpen(note);
	}

	const showing = (ref: OwnedRef): boolean => sections?.shown.has(ref) ?? false;

	/** What a note row advertises for `aria-keyshortcuts`. */
	const chords = (tree: boolean): string =>
		[
			onChoose ? 'Control+Space' : '',
			sections && tree ? 'Alt+ArrowRight Alt+ArrowLeft' : '',
			moveNote && tree ? 'Alt+Shift+ArrowRight Alt+Shift+ArrowUp' : ''
		]
			.filter((one) => one !== '')
			.join(' ');

	/** One section a place up or down its note's stack. */
	function arrange(row: Extract<OutlineRow, { kind: 'section' }>, by: number): void {
		const stack = sections?.of(row.note);
		if (!stack) return;
		const landing = landingBy(stack, row.section.ref, by);
		if (landing) sections?.onMove(row.note, row.section.ref, landing.after);
	}

	function keys(
		event: KeyboardEvent,
		group: string,
		rows: readonly OutlineRow[],
		heads: boolean
	): void {
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
		// The same modifier with Shift carries the row itself, which is the drag a
		// keyboard makes: under the note above it, or into that note's own run.
		if (
			moveNote &&
			!heads &&
			row.kind === 'note' &&
			event.altKey &&
			event.shiftKey &&
			(event.key === 'ArrowRight' || event.key === 'ArrowUp')
		) {
			nudgeNote(group, rows, here, row.note, event.key === 'ArrowRight' ? 'under' : 'after');
			event.preventDefault();
			return;
		}
		// The sections chord: held, the arrows act on a note's sections instead of
		// walking the rows, so the plain ones stay the walk they already were.
		if (event.altKey && !event.shiftKey && sections) {
			if (row.kind === 'section' && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
				arrange(row, event.key === 'ArrowUp' ? -1 : 1);
				event.preventDefault();
				return;
			}
			if (
				row.kind === 'note' &&
				!heads &&
				(event.key === 'ArrowRight' || event.key === 'ArrowLeft')
			) {
				sections.onShow(row.note.ref, event.key === 'ArrowRight');
				event.preventDefault();
				return;
			}
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
	function above(rows: readonly OutlineRow[], here: number): number {
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

	/** A note being carried to where it will be written — `tree-drag.ts`. */
	let carrying = $state<{ at: { x: number; y: number }; aim: TreeAim | null } | null>(null);

	const NO_REFS: ReadonlySet<OwnedRef> = new Set();

	/** The rows a drop can land on: the trees, never the lead, whose order is
	 *  what was last written rather than the run a new note would join. */
	function boxes(): TreeBox[] {
		if (!scroller) return [];
		const out: TreeBox[] = [];
		for (const group of drawn) {
			if (group.lead) continue;
			const tree = scroller.querySelector(`[data-tree="${CSS.escape(group.key)}"]`);
			if (!tree) continue;
			const items = [...tree.querySelectorAll<HTMLElement>('[role="treeitem"]')];
			for (const [at, item] of items.entries()) {
				const row = group.rows[at];
				if (!row) continue;
				const box = item.getBoundingClientRect();
				if (row.kind === 'section' || row.kind === 'says') {
					const above = out[out.length - 1];
					if (above?.on === row.note) above.bottom = box.bottom;
					continue;
				}
				if (row.kind !== 'note') continue;
				const words = item.querySelector('.address')?.getBoundingClientRect();
				out.push({
					on: row.note.ref,
					address: row.note.address,
					title: row.note.title,
					top: box.top,
					bottom: box.bottom,
					left: words?.left ?? box.left
				});
			}
		}
		return out;
	}

	function carry(event: PointerEvent): void {
		dragged = false;
		if (!writeUnder?.beside) return;
		dragFrom<TreeAim>(event, {
			aim: (x, y) => aimAt(boxes(), x, y),
			scroller: () => scroller ?? null,
			moved: (at, aim) => (carrying = { at, aim }),
			dropped: (aim) => {
				carrying = null;
				dragged = true;
				if (!aim) return;
				if (aim.relation === 'under') writeUnder?.write(aim.on);
				else writeUnder?.beside?.(aim.on);
			}
		});
	}

	/** A note being carried to the run it will join — `tree-drag.ts`. */
	let lifting = $state<{
		at: { x: number; y: number };
		note: TreeNote;
		landing: MoveLanding;
	} | null>(null);

	/** A note let go of, and the address it was at, until the walk draws it at
	 *  the one the server gave it. */
	let settling = $state<{ note: OwnedRef; was: Address } | null>(null);

	/** What the last act on a row did, where no drag is saying anything. */
	let told = $state('');

	/** One group's rows as a move reads them, its notes' sections left out: a
	 *  section belongs to the note above it. */
	function treeRows(group: string): TreeRow[] {
		const rows = drawn.find((one) => one.key === group)?.rows ?? [];
		return rows.filter((row): row is TreeRow => row.kind === 'note' || row.kind === 'rest');
	}

	/** Whether the press landed on the row's address, which is its grip. */
	const onAddress = (event: PointerEvent): boolean =>
		event.target instanceof Element && event.target.closest('.address') !== null;

	function liftNote(event: PointerEvent, group: string, note: TreeNote): void {
		dragged = false;
		if (!moveNote) return;
		settling = null;
		told = '';
		const reading = (aim: TreeAim | null): MoveLanding => movesTo(treeRows(group), note, aim);
		dragFrom<TreeAim>(event, {
			aim: (x, y) => aimAt(boxes(), x, y),
			scroller: () => scroller ?? null,
			moved: (at, aim) => (lifting = { at, note, landing: reading(aim) }),
			dropped: (aim) => {
				const landing = reading(aim);
				lifting = null;
				dragged = true;
				carryTo(note, landing);
			}
		});
	}

	/** A note let go where it can land. The run it joins is opened with it, so
	 *  the walk still draws the row that moved. */
	function carryTo(note: TreeNote, landing: MoveLanding): void {
		if (!landing.to) return;
		settling = { note: note.ref, was: note.address };
		if (landing.to.relation === 'under') toggle(landing.to.on, true);
		moveNote?.move(note.ref, { relation: landing.to.relation, note: landing.to.on });
	}

	/** The focused row carried to the note above it, which is the move a
	 *  keyboard makes. */
	function nudgeNote(
		group: string,
		rows: readonly OutlineRow[],
		here: number,
		note: TreeNote,
		relation: 'under' | 'after'
	): void {
		let above: TreeNote | null = null;
		for (let at = here - 1; at >= 0 && above === null; at--) {
			const row = rows[at];
			if (row.kind === 'note') above = row.note;
		}
		if (!above) {
			told = 'There is no note above this one';
			return;
		}
		// Nothing on the page previews this one, so a chord that would only send
		// the note to the end of the run it is already in does nothing at all.
		if (note.parent === (relation === 'under' ? above.ref : above.parent)) {
			told = 'Stays where it is';
			return;
		}
		const landing = movesTo(treeRows(group), note, {
			on: above.ref,
			address: above.address,
			title: above.title,
			relation
		});
		told = landing.to ? '' : landing.says;
		carryTo(note, landing);
	}

	/** Where a note let go of landed, once the walk has it at the address the
	 *  server gave it. */
	const settled = $derived.by((): string => {
		if (!settling) return '';
		for (const group of drawn) {
			if (group.lead) continue;
			for (const row of group.rows) {
				if (row.kind !== 'note' || row.note.ref !== settling.note) continue;
				return row.note.address === settling.was
					? ''
					: `${settling.was} is now ${row.note.address}, and ${settling.was} still leads to it`;
			}
		}
		return '';
	});

	/** A section being carried up or down its own note — `sections.ts`. */
	let moving = $state<{
		at: { x: number; y: number };
		note: OwnedRef;
		address: Address;
		band: SectionBand;
		aim: SectionAim | null;
	} | null>(null);

	/** Where one note's section rows stand right now, read off the page. */
	function bandOf(note: OwnedRef): SectionBand {
		const head = scroller?.querySelector(`[data-row="${CSS.escape(note)}"]`);
		const rows: SectionBand['rows'] = (sections?.of(note) ?? []).flatMap((one) => {
			const drawn = scroller?.querySelector(`[data-row="${CSS.escape(`section:${one.ref}`)}"]`);
			if (!drawn) return [];
			const box = drawn.getBoundingClientRect();
			return [{ ref: one.ref, says: one.says, top: box.top, bottom: box.bottom }];
		});
		return { top: head?.getBoundingClientRect().top ?? 0, rows };
	}

	/** The section whose handle was tapped, which then offers the move a drag
	 *  makes: a finger has neither a hover to read nor a key to hold. */
	let nudging = $state<OwnedRef | null>(null);

	$effect(() => {
		if (nudging === null) return;
		const drawnStill = drawn.some((group) =>
			group.rows.some((row) => row.kind === 'section' && row.section.ref === nudging)
		);
		if (!drawnStill) nudging = null;
	});

	function carrySection(event: PointerEvent, row: Extract<OutlineRow, { kind: 'section' }>): void {
		dragged = false;
		if (!sections) return;
		let band = bandOf(row.note);
		dragFrom<SectionAim>(event, {
			aim: (_x, y) => {
				band = bandOf(row.note);
				return aimSection(band, y);
			},
			scroller: () => scroller ?? null,
			moved: (at, aim) => (moving = { at, note: row.note, address: row.address, band, aim }),
			dropped: (aim) => {
				moving = null;
				dragged = true;
				const stack = sections?.of(row.note);
				if (!aim || !stack) return;
				const landing = landingAt(stack, row.section.ref, aim.slot);
				if (landing) sections?.onMove(row.note, row.section.ref, landing.after);
			}
		});
	}

	const lit = $derived.by((): ReadonlySet<OwnedRef> => {
		const aim = carrying?.aim ?? lifting?.landing.to;
		if (!aim) return NO_REFS;
		for (const group of drawn) {
			if (group.lead) continue;
			const run = runFor(
				group.rows.filter((row): row is TreeRow => row.kind === 'note' || row.kind === 'rest'),
				aim
			);
			if (run.size > 0) return run;
		}
		return NO_REFS;
	});

	const says = $derived(
		carrying
			? carrying.aim
				? aimSays(carrying.aim)
				: 'Move over a note to write there'
			: lifting
				? lifting.landing.says
				: moving
					? sectionSays(moving.band, moving.address, moving.aim)
					: (moveNote?.refused ?? '') || settled || told
	);

	/** Whichever drag is under the pointer, for the pill that follows it. */
	const carried = $derived(carrying ?? moving ?? lifting);
</script>

<div
	bind:this={scroller}
	class="size-full overflow-y-auto overscroll-contain scroll-fade-y [--scroll-fade:1rem] [--tree-step:0.375rem] sm:[--tree-step:1rem]"
	style="padding-top: {inset.top}; padding-bottom: {inset.bottom}; scroll-padding-top: calc({inset.top} + {band}px); scroll-padding-bottom: {inset.bottom}"
	{@attach scrollFade('y')}
>
	<div class="mx-auto w-full max-w-4xl px-2 pb-4 sm:px-6">
		{#if onChoosing}
			<!-- Stuck below the chrome, so choosing starts from wherever the reader
			     has got to and not from the top of the run. -->
			<div
				bind:clientHeight={band}
				class="sticky z-20 flex justify-end bg-background/95 py-2 backdrop-blur"
				style="top: {inset.top}"
			>
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
							style="top: calc({inset.top} + {band}px)"
						>
							{by ?? (title || 'Untitled')}
						</h2>
					{/if}

					<div role="tree" data-tree={group} aria-label={by ?? (title || 'Notes')}>
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
									aria-keyshortcuts={chords(!heads) || undefined}
									onpointerdown={(event) => {
										dragged = false;
										if (moveNote && !heads && onAddress(event)) {
											liftNote(event, group, row.note);
										}
									}}
									onclick={() => act(group, row)}
									onkeydown={(event) => keys(event, group, rows, heads)}
									onfocusin={() => tabbed.set(group, key)}
									class="flex min-h-11 cursor-pointer items-center gap-1 rounded-lg pe-2 text-start hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-selected:bg-muted sm:gap-2 {selection.length >
										0 && asked.length === 0
										? 'opacity-45'
										: ''} {!heads && lit.has(row.note.ref)
										? 'border-s-2 border-dashed border-foreground/50 bg-muted/60'
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

									<!-- The address is the row's grip: it is what a move rewrites,
									     and DESIGN.md § "A note's row fits the narrowest phone"
									     leaves no room for a fourth control. The padding is pulled
									     back by as much, so a thumb has more than the glyphs to
									     press and the row is no wider for it. -->
									<span
										class="shrink-0 address text-xs text-muted-foreground {moveNote && !heads
											? '-mx-2 cursor-grab touch-pan-y px-2'
											: ''}"
										title={moveNote && !heads ? 'Drag it to move this note' : undefined}
									>
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
											<span class="sr-only sm:not-sr-only">Published</span>
										</span>
									{/if}

									{#if chosen?.has(row.note.ref)}
										<span
											class="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
											aria-hidden="true"
										>
											<Check class="size-3" />
											<span class="hidden sm:inline">Chosen</span>
										</span>
									{/if}

									{#if row.under > 0}
										<span
											class="hidden shrink-0 text-xs text-muted-foreground tabular-nums sm:inline"
											aria-hidden="true"
										>
											{row.under.toLocaleString()}
										</span>
										<span class="sr-only">
											{`${row.under.toLocaleString()} ${row.under === 1 ? 'note' : 'notes'} under this`}
										</span>
									{/if}

									{#if sections && !heads}
										<button
											type="button"
											tabindex="-1"
											aria-expanded={showing(row.note.ref)}
											aria-label={showing(row.note.ref)
												? `Hide the sections of ${row.note.address}`
												: `Show the sections of ${row.note.address}`}
											onclick={(event) => {
												event.stopPropagation();
												sections?.onShow(row.note.ref, !showing(row.note.ref));
											}}
											class="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
										>
											<List class="size-4" />
										</button>
									{/if}

									{#if writeUnder}
										<button
											type="button"
											tabindex="-1"
											aria-label="Write a note under {row.note.address}"
											aria-keyshortcuts={writeUnder.keys}
											title={writeUnder.beside
												? 'Tap to write under this note, or drag it to where the new note goes'
												: undefined}
											onpointerdown={carry}
											onclick={(event) => {
												event.stopPropagation();
												if (dragged) {
													dragged = false;
													return;
												}
												writeUnder?.write(row.note.ref);
											}}
											class="flex size-11 shrink-0 touch-pan-y items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
										>
											<CornerDownRight class="size-4" />
										</button>
									{/if}
								</div>
							{:else if row.kind === 'section'}
								<div
									role="treeitem"
									data-row={key}
									tabindex={key === held ? 0 : -1}
									aria-level={row.depth + 1}
									aria-selected={false}
									aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
									onpointerdown={() => (dragged = false)}
									onclick={() => act(group, row)}
									onkeydown={(event) => keys(event, group, rows, heads)}
									onfocusin={() => tabbed.set(group, key)}
									class="flex min-h-11 cursor-pointer items-center gap-1 rounded-lg pe-2 text-start hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:gap-2 {moving?.note ===
									row.note
										? 'border-s-2 border-dashed border-foreground/50 bg-muted/60'
										: ''}"
									style="padding-inline-start: {step}"
								>
									<button
										type="button"
										tabindex="-1"
										aria-expanded={nudging === row.section.ref}
										aria-label="Move section {row.at} of {row.of} in {row.address}"
										onpointerdown={(event) => carrySection(event, row)}
										onclick={(event) => {
											event.stopPropagation();
											if (dragged) {
												dragged = false;
												return;
											}
											nudging = nudging === row.section.ref ? null : row.section.ref;
										}}
										class="flex size-11 shrink-0 touch-pan-y items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
									>
										<GripVertical class="size-4" />
									</button>
									<span class="min-w-0 flex-1 truncate text-sm text-muted-foreground">
										{row.section.says}
									</span>

									{#if nudging === row.section.ref}
										<button
											type="button"
											tabindex="-1"
											disabled={row.at === 1}
											aria-label="Move it up in {row.address}"
											onclick={(event) => {
												event.stopPropagation();
												arrange(row, -1);
											}}
											class="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
										>
											<ArrowUp class="size-4" />
										</button>
										<button
											type="button"
											tabindex="-1"
											disabled={row.at === row.of}
											aria-label="Move it down in {row.address}"
											onclick={(event) => {
												event.stopPropagation();
												arrange(row, 1);
											}}
											class="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
										>
											<ArrowDown class="size-4" />
										</button>
									{/if}
								</div>
							{:else if row.kind === 'says'}
								<div
									role="treeitem"
									data-row={key}
									tabindex={key === held ? 0 : -1}
									aria-level={row.depth + 1}
									aria-selected={false}
									onpointerdown={() => (dragged = false)}
									onclick={() => act(group, row)}
									onkeydown={(event) => keys(event, group, rows, heads)}
									onfocusin={() => tabbed.set(group, key)}
									class="flex min-h-11 items-center gap-1 rounded-lg pe-2 text-sm text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:gap-2 {row.again
										? 'cursor-pointer hover:bg-muted/60'
										: ''}"
									style="padding-inline-start: {step}"
								>
									<span class="size-11 shrink-0" aria-hidden="true"></span>
									<span class="min-w-0 truncate">{row.says}</span>
								</div>
							{:else}
								<div
									role="treeitem"
									data-row={key}
									tabindex={key === held ? 0 : -1}
									aria-level={row.depth + 1}
									aria-selected={false}
									onpointerdown={() => (dragged = false)}
									onclick={() => reveal(group, row)}
									onkeydown={(event) => keys(event, group, rows, heads)}
									onfocusin={() => tabbed.set(group, key)}
									class="flex min-h-11 cursor-pointer items-center gap-1 rounded-lg pe-2 text-sm text-muted-foreground hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:gap-2"
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

{#if carried}
	<div
		class="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4"
		style="top: {carried.at.y}px; transform: translateY(-50%)"
		aria-hidden="true"
	>
		<span
			class="flex max-w-full items-center gap-2 rounded-lg border border-dashed border-foreground/50 bg-background/95 px-3 py-2 text-sm shadow-sm backdrop-blur"
		>
			{#if moving || lifting}
				<GripVertical class="size-4 shrink-0" />
			{:else if carrying?.aim?.relation === 'after'}
				<ArrowDown class="size-4 shrink-0" />
			{:else}
				<CornerDownRight class="size-4 shrink-0" />
			{/if}
			{#if lifting}
				<span class="shrink-0 text-xs text-muted-foreground">{lifting.note.address}</span>
				<span class="max-w-32 min-w-0 truncate">{lifting.note.title || 'Untitled'}</span>
			{/if}
			<span class="min-w-0 truncate">{says}</span>
		</span>
	</div>
{/if}
{#if !carried && moveNote?.refused}
	<div
		class="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4"
		style="bottom: calc({inset.bottom} + 0.5rem)"
		aria-hidden="true"
	>
		<span
			class="max-w-full truncate rounded-lg border border-destructive/50 bg-background/95 px-3 py-2 text-sm text-destructive shadow-sm backdrop-blur"
		>
			{moveNote.refused}
		</span>
	</div>
{/if}
<span class="sr-only" role="status" aria-live="polite">{says}</span>
