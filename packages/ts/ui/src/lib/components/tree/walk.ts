// The rows a tree draws, from the genealogy and nothing else. A note's
// references and the links drawn on it are the note's own to show, so neither
// is a branch here.

import { type Address, compareAddresses, type OwnedRef, type Tag } from '@sloppy/types';

/** The least of a note a row is drawn from; `NodeView` already is one. */
export interface TreeNote {
	ref: OwnedRef;
	address: Address;
	/** Absent on a note whose parent is outside what the tree was given. */
	parent?: OwnedRef;
	title: string;
	tags: readonly Tag[];
	/** Whether anyone with the address can read it. */
	published: boolean;
}

/** The run a note with nothing above it belongs to, as {@link walkTree} keys it. */
export const TOP = '';

/**
 * How many of one run are drawn before the rest are asked for. A tree draws
 * only what the reader has opened, so this bounds the one thing that opening
 * cannot: a note whose children run to thousands.
 */
export const RUN_PAGE = 100;

/**
 * How many rows the reader's tags draw, over every branch they open together.
 * Nothing else bounds this the way {@link RUN_PAGE} bounds a run: a graph is
 * deep as well as wide, so every branch holding a lit note would unfold at once
 * and each one draw a run. Past it a run stops at its rest row, which says how
 * many of the waiting notes are lit, and the branches below it are left for the
 * reader to open.
 */
export const LIT_PAGE = 100;

export interface TreeItem {
	kind: 'note';
	note: TreeNote;
	/** 0 for a note with nothing above it in this tree. */
	depth: number;
	/** Its children, which are what opening it draws. */
	children: number;
	/** Every note under it, however deep. */
	under: number;
	open: boolean;
	/** Its place along the run at its level, from 1, and how long that run is. */
	at: number;
	of: number;
}

/** The tail of a run that has not been asked for yet. */
export interface TreeRest {
	kind: 'rest';
	/** The note whose run this is, or {@link TOP}. */
	key: string;
	/** That note's address, `null` at the top of the tree. */
	parent: Address | null;
	depth: number;
	/** How many are waiting. */
	rest: number;
	/** How many of the run are drawn now, which asking for more counts up from. */
	drawn: number;
	/** How many of the waiting ones carry a selected tag themselves, which is
	 *  how many draw lit once they are asked for; 0 while nothing is selected. */
	lit: number;
}

export type TreeRow = TreeItem | TreeRest;

export interface TreeWalk {
	notes: readonly TreeNote[];
	/** The notes whose children are drawn. */
	opened: ReadonlySet<OwnedRef>;
	/** How much of a run has been asked for, keyed the way {@link TreeRest} is. */
	shown?: ReadonlyMap<string, number>;
	page?: number;
	/** The note the reader is on. A run is drawn at least as far as this one, so
	 *  the row they are reading is never the one behind "show more". */
	reading?: OwnedRef | null;
	/** The reader's tags. A branch holding a note that carries one is walked
	 *  into, for at most {@link LIT_PAGE} rows and never one listed in `shut`. */
	selection?: readonly Tag[];
	/** The branches the reader folded back up, which a selected tag no longer
	 *  opens. */
	shut?: ReadonlySet<OwnedRef>;
}

const NONE: ReadonlyMap<string, number> = new Map();
const NO_TAGS: readonly Tag[] = [];
const NO_REFS: ReadonlySet<OwnedRef> = new Set();

/**
 * The rows, in the order a reader walks them: down into a note's children, then
 * along the run to the note after it, then back up. A note whose parent is not
 * among `notes` starts a run of its own, so a tree given a branch draws that
 * branch rather than nothing.
 */
export function walkTree({
	notes,
	opened,
	shown = NONE,
	page = RUN_PAGE,
	reading = null,
	selection = NO_TAGS,
	shut = NO_REFS
}: TreeWalk): TreeRow[] {
	const runs = runsOf(notes);
	const roots = runs.get(TOP) ?? [];
	const under = countUnder(runs, roots);
	const { asked, toward } = litBy(notes, selection);
	const rows: TreeRow[] = [];
	let budget = LIT_PAGE;
	const stack: {
		run: readonly TreeNote[];
		key: string;
		parent: TreeNote | null;
		depth: number;
		at: number;
		/** Whether this run is drawn only because a tag was selected. */
		underLit: boolean;
	}[] = [{ run: roots, key: TOP, parent: null, depth: 0, at: 0, underLit: false }];

	while (stack.length > 0) {
		const frame = stack[stack.length - 1];
		const ask = shown.get(frame.key);
		// A run the reader asked for is none of the tag's doing, so it neither
		// stops at the budget nor spends any of it.
		const budgeted = frame.underLit && ask === undefined;
		// A page that stops short of the note being read would leave the reader
		// looking for themselves behind "show more".
		const held = reading === null ? -1 : frame.run.findIndex((one) => one.ref === reading);
		// The escape can spend past the budget, so the allowance never falls below
		// what this frame has already drawn: a rest row counting a row above it
		// would say more is waiting than the run holds.
		const litRoom = budgeted ? Math.max(frame.at, frame.at + budget, held + 1) : frame.run.length;
		const drawn = Math.min(frame.run.length, Math.max(ask ?? page, held + 1), litRoom);
		const at = frame.at;
		if (at >= drawn) {
			stack.pop();
			if (frame.run.length > drawn) {
				rows.push({
					kind: 'rest',
					key: frame.key,
					parent: frame.parent?.address ?? null,
					depth: frame.depth,
					rest: frame.run.length - drawn,
					drawn,
					lit: frame.run.slice(drawn).filter((one) => asked.has(one.ref)).length
				});
			}
			continue;
		}
		frame.at = at + 1;
		if (budgeted) budget -= 1;
		const note = frame.run[at];
		const children = runs.get(note.ref) ?? [];
		const chose = opened.has(note.ref);
		const lights =
			!chose && budget > 0 && !shut.has(note.ref) && children.some((one) => toward.has(one.ref));
		const open = children.length > 0 && (chose || lights);
		rows.push({
			kind: 'note',
			note,
			depth: frame.depth,
			children: children.length,
			under: under.get(note.ref) ?? 0,
			open,
			at: at + 1,
			of: frame.run.length
		});
		if (open) {
			stack.push({
				run: children,
				key: note.ref,
				parent: note,
				depth: frame.depth + 1,
				at: 0,
				underLit: frame.underLit || lights
			});
		}
	}
	return rows;
}

/** Each run in address order, which is the order every peer reads it in. */
function runsOf(notes: readonly TreeNote[]): Map<string, TreeNote[]> {
	const held = new Set(notes.map((note) => note.ref));
	const runs = new Map<string, TreeNote[]>();
	for (const note of notes) {
		const key = note.parent !== undefined && held.has(note.parent) ? note.parent : TOP;
		const run = runs.get(key);
		if (run) run.push(note);
		else runs.set(key, [note]);
	}
	for (const run of runs.values()) run.sort((a, b) => compareAddresses(a.address, b.address));
	return runs;
}

/** The notes that carry one of `selection` themselves, and those plus every note
 *  above them, so a branch can be asked whether the answer is beneath it. */
function litBy(
	notes: readonly TreeNote[],
	selection: readonly Tag[]
): { asked: ReadonlySet<OwnedRef>; toward: ReadonlySet<OwnedRef> } {
	const asked = new Set<OwnedRef>();
	const toward = new Set<OwnedRef>();
	if (selection.length === 0) return { asked, toward };
	const byRef = new Map(notes.map((note) => [note.ref, note]));
	for (const note of notes) {
		if (!note.tags.some((tag) => selection.includes(tag))) continue;
		asked.add(note.ref);
		let up: TreeNote | undefined = note;
		while (up !== undefined && !toward.has(up.ref)) {
			toward.add(up.ref);
			up = up.parent === undefined ? undefined : byRef.get(up.parent);
		}
	}
	return { asked, toward };
}

function countUnder(
	runs: ReadonlyMap<string, TreeNote[]>,
	roots: readonly TreeNote[]
): Map<OwnedRef, number> {
	const order: TreeNote[] = [];
	const stack = [...roots];
	while (stack.length > 0) {
		const note = stack.pop();
		if (!note) break;
		order.push(note);
		for (const child of runs.get(note.ref) ?? []) stack.push(child);
	}
	const under = new Map<OwnedRef, number>();
	// Backwards: a parent is reached before every note beneath it, so reversing
	// the walk has every child counted by the time its parent is.
	for (let at = order.length - 1; at >= 0; at--) {
		const children = runs.get(order[at].ref) ?? [];
		let total = children.length;
		for (const child of children) total += under.get(child.ref) ?? 0;
		under.set(order[at].ref, total);
	}
	return under;
}
