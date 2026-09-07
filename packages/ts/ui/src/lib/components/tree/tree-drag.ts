// Dragging in the outline: {@link dragFrom} is the press every control here
// becomes a drag through, and the rest of this file is what a drop on a row
// does — a note written at the end of a run, or a note already written carried
// to the end of another. AI.md § "The Address Is the Protocol": either way the
// run appends, nobody else is renumbered, and the address is the server's to
// assign.
//
// Pointer events rather than HTML5 drag-and-drop, which never starts from a
// touch, and the hold `editor/block-handles.ts` presses for on a finger.

import {
	type Address,
	childAddress,
	compareAddresses,
	isAncestorAddress,
	type OwnedRef,
	parentAddress,
	siblingAddress
} from '@sloppy/types';
import type { TreeItem, TreeNote, TreeRow } from './walk.js';

/** Where a drop would put the new note, said against a row already drawn. */
export interface TreeAim {
	on: OwnedRef;
	address: Address;
	title: string;
	/** `under` the row, so the new note springs out of it; `after` it, so the new
	 *  note continues the run the row is in. */
	relation: 'under' | 'after';
}

/** A drawn row as the drag reads it off the page, in viewport coordinates. */
export interface TreeBox {
	on: OwnedRef;
	address: Address;
	title: string;
	top: number;
	bottom: number;
	/** Where the row's own words start, which is the indent it is read against. */
	left: number;
}

/** How far past a row's words the pointer goes before it is under that row
 *  rather than level with it. */
export const INDENT_PX = 24;

/** How far a press travels before it is a drag rather than a tap. */
const NUDGE = 4;
/** How long a finger rests before it is holding the control rather than
 *  starting a scroll, and how far it may wobble while it rests. */
const HOLD_MS = 350;
const WOBBLE = 10;
/** How near the scroller's edge a drag reaches before it carries it along. */
const EDGE_PX = 56;
const DRIFT_PX = 14;

/**
 * The row the pointer is over and what a drop there would write. Above the
 * first row is nowhere: a note goes under or after one that is there, so there
 * is nothing to name. Below the last row aims at the last row, which is the run
 * a pointer past the end of the outline is still over.
 */
export function aimAt(
	boxes: readonly TreeBox[],
	x: number,
	y: number,
	indent = INDENT_PX
): TreeAim | null {
	if (boxes.length === 0 || y < boxes[0].top) return null;
	const box = boxes.find((one) => y < one.bottom) ?? boxes[boxes.length - 1];
	return {
		on: box.on,
		address: box.address,
		title: box.title,
		relation: x >= box.left + indent ? 'under' : 'after'
	};
}

const named = (row: { address: Address; title: string }): string =>
	`${row.address} ${row.title || 'Untitled'}`;

/** What the drop is about to do, for the reader and for anyone listening. */
export function aimSays(aim: TreeAim): string {
	return aim.relation === 'under' ? `Write under ${named(aim)}` : `Write beside ${named(aim)}`;
}

/** What letting a carried note go would do, in the reader's words. */
export interface MoveLanding {
	says: string;
	/** Where it goes; absent where letting go there would move nothing. */
	to?: TreeAim;
}

/**
 * Where a note carried over `rows` would land — the rows of its own graph, as
 * far as the reader has them open. The address is the greatest in the run it
 * joins and one more, which is the rule the server assigns by; read off what is
 * drawn, so a run drawn short of its end, or one holding an address a note has
 * been carried away from, lands past the address named here.
 */
export function movesTo(
	rows: readonly TreeRow[],
	moved: Pick<TreeNote, 'ref' | 'address'>,
	aim: TreeAim | null
): MoveLanding {
	if (!aim) return { says: 'Move over a note to put it there' };
	const notes = rows.filter((row): row is TreeItem => row.kind === 'note');
	const on = notes.find((row) => row.note.ref === aim.on)?.note;
	if (!on) return { says: 'A note stays in the graph it was written in' };
	const itself = on.ref === moved.ref && aim.relation === 'under';
	if (itself || isAncestorAddress(moved.address, on.address)) {
		return { says: 'A note cannot go inside itself' };
	}
	const under = aim.relation === 'under' ? on.address : parentAddress(on.address);
	const along = notes
		.map((row) => row.note.address)
		.filter((address) => parentAddress(address) === under);
	const last = along.reduce<Address | null>(
		(most, one) => (most === null || compareAddresses(most, one) < 0 ? one : most),
		null
	);
	if (last === moved.address) return { says: 'Stays where it is' };
	const takes = last === null ? childAddress(under) : siblingAddress(last);
	const how = aim.relation === 'under' ? 'under' : 'beside';
	return { says: `Becomes ${takes} ${how} ${named(on)}`, to: aim };
}

/**
 * The run a drop would join, as the refs of the rows drawn in it. The row the
 * aim names is in it either way: `under` it is what the run hangs off, `after`
 * it is one of the run itself.
 */
export function runFor(rows: readonly TreeRow[], aim: TreeAim): ReadonlySet<OwnedRef> {
	const lit = new Set<OwnedRef>();
	const at = rows.findIndex((row) => row.kind === 'note' && row.note.ref === aim.on);
	if (at < 0) return lit;
	lit.add(aim.on);
	const depth = rows[at].depth;
	const take = (row: TreeRow, want: number): void => {
		if (row.kind === 'note' && row.depth === want) lit.add(row.note.ref);
	};
	if (aim.relation === 'under') {
		for (let step = at + 1; step < rows.length && rows[step].depth > depth; step++) {
			take(rows[step], depth + 1);
		}
		return lit;
	}
	for (let step = at - 1; step >= 0 && rows[step].depth >= depth; step--) take(rows[step], depth);
	for (let step = at + 1; step < rows.length && rows[step].depth >= depth; step++) {
		take(rows[step], depth);
	}
	return lit;
}

export interface TreeDragHooks<Aim> {
	/** Where the pointer is aiming, read afresh every time: the outline scrolls
	 *  under it. Null is a place nothing can be dropped. */
	aim: (x: number, y: number) => Aim | null;
	/** What a drag near the edge carries along, or null where nothing scrolls. */
	scroller: () => HTMLElement | null;
	moved: (at: { x: number; y: number }, aim: Aim | null) => void;
	/** The aim it was let go on, or null where the drag was called off. Never
	 *  called for a press that stayed a tap. */
	dropped: (aim: Aim | null) => void;
}

/**
 * A press on a row's control, which becomes a drag once a mouse has moved or a
 * finger has been held. A press that stays a tap is left alone, so the control
 * still answers its own row.
 */
export function dragFrom<Aim>(start: PointerEvent, hooks: TreeDragHooks<Aim>): void {
	if (start.button > 0) return;
	// A finger is left to the browser until the press has been held: the outline
	// is where a thumb starts a scroll, and a swipe from here must still scroll.
	const byFinger = start.pointerType === 'touch';
	if (!byFinger) start.preventDefault();

	let dragging = false;
	let aim: Aim | null = null;
	let x = start.clientX;
	let y = start.clientY;
	let frame = 0;
	let holding: ReturnType<typeof setTimeout> | undefined;

	function look(): void {
		aim = hooks.aim(x, y);
		hooks.moved({ x, y }, aim);
	}

	function drift(): void {
		frame = requestAnimationFrame(drift);
		const scroller = hooks.scroller();
		const box = scroller?.getBoundingClientRect();
		if (!scroller || !box || y < box.top || y > box.bottom) return;
		const above = y - box.top;
		const below = box.bottom - y;
		const by = above < EDGE_PX ? -(EDGE_PX - above) : below < EDGE_PX ? EDGE_PX - below : 0;
		if (by === 0) return;
		scroller.scrollTop += (by / EDGE_PX) * DRIFT_PX;
		look();
	}

	/** `touch-action: pan-y` leaves the scroll to the browser, and only a
	 *  non-passive `touchmove` takes it back once the control is held. */
	function refuse(event: TouchEvent): void {
		event.preventDefault();
	}

	function lift(): void {
		dragging = true;
		window.addEventListener('touchmove', refuse, { passive: false });
		frame = requestAnimationFrame(drift);
		look();
	}

	function move(event: PointerEvent): void {
		x = event.clientX;
		y = event.clientY;
		if (!dragging) {
			if (byFinger) {
				if (Math.hypot(x - start.clientX, y - start.clientY) > WOBBLE) end(false);
				return;
			}
			if (Math.hypot(x - start.clientX, y - start.clientY) < NUDGE) return;
			lift();
		}
		event.preventDefault();
		look();
	}

	function called(event: KeyboardEvent): void {
		if (event.key !== 'Escape' || !dragging) return;
		event.preventDefault();
		end(false);
	}

	function end(landed: boolean): void {
		clearTimeout(holding);
		window.removeEventListener('pointermove', move);
		window.removeEventListener('pointerup', up);
		window.removeEventListener('pointercancel', off);
		window.removeEventListener('keydown', called, true);
		window.removeEventListener('touchmove', refuse);
		if (frame) cancelAnimationFrame(frame);
		if (!dragging) return;
		dragging = false;
		hooks.dropped(landed ? aim : null);
	}

	const up = (): void => end(true);
	const off = (): void => end(false);

	if (byFinger) holding = setTimeout(lift, HOLD_MS);
	window.addEventListener('pointermove', move);
	window.addEventListener('pointerup', up);
	window.addEventListener('pointercancel', off);
	window.addEventListener('keydown', called, true);
}
