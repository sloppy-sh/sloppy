// Putting a block somewhere else in the note's stack. `./document.ts` owns the
// correspondence this rests on — a top-level node IS a block row — so a move
// here becomes one `reorder` in the next save plan and one `ord` on the wire.
//
// Pointer events rather than HTML5 drag-and-drop, which never starts from a
// touch: a phone is the primary surface here, not the fallback.

import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

/** lucide's `grip-vertical`, written out: nothing here renders through Svelte. */
const GRIP =
	'<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">' +
	'<circle cx="9" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/>' +
	'<circle cx="15" cy="5" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="15" cy="19" r="1.5"/>' +
	'</svg>';

/** How far a press has to travel before it is a drag rather than a tap. */
const NUDGE = 4;
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

/** False where the block was already where it was asked to go. */
function move(view: EditorView, uid: string, to: number): boolean {
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

/** What a drag near the edge should scroll, or null where the page itself does. */
function scrollerOf(from: HTMLElement): HTMLElement | null {
	for (let element = from.parentElement; element; element = element.parentElement) {
		const overflow = getComputedStyle(element).overflowY;
		const scrolls = overflow === 'auto' || overflow === 'scroll';
		if (scrolls && element.scrollHeight > element.clientHeight + 1) return element;
	}
	return null;
}

/** Where the block would land, counted as gaps: `0` is above the first row. */
function slotAt(rows: readonly Row[], y: number): number {
	const boxes = rows.map((row) => row.dom?.getBoundingClientRect());
	for (const [index, box] of boxes.entries()) {
		if (box && y < box.top + box.height / 2) return index;
	}
	return rows.length;
}

function drag(view: EditorView, button: HTMLButtonElement, uid: string, start: PointerEvent): void {
	if (start.button > 0) return;
	start.preventDefault();

	const line = document.createElement('div');
	line.className = 'sloppy-drop-line';
	const scroller = scrollerOf(view.dom);
	let dragging = false;
	let slot = -1;
	let y = start.clientY;
	let frame = 0;

	function aim(): void {
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

	function moved(event: PointerEvent): void {
		y = event.clientY;
		if (!dragging) {
			if (Math.abs(y - start.clientY) < NUDGE) return;
			dragging = true;
			button.classList.add('is-dragging');
			document.body.append(line);
			if (scroller) frame = requestAnimationFrame(drift);
		}
		event.preventDefault();
		aim();
	}

	function done(): void {
		window.removeEventListener('pointermove', moved);
		window.removeEventListener('pointerup', done);
		window.removeEventListener('pointercancel', done);
		if (frame) cancelAnimationFrame(frame);
		line.remove();
		button.classList.remove('is-dragging');
		if (!dragging || slot < 0) return;
		const from = indexOf(rowsOf(view), uid);
		// A block dropped into either gap it already touches has not moved.
		if (from < 0 || slot === from || slot === from + 1) return;
		move(view, uid, slot < from ? slot : slot - 1);
	}

	window.addEventListener('pointermove', moved);
	window.addEventListener('pointerup', done);
	window.addEventListener('pointercancel', done);
}

function byKey(view: EditorView, uid: string, event: KeyboardEvent): void {
	const step = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
	if (step === 0) return;
	event.preventDefault();
	const at = indexOf(rowsOf(view), uid);
	if (at < 0 || !move(view, uid, at + step)) return;
	// The widget is rebuilt at its new place, so the handle that was under the
	// finger is a different element by now — and an unfocused one says nothing.
	view.dom.querySelector<HTMLElement>(`[data-block-handle="${uid}"]`)?.focus();
}

function handleFor(view: EditorView, uid: string, index: number, total: number): HTMLElement {
	const row = document.createElement('div');
	row.className = 'sloppy-row';
	row.contentEditable = 'false';

	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'sloppy-row-handle';
	button.dataset.blockHandle = uid;
	button.setAttribute('aria-label', `Move block ${index + 1} of ${total}`);
	button.title = 'Drag to move, or use the arrow keys';
	button.innerHTML = GRIP;
	button.addEventListener('pointerdown', (event) => drag(view, button, uid, event));
	button.addEventListener('keydown', (event) => byKey(view, uid, event));

	row.append(button);
	return row;
}

function handles(state: EditorState): DecorationSet {
	const total = state.doc.childCount;
	if (total < 2) return DecorationSet.empty;
	const widgets: Decoration[] = [];
	let index = 0;
	state.doc.forEach((node, pos) => {
		const uid = node.attrs.blockUid as string | null;
		const at = index++;
		if (!uid) return;
		widgets.push(
			Decoration.widget(pos, (view) => handleFor(view, uid, at, total), {
				side: -1,
				// Held across every edit that leaves this block where it is, so the
				// handle under the pointer is not rebuilt on every keystroke.
				key: `${uid}:${at}:${total}`,
				ignoreSelection: true,
				stopEvent: () => true
			})
		);
	});
	return DecorationSet.create(state.doc, widgets);
}

export const BlockHandles = Extension.create({
	name: 'blockHandles',

	addProseMirrorPlugins() {
		return [new Plugin({ key: new PluginKey('blockHandles'), props: { decorations: handles } })];
	}
});
