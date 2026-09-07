// Putting a section somewhere else in the note's stack, and taking one out of
// it. `./document.ts` owns the correspondence this rests on — a section IS a
// block row — so a move here becomes one `reorder` in the next save plan and a
// removal one `remove`.
//
// Pointer events rather than HTML5 drag-and-drop, which never starts from a
// touch: a phone is the primary surface here, not the fallback.

import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { sectionIsBare } from './section-node.js';

/** What can be done to one section, raised out of the plugin because the handle
 *  is plain DOM inside a ProseMirror widget and the menu is a Svelte surface. */
export interface SectionActs {
	/** The handle it was asked for, so the menu opens against it. */
	anchor: HTMLElement;
	/** Which section this is, for a surface that names what it acts on. */
	title: string;
	/** Null at the top of the note, and at the bottom of it. */
	moveUp: (() => void) | null;
	moveDown: (() => void) | null;
	remove: () => void;
	/** Whether anything would be lost with the section. */
	holdsWriting: boolean;
}

export interface BlockHandleOptions {
	/** Where a tap on the handle is answered; null leaves the handle a drag. */
	onSection: ((acts: SectionActs) => void) | null;
}

/** lucide's `grip-vertical`, written out: nothing here renders through Svelte. */
const GRIP =
	'<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">' +
	'<circle cx="9" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/>' +
	'<circle cx="15" cy="5" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="15" cy="19" r="1.5"/>' +
	'</svg>';

/** How far a press has to travel before it is a drag rather than a tap. */
const NUDGE = 4;
/** How long a finger has to rest before it is holding the section rather than
 *  starting a scroll, and how far it may wobble while it rests. */
const HOLD_MS = 350;
const WOBBLE = 10;
/** How near a scroller's edge a drag reaches before it carries the scroller with it. */
const EDGE_PX = 56;
const DRIFT_PX = 14;

interface Row {
	pos: number;
	node: ProseMirrorNode;
	dom: HTMLElement | null;
}

function rowsOf(view: EditorView): Row[] {
	const rows: Row[] = [];
	view.state.doc.forEach((node, pos) => {
		rows.push({ pos, node, dom: view.nodeDOM(pos) as HTMLElement | null });
	});
	return rows;
}

function indexOf(rows: readonly Row[], uid: string): number {
	return rows.findIndex((row) => row.node.attrs.blockUid === uid);
}

/** False where the section was already where it was asked to go, and where the
 *  note was closed before the drag over it ended. */
function move(view: EditorView, uid: string, to: number): boolean {
	if (view.isDestroyed) return false;
	const rows = rowsOf(view);
	const from = indexOf(rows, uid);
	const at = Math.max(0, Math.min(rows.length - 1, to));
	if (from < 0 || at === from) return false;

	const { node, pos } = rows[from];
	const anchor = at < from ? rows[at].pos : (rows[at + 1]?.pos ?? view.state.doc.content.size);
	const caret = view.state.selection.from;
	const carried = caret > pos && caret < pos + node.nodeSize;

	const tr = view.state.tr;
	tr.delete(pos, pos + node.nodeSize);
	const landed = tr.mapping.map(anchor);
	tr.insert(landed, node);
	if (carried) tr.setSelection(TextSelection.near(tr.doc.resolve(landed + (caret - pos))));
	view.dispatch(tr);
	return true;
}

/** The section goes, and the caret lands where it stood. The last section stays:
 *  a note always has somewhere to write. */
function removeSection(view: EditorView, uid: string): void {
	if (view.isDestroyed) return;
	const rows = rowsOf(view);
	const at = indexOf(rows, uid);
	if (at < 0 || rows.length < 2) return;
	const { pos, node } = rows[at];
	const tr = view.state.tr.delete(pos, pos + node.nodeSize);
	const caret = pos === 0 ? 0 : pos - 1;
	tr.setSelection(TextSelection.near(tr.doc.resolve(caret), pos === 0 ? 1 : -1));
	view.dispatch(tr.scrollIntoView());
	view.focus();
}

/** What a drag near the edge should scroll, or null where the page itself does. */
function scrollerOf(from: HTMLElement): HTMLElement | null {
	for (let element = from.parentElement; element; element = element.parentElement) {
		const overflow = getComputedStyle(element).overflowY;
		const scrolls = overflow === 'auto' || overflow === 'scroll';
		if (scrolls && element.scrollHeight > element.clientHeight + 1) return element;
	}
	return null;
}

/** Where the section would land, counted as gaps: `0` is above the first row. */
function slotAt(rows: readonly Row[], y: number): number {
	const boxes = rows.map((row) => row.dom?.getBoundingClientRect());
	for (const [index, box] of boxes.entries()) {
		if (box && y < box.top + box.height / 2) return index;
	}
	return rows.length;
}

function drag(
	view: EditorView,
	button: HTMLButtonElement,
	uid: string,
	start: PointerEvent,
	dragged: () => void
): void {
	if (start.button > 0) return;
	// A finger is left to the browser until the press has been held: the gutter
	// is where a thumb starts a scroll, and a swipe from here must still scroll.
	const byFinger = start.pointerType === 'touch';
	if (!byFinger) start.preventDefault();

	const line = document.createElement('div');
	line.className = 'sloppy-drop-line';
	const scroller = scrollerOf(view.dom);
	let dragging = false;
	let slot = -1;
	let y = start.clientY;
	let frame = 0;
	let holding: ReturnType<typeof setTimeout> | undefined;

	function aim(): void {
		if (view.isDestroyed) return;
		const rows = rowsOf(view);
		slot = slotAt(rows, y);
		const across = view.dom.getBoundingClientRect();
		const above = rows[slot]?.dom?.getBoundingClientRect();
		const last = rows[rows.length - 1]?.dom?.getBoundingClientRect();
		line.style.left = `${across.left}px`;
		line.style.width = `${across.width}px`;
		line.style.top = `${above ? above.top : (last?.bottom ?? across.bottom)}px`;
	}

	function drift(): void {
		frame = requestAnimationFrame(drift);
		const box = scroller?.getBoundingClientRect();
		if (!scroller || !box) return;
		const above = y - box.top;
		const below = box.bottom - y;
		const by = above < EDGE_PX ? -(EDGE_PX - above) : below < EDGE_PX ? EDGE_PX - below : 0;
		if (by === 0) return;
		scroller.scrollTop += (by / EDGE_PX) * DRIFT_PX;
		aim();
	}

	/** `touch-action: pan-y` leaves the scroll to the browser, and only a
	 *  non-passive `touchmove` takes it back once the section is held. */
	function refuse(event: TouchEvent): void {
		event.preventDefault();
	}

	function lift(): void {
		dragging = true;
		button.classList.add('is-dragging');
		document.body.append(line);
		window.addEventListener('touchmove', refuse, { passive: false });
		if (scroller) frame = requestAnimationFrame(drift);
		aim();
	}

	function moved(event: PointerEvent): void {
		y = event.clientY;
		if (!dragging) {
			if (byFinger) {
				if (Math.abs(y - start.clientY) > WOBBLE) done();
				return;
			}
			if (Math.abs(y - start.clientY) < NUDGE) return;
			lift();
		}
		event.preventDefault();
		aim();
	}

	function done(): void {
		clearTimeout(holding);
		window.removeEventListener('pointermove', moved);
		window.removeEventListener('pointerup', done);
		window.removeEventListener('pointercancel', done);
		window.removeEventListener('touchmove', refuse);
		if (frame) cancelAnimationFrame(frame);
		line.remove();
		button.classList.remove('is-dragging');
		if (!dragging) return;
		dragged();
		if (slot < 0) return;
		const from = indexOf(rowsOf(view), uid);
		// A section dropped into either gap it already touches has not moved.
		if (from < 0 || slot === from || slot === from + 1) return;
		move(view, uid, slot < from ? slot : slot - 1);
	}

	if (byFinger) holding = setTimeout(lift, HOLD_MS);
	window.addEventListener('pointermove', moved);
	window.addEventListener('pointerup', done);
	window.addEventListener('pointercancel', done);
}

function moveBy(view: EditorView, uid: string, step: number): void {
	const at = indexOf(rowsOf(view), uid);
	if (at < 0 || !move(view, uid, at + step)) return;
	// The widget is rebuilt at its new place, so the handle that was under the
	// finger is a different element by now — and an unfocused one says nothing.
	view.dom.querySelector<HTMLElement>(`[data-block-handle="${uid}"]`)?.focus();
}

function byKey(view: EditorView, uid: string, event: KeyboardEvent): void {
	const step = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
	if (step === 0) return;
	event.preventDefault();
	moveBy(view, uid, step);
}

function handleFor(
	view: EditorView,
	uid: string,
	index: number,
	total: number,
	options: BlockHandleOptions
): HTMLElement {
	const row = document.createElement('div');
	row.className = 'sloppy-row';
	row.contentEditable = 'false';

	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'sloppy-row-handle';
	button.dataset.blockHandle = uid;
	button.setAttribute('aria-label', `Section ${index + 1} of ${total}`);
	button.setAttribute('aria-haspopup', 'menu');
	button.title = 'Drag to move, or open it for more';
	button.innerHTML = GRIP;

	let dragged = false;
	button.addEventListener('pointerdown', (event) => {
		drag(view, button, uid, event, () => {
			// The click that closes a drag arrives after this, and is not a tap. A
			// keyboard sends one with no drag before it at all, and that one is.
			dragged = true;
			setTimeout(() => (dragged = false));
		});
	});
	button.addEventListener('click', (event) => {
		event.preventDefault();
		const rows = rowsOf(view);
		const at = indexOf(rows, uid);
		if (dragged || at < 0 || !options.onSection) return;
		options.onSection({
			anchor: button,
			title: `Section ${at + 1} of ${rows.length}`,
			moveUp: at > 0 ? () => moveBy(view, uid, -1) : null,
			moveDown: at < rows.length - 1 ? () => moveBy(view, uid, 1) : null,
			remove: () => removeSection(view, uid),
			holdsWriting: !sectionIsBare(rows[at].node)
		});
	});
	button.addEventListener('keydown', (event) => byKey(view, uid, event));

	row.append(button);
	return row;
}

function handles(state: EditorState, options: BlockHandleOptions): DecorationSet {
	const total = state.doc.childCount;
	if (total < 2) return DecorationSet.empty;
	const widgets: Decoration[] = [];
	let index = 0;
	state.doc.forEach((node, pos) => {
		const uid = node.attrs.blockUid as string | null;
		const at = index++;
		if (!uid) return;
		widgets.push(
			Decoration.widget(pos, (view) => handleFor(view, uid, at, total, options), {
				side: -1,
				// Held across every edit that leaves this section where it is, so the
				// handle under the pointer is not rebuilt on every keystroke.
				key: `${uid}:${at}:${total}`,
				ignoreSelection: true,
				stopEvent: () => true
			})
		);
	});
	return DecorationSet.create(state.doc, widgets);
}

export const BlockHandles = Extension.create<BlockHandleOptions>({
	name: 'blockHandles',

	addOptions() {
		return { onSection: null };
	},

	addProseMirrorPlugins() {
		const options = this.options;
		return [
			new Plugin({
				key: new PluginKey('blockHandles'),
				props: { decorations: (state) => handles(state, options) }
			})
		];
	}
});
