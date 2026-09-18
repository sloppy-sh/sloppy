<script lang="ts">
	// A node's interior: one writing surface whose sections ARE the block rows.
	// `./document.ts` owns that correspondence, `./contract.ts` the props.
	//
	// A pen drawing anywhere on this surface settles into a drawing where it was
	// made; there is no drawing mode to find (DESIGN.md § The canvas).
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import Bold from '@lucide/svelte/icons/bold';
	import Brackets from '@lucide/svelte/icons/brackets';
	import Code from '@lucide/svelte/icons/code';
	import Compass from '@lucide/svelte/icons/compass';
	import FileCode from '@lucide/svelte/icons/file-code';
	import Heading1 from '@lucide/svelte/icons/heading-1';
	import Heading2 from '@lucide/svelte/icons/heading-2';
	import ImageIcon from '@lucide/svelte/icons/image';
	import Italic from '@lucide/svelte/icons/italic';
	import ListIcon from '@lucide/svelte/icons/list';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import ListOrdered from '@lucide/svelte/icons/list-ordered';
	import PenLine from '@lucide/svelte/icons/pen-line';
	import Plus from '@lucide/svelte/icons/plus';
	import Quote from '@lucide/svelte/icons/quote';
	import Sigma from '@lucide/svelte/icons/sigma';
	import Smile from '@lucide/svelte/icons/smile';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Workflow from '@lucide/svelte/icons/workflow';
	import type { InkStroke, OwnedRef } from '@sloppy/types';
	import { Editor } from '@tiptap/core';
	import { TaskItem, TaskList } from '@tiptap/extension-list';
	import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
	import StarterKit from '@tiptap/starter-kit';
	import { untrack } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { EmojiEntry } from '../../emoji/catalog.js';
	import { emojiCatalogs } from '../../emoji/catalogs.svelte.js';
	import { tokenizeContent } from '../../emoji/tokenize.js';
	import ConfirmModal from '../confirm/confirm-modal.svelte';
	import NoteMenu, { type NoteMenuItem } from '../note-menu.svelte';
	import { BlockHandles, type SectionActs, type SectionHolds } from './block-handles.js';
	import { CARET_MENU, caretOptionId } from './caret-menu.svelte';
	import { anchorLabel, CODE_PROTOCOL, CodeAnchors, codeHref } from './code-anchor.js';
	import { CompassNode } from './compass-node.js';
	import type { BlockStackProps, HeldPicture } from './contract.js';
	import {
		docBlocks,
		heldApart,
		openBlocks,
		openDraft,
		planSave,
		runSave,
		SaveFailure,
		textSection,
		type DocBlock,
		type Opened,
		type SavedBlock,
		type SaveOp,
		type SaveTrouble
	} from './document.js';
	import EmojiPicker from './emoji-picker.svelte';
	import { citedLarge, emojiInsert, EmojiNode, EMOJI_NODE, reclaimEmoji } from './emoji-node.js';
	import EmojiSuggestionPopup from './emoji-suggestion-popup.svelte';
	import { EmojiCompletions, EmojiSuggestion } from './emoji-suggestion.svelte.js';
	import { DRAWN_ELEMENTS } from './elements.js';
	import { fitted, NOTE_PX } from './fit.js';
	import { InkNode } from './ink-node.js';
	import {
		NIB_WIDTH,
		StrokeInProgress,
		capturePointer,
		drawAhead,
		drawStroke,
		prepareCanvas,
		redrawWithin,
		strokeBounds,
		translateStrokes,
		type InkBounds,
		type InkSurface
	} from './ink.js';
	import MediaPicker from './media-picker.svelte';
	import { afterElement, endOfNote } from './placement.js';
	import { PICTURE_NODE, PictureNode } from './picture-node.js';
	import { ReferenceNode } from './reference-node.js';
	import ReferenceSuggestionPopup from './reference-suggestion-popup.svelte';
	import { NoteCompletions, ReferenceSuggestion } from './reference-suggestion.svelte.js';
	import { NoteDocument, SectionNode } from './section-node.js';
	import Toolbar, { type EditorAction } from './toolbar.svelte';

	let {
		node,
		blocks,
		onCreate,
		onUpdate,
		onRemove,
		onReorder,
		media,
		emoji,
		references,
		code,
		drafts,
		arranging = true,
		offering = false
	}: BlockStackProps & {
		/** Whether this surface carries the handles that arrange its own sections.
		 *  False where it is hosted in a row that arranges them itself, so one
		 *  section has one handle and one place its order is decided. */
		arranging?: boolean;
		/** Whether a write here is composed into a change offered to whoever
		 *  writes the note rather than landing on it, which is what the line under
		 *  the writing says has happened. */
		offering?: boolean;
	} = $props();

	const SAVE_AFTER_MS = 700;
	/** However long the writing runs on, no change waits longer than this to be written. */
	const SAVE_WITHIN_MS = 3000;
	const RETRY_AFTER_MS = 4000;
	/** How long the pen may rest before the strokes so far settle into a drawing. */
	const SETTLE_AFTER_MS = 900;
	const INK_PADDING = 12;
	/** How much one section may hold and still be saved. */
	const SECTION_LIMIT_BYTES = 2 * 1024 * 1024;
	/** How much of the writing surface the controls stand over. */
	const BAR_CLEARANCE = 64;
	const NEW_INK_HEIGHT = 200;

	let surface = $state<HTMLDivElement | null>(null);
	let host = $state<HTMLDivElement | null>(null);
	let wet = $state<HTMLCanvasElement | null>(null);

	// Never `$state`: Svelte's deep proxy corrupts TipTap's internals, so
	// post-mount UI reads `ready` instead (docs/ARCHITECTURE.md § Blocks and ink).
	let editor: Editor | null = null;
	let ready = $state(false);
	let empty = $state(true);
	let editing = $state(false);
	let marks = $state<Record<string, boolean>>({});
	let saveState = $state<'idle' | 'saving' | 'saved'>('idle');
	/** The last save that did not land, and why; null once one has. */
	let failed = $state<{ trouble: SaveTrouble; says: string } | null>(null);
	let pickerOpen = $state(false);
	let mediaOpen = $state(false);
	let removingSection = $state(false);
	/** What the section the question stands over is holding. */
	let losing = $state<Lost>('writing');
	/** What takes out the section the question stands over. */
	let takeSection: (() => void) | null = null;
	/** The section a handle was tapped on, while its menu is up. */
	let acts = $state.raw<SectionActs | null>(null);
	let actsOpen = $state(false);

	const completions = new EmojiCompletions();
	const noteCompletions = new NoteCompletions();

	/** The note's author, whose emoji catalog its shortcodes were written against. */
	const author = $derived(node.ref.slice(0, node.ref.lastIndexOf('/')));
	const catalog = $derived(emojiCatalogs.of(author, emoji.catalog));
	/** The reader's own, which is what they can put into a note and change. */
	const ownCatalog = $derived(emojiCatalogs.of(emoji.mine, emoji.catalog));

	/** What the API is believed to hold, in its order; kept true op by op. */
	let saved: SavedBlock[] = [];
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	let saving = false;
	let again = false;
	/** When the oldest unwritten change was made; 0 once nothing is waiting. */
	let changedAt = 0;
	/** Bumped when the surface is rebuilt for another node, so a save in flight stops. */
	let era = 0;
	/** The note this surface is writing into, captured with the surface itself. */
	let writingTo: OwnedRef = untrack(() => node.ref);
	/** Whether this surface has read what the device holds for the note. A draft
	 *  it has never seen is a later surface's to open from, so it is neither
	 *  written over nor let go. */
	let readHeld = false;
	/** Whether anything has been written here since the note opened. */
	let touched = false;

	// ── Saving ───────────────────────────────────────────────────────────────
	/** One trip to the API, holding everything it needs to outlive this surface. */
	interface Write {
		note: OwnedRef;
		/** The document it was read from, stamped with the row each new block became. */
		from: Editor;
		rows: SavedBlock[];
		next: DocBlock[];
		/** The draft this trip is the last one kept for, so a trip outliving its
		 *  surface writes over its own and never what a later one is holding.
		 *  Zero where this surface has kept none. */
		kept: number;
		/** `DraftStore.leaving`'s call, made once this trip has settled. */
		arrived: () => void;
	}

	/** The trip still in the air, so the next one queues behind it rather than racing it. */
	let inFlight: Promise<void> = Promise.resolve();

	function plan(): Write | null {
		const current = editor;
		if (!current || current.isDestroyed) return null;
		const next = docBlocks(current.state.doc);
		let kept = 0;
		if (readHeld) {
			const outstanding = planSave(saved, next).length > 0;
			kept = outstanding ? drafts.keep(writingTo, { rows: saved, next }) : drafts.last(writingTo);
		}
		return {
			note: writingTo,
			from: current,
			rows: saved,
			next,
			kept,
			arrived: drafts.leaving(writingTo)
		};
	}

	function tooBig(op: SaveOp): boolean {
		if (op.kind !== 'create' && op.kind !== 'update') return false;
		return new TextEncoder().encode(JSON.stringify(op.content)).byteLength > SECTION_LIMIT_BYTES;
	}

	/** The plan without the sections too big to save. A section past what one can
	 *  hold is left out rather than taking the rest of the note down with it, and
	 *  whatever followed it is re-anchored to the section it will really follow,
	 *  so nothing lands in an order the person did not write. */
	function withinBudget(planned: readonly SaveOp[]): SaveOp[] {
		const left: Record<string, string | null> = {};
		const behind = (after: string | null): string | null => {
			let at = after;
			while (at !== null && Object.hasOwn(left, at)) at = left[at];
			return at;
		};
		const ops: SaveOp[] = [];
		for (const op of planned) {
			if (op.kind === 'create') {
				const after = behind(op.after);
				if (tooBig(op)) left[op.uid] = after;
				else ops.push({ ...op, after });
			} else if (op.kind === 'reorder') {
				ops.push({ ...op, after: behind(op.after) });
			} else if (!tooBig(op)) {
				ops.push(op);
			}
		}
		return ops;
	}

	/** What reaches the API is worked out when the trip leaves, not when it was asked for. */
	function run(write: Write): Promise<void> {
		const trip = inFlight.then(async () => {
			const planned = planSave(write.rows, write.next);
			if (planned.length === 0) return;
			const ops = withinBudget(planned);
			await runSave(ops, write.rows, write.next, {
				create: (request) =>
					onCreate({
						node: write.note,
						content: request.content,
						...(request.after ? { after: request.after } : {})
					}).then((created) => ({ ref: created.ref, updated_at: created.updated_at })),
				update: (ref, content, expects) =>
					onUpdate(ref, { content, ...(expects ? { expects } : {}) }).then((row) => row.updated_at),
				reorder: (ref, after) => onReorder(ref, after).then((row) => row.updated_at),
				remove: (ref) => onRemove(ref),
				placed: (uid, ref) => {
					stamp(write.from, uid, ref);
					// The row is there from this moment, so what the device holds names
					// it rather than asking for the section a second time.
					const made = write.next.find((block) => block.uid === uid);
					if (made) made.ref = ref;
					if (write.kept > 0) {
						write.kept = drafts.keep(
							write.note,
							{ rows: write.rows, next: write.next },
							write.kept
						);
					}
				}
			});
			if (ops.length < planned.length) {
				throw new SaveFailure(
					'refused',
					`That section is too big to save. The limit here is ${SECTION_LIMIT_BYTES / (1024 * 1024)} MB — take something out of it, or start a new section for the rest.`
				);
			}
		});
		inFlight = trip.catch(() => undefined);
		return trip;
	}

	/** What the person is told, and whether Sloppy keeps trying on its own. A
	 *  refusal arrives with words of its own; the rest are this surface's to say. */
	function troubleWith(error: unknown): { trouble: SaveTrouble; says: string } {
		const failure = error instanceof SaveFailure ? error : null;
		switch (failure?.trouble) {
			case 'refused':
				return { trouble: 'refused', says: failure.message || 'Sloppy cannot save this note.' };
			case 'elsewhere':
				return { trouble: 'elsewhere', says: 'This note was also written somewhere else.' };
			default:
				return { trouble: 'transient', says: 'Sloppy will keep trying to save this note.' };
		}
	}

	/** A note left before this surface had read what the device holds: its last
	 *  writing was never put there, so whatever of it the API did not take goes
	 *  there once the trip settles — unless the device is holding a draft of its
	 *  own that no surface has read. */
	async function holdOnLeaving(write: Write): Promise<void> {
		await drafts.settled(write.note);
		if (planSave(write.rows, write.next).length === 0) return;
		if (await drafts.read(write.note)) return;
		write.kept = drafts.keep(write.note, { rows: write.rows, next: write.next });
	}

	function scheduleSave(delay: number): void {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => void save(), delay);
	}

	/** A change waits for the writing to pause, but never past its own deadline. */
	function saveSoon(): void {
		touched = true;
		changedAt ||= Date.now();
		scheduleSave(Math.max(0, Math.min(SAVE_AFTER_MS, changedAt + SAVE_WITHIN_MS - Date.now())));
	}

	async function save(): Promise<void> {
		if (saving) {
			again = true;
			return;
		}
		const write = plan();
		if (!write) return;
		const mine = era;
		saving = true;
		changedAt = 0;
		saveState = 'saving';
		try {
			await run(write);
			if (mine === era) {
				saveState = 'saved';
				failed = null;
				drafts.landed(write.note);
				// Nothing was written while the trip was in the air, so what the
				// device was holding for this note is now the note.
				if (changedAt === 0 && !again && readHeld) drafts.forget(write.note, write.kept);
			}
		} catch (error: unknown) {
			if (mine === era) {
				saveState = 'idle';
				failed = troubleWith(error);
				if (failed.trouble === 'transient') scheduleSave(RETRY_AFTER_MS);
			}
		} finally {
			saving = false;
			write.arrived();
		}
		if (again && mine === era) {
			again = false;
			scheduleSave(0);
		}
	}

	/** Everything resting — a stroke, a keystroke — written now rather than on a timer. */
	function flush(): void {
		clearTimeout(settling);
		settle();
		clearTimeout(saveTimer);
		void save();
	}

	function whenHidden(): void {
		if (document.visibilityState === 'hidden') flush();
	}

	/** Writes back which row a just-created block became, without waking a save. */
	function stamp(from: Editor, uid: string, ref: OwnedRef): void {
		if (from.isDestroyed) return;
		let tr: ReturnType<typeof from.state.tr.setNodeMarkup> | null = null;
		from.state.doc.forEach((child, pos) => {
			if (child.attrs.blockUid !== uid || child.attrs.blockRef === ref) return;
			tr = (tr ?? from.state.tr).setNodeMarkup(pos, undefined, {
				...child.attrs,
				blockRef: ref
			});
		});
		if (!tr) return;
		// Writing the ref onto the section draws it again, and a field an element
		// keeps inside it — a formula's source, a drawing's description — is taken
		// out of the page and put back, which drops whoever was typing in it.
		const writing = document.activeElement;
		from.view.dispatch(quiet(tr));
		if (writing instanceof HTMLElement && writing.isConnected) writing.focus();
	}

	/** A change to the document that is bookkeeping, not writing. */
	function quiet<T extends { setMeta: (key: string, value: unknown) => T }>(tr: T): T {
		return tr.setMeta('addToHistory', false).setMeta('preventUpdate', true);
	}

	/**
	 * Turns the shortcodes a note is stored with back into the emoji they name.
	 * Code is left as it was written: `:fire:` in a snippet is part of the snippet.
	 *
	 * Runs again for every catalog that lands after the note opened, and an emoji
	 * already drawn is part of what it re-reads: a note opens before its author's
	 * catalog answers, so a shortcode Unicode also claims is a glyph by the time
	 * the picture it names arrives.
	 */
	function showEmoji(current: Editor): void {
		const literal = (child: ProseMirrorNode) =>
			child.type.spec.code === true || child.marks.some((mark) => mark.type.spec.code === true);
		let tr: ReturnType<typeof current.state.tr.replaceWith> | null = null;
		current.state.doc.descendants((child, pos) => {
			if (literal(child)) return false;
			if (child.type.name === EMOJI_NODE) {
				const claimed = reclaimEmoji(child.attrs, catalog);
				if (claimed) {
					tr ??= current.state.tr;
					tr.setNodeMarkup(tr.mapping.map(pos), undefined, claimed);
				}
				return false;
			}
			if (!child.isText || !child.text) return;
			for (const token of tokenizeContent(child.text, catalog)) {
				if (token.kind !== 'emoji') continue;
				const entry = emojiInsert(token.emoji, token.sticker);
				tr ??= current.state.tr;
				tr.replaceWith(
					tr.mapping.map(pos + token.start),
					tr.mapping.map(pos + token.end),
					current.schema.nodes.emoji.create({
						name: entry.shortcode,
						char: entry.char,
						src: entry.src,
						sticker: entry.sticker
					})
				);
			}
		});
		if (tr) current.view.dispatch(quiet(tr));
	}

	// A tap on the toolbar takes focus off the writing surface for an instant, and
	// on touch there is no mousedown to refuse — so the bar outlives the blur.
	let leaving: ReturnType<typeof setTimeout> | undefined;
	function keepToolbar(): void {
		clearTimeout(leaving);
		editing = true;
	}
	function dropToolbar(): void {
		clearTimeout(leaving);
		leaving = setTimeout(() => (editing = false), 200);
	}

	function refreshMarks(): void {
		const current = editor;
		if (!current) return;
		marks = {
			bold: current.isActive('bold'),
			italic: current.isActive('italic'),
			h1: current.isActive('heading', { level: 1 }),
			h2: current.isActive('heading', { level: 2 }),
			bullet: current.isActive('bulletList'),
			ordered: current.isActive('orderedList'),
			todo: current.isActive('taskList'),
			quote: current.isActive('blockquote'),
			code: current.isActive('codeBlock')
		};
	}

	// ── Pictures ─────────────────────────────────────────────────────────────
	/** Every send still in the air, by the preview that stands in for it. */
	let sending: Record<string, { cancel: () => void }> = {};

	/** Writes back onto the node a send is filling, without waking a save. */
	function retouch(from: Editor, preview: string, attrs: Record<string, unknown>): boolean {
		if (from.isDestroyed) return false;
		let tr: ReturnType<typeof from.state.tr.setNodeMarkup> | null = null;
		from.state.doc.descendants((child, pos) => {
			if (child.type.name !== PICTURE_NODE || child.attrs.preview !== preview) return;
			tr = (tr ?? from.state.tr).setNodeMarkup(pos, undefined, { ...child.attrs, ...attrs });
		});
		if (!tr) return false;
		from.view.dispatch(quiet(tr));
		return true;
	}

	/** The file is on the page at once and in the note only when it has landed —
	 *  `storedPicture` in `./picture-node.ts` is what leaves one with nothing to
	 *  name out of what is written down. */
	function sendPicture(file: File): void {
		const current = editor;
		if (!current) return;
		const preview = URL.createObjectURL(file);
		current.chain().focus().insertPicture({ preview }).run();

		let live: { cancel: () => void } | null = null;
		let stopped = false;
		sending[preview] = {
			cancel: () => {
				stopped = true;
				live?.cancel();
			}
		};

		void (async () => {
			try {
				const bytes = await fitted(file, NOTE_PX);
				if (stopped) return;
				const send = media.send(bytes, (fraction) =>
					retouch(current, preview, { progress: fraction })
				);
				live = send;
				const asset = await send.asset;
				const placed = retouch(current, preview, {
					upload_id: asset.upload_id,
					width: asset.width ?? null,
					height: asset.height ?? null,
					progress: null
				});
				if (placed) saveSoon();
			} catch (error: unknown) {
				retouch(current, preview, {
					progress: null,
					failure:
						error instanceof Error && error.message
							? error.message
							: 'That picture could not be added. Remove it and try again.'
				});
			} finally {
				delete sending[preview];
			}
		})();
	}

	function usePicture(picture: HeldPicture): void {
		editor
			?.chain()
			.focus()
			.insertPicture({
				upload_id: picture.upload_id,
				width: picture.width ?? null,
				height: picture.height ?? null
			})
			.run();
		saveSoon();
	}

	// ── The pen ──────────────────────────────────────────────────────────────
	let stroke: StrokeInProgress | null = null;
	let settling: ReturnType<typeof setTimeout> | undefined;
	let pending: InkStroke[] = [];
	/** Where the samples drawn ahead of the nib were left, so the next real one
	 *  lifts them; null where none are on the surface. */
	let ahead: InkBounds | null = null;
	/** The box the note is read in, resolved with the surface it belongs to. */
	let reading: HTMLElement | null = null;

	function scrollerOf(from: HTMLElement): HTMLElement | null {
		for (let parent = from.parentElement; parent; parent = parent.parentElement) {
			const flow = getComputedStyle(parent).overflowY;
			if (flow === 'auto' || flow === 'scroll') return parent;
		}
		return null;
	}

	/** A stroke is held where it was drawn in the note, so the view can scroll
	 *  under it between the pen lifting and the drawing settling. */
	function penSurface(): InkSurface {
		const rect = surface!.getBoundingClientRect();
		return { left: rect.left, top: rect.top, scale: 1 };
	}

	/**
	 * The canvas laid over as much of the note as is on screen, so what it costs
	 * is the size of the screen rather than the length of the note. `box` is where
	 * it sits in the note, which is the space the pen's points are in.
	 */
	function penContext(): { ctx: CanvasRenderingContext2D; box: InkBounds } | null {
		if (!wet || !surface) return null;
		const rect = surface.getBoundingClientRect();
		const view = reading?.getBoundingClientRect();
		const seen = {
			top: Math.max(0, view?.top ?? 0),
			bottom: Math.min(window.innerHeight, view?.bottom ?? window.innerHeight)
		};
		const top = Math.max(0, Math.min(seen.top, rect.bottom) - rect.top);
		const bottom = Math.max(top, Math.min(seen.bottom, rect.bottom) - rect.top);
		if (wet.style.top !== `${top}px`) wet.style.top = `${top}px`;
		if (wet.style.height !== `${bottom - top}px`) wet.style.height = `${bottom - top}px`;
		const ctx = prepareCanvas(wet, rect.width, bottom - top, { left: 0, top });
		if (!ctx) return null;
		ctx.strokeStyle = getComputedStyle(wet).color;
		ctx.fillStyle = ctx.strokeStyle;
		return { ctx, box: { left: 0, top, right: rect.width, bottom } };
	}

	function repaintPen(): void {
		const prepared = penContext();
		if (!prepared) return;
		const { ctx, box } = prepared;
		ctx.clearRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
		ahead = null;
		for (const done of pending) drawStroke(ctx, done, 1);
		if (stroke) drawStroke(ctx, { points: stroke.points, width: stroke.width }, 1);
	}

	/** The note moved under the canvas. Nothing is on it until a pen touches the
	 *  surface, and pen-down lays it over what is on screen by then. */
	function viewMoved(): void {
		if (stroke || pending.length > 0) repaintPen();
	}

	function onPenDown(event: PointerEvent): void {
		if (event.pointerType !== 'pen' || !surface || !wet || !editor) return;
		if ((event.target as HTMLElement | null)?.closest('[data-ink-block],[data-block-handle]'))
			return;
		event.preventDefault();
		clearTimeout(settling);
		capturePointer(surface, event.pointerId);
		stroke = new StrokeInProgress(event, penSurface(), NIB_WIDTH);
		repaintPen();
	}

	function onPenMove(event: PointerEvent): void {
		if (!stroke || !surface) return;
		event.preventDefault();
		const prepared = penContext();
		const live = { points: stroke.points, width: stroke.width };
		if (prepared && ahead) {
			redrawWithin(prepared.ctx, [...pending, live], 1, ahead);
			ahead = null;
		}
		const on = penSurface();
		const before = stroke.points.length;
		stroke.extend(event, on);
		if (!prepared) return;
		drawStroke(prepared.ctx, live, 1, Math.max(1, before));
		ahead = drawAhead(prepared.ctx, live, stroke.predict(event, on), 1);
	}

	function onPenUp(): void {
		const done = stroke?.finish();
		stroke = null;
		if (!done) return;
		pending = [...pending, done];
		// The mark left standing is the stroke as it was kept, with nothing drawn
		// ahead of the nib still on it.
		repaintPen();
		clearTimeout(settling);
		settling = setTimeout(settle, SETTLE_AFTER_MS);
	}

	/** Where in the note the ink was drawn: after the element its top sits on,
	 *  inside that element's section. */
	function positionFor(y: number): number {
		const current = editor!;
		try {
			const rect = surface!.getBoundingClientRect();
			const found = current.view.posAtCoords({ left: rect.left + 8, top: rect.top + y });
			if (!found) return endOfNote(current.state);
			return afterElement(current.state.doc.resolve(found.pos)) ?? endOfNote(current.state);
		} catch {
			return endOfNote(current.state);
		}
	}

	function settle(): void {
		const strokes = pending;
		pending = [];
		repaintPen();
		if (!editor || editor.isDestroyed || strokes.length === 0) return;
		const bounds = strokeBounds(strokes);
		if (!bounds) return;
		const top = Math.max(0, bounds.top - INK_PADDING);
		const width = Math.max(1, Math.round(surface!.getBoundingClientRect().width));
		const height = Math.max(80, Math.ceil(bounds.bottom + INK_PADDING - top));
		editor.commands.insertContentAt(positionFor(bounds.top), {
			type: 'ink',
			attrs: { width, height, strokes: translateStrokes(strokes, 0, -top) }
		});
	}

	/** Puts the caret in the writing, for a field above the note to hand the
	 *  keyboard on to. */
	export function focusBody(at: 'start' | 'end' = 'start'): void {
		editor?.commands.focus(at);
	}

	/** Puts writing somebody arrived with into the section this note opened on,
	 *  from where it saves the way everything typed here saves. A note that
	 *  already says something keeps what it says. */
	export function carry(text: string): void {
		const current = editor;
		if (!current || current.isDestroyed || !current.isEmpty) return;
		const section = textSection(text);
		if (!section) return;
		// The save waits on the update this emits, and nothing else would wake it.
		current.commands.setContent({ type: 'doc', content: [section] }, { emitUpdate: true });
	}

	// ── The surface, rebuilt only when it is a different note ────────────────
	$effect(() => {
		const opening = node.ref;
		const element = host;
		const frame = surface;
		if (!element || !frame) return;
		return untrack(() => {
			writingTo = opening;
			const created = new Editor({
				element,
				extensions: [
					// A link in one's own writing is text to put the caret in, not
					// somewhere to be sent from mid-sentence.
					StarterKit.configure({
						document: false,
						link: { openOnClick: false, protocols: [CODE_PROTOCOL] }
					}),
					NoteDocument,
					SectionNode,
					TaskList,
					TaskItem.configure({ nested: true }),
					...(arranging ? [BlockHandles.configure({ onSection: openSectionMenu })] : []),
					EmojiNode(() => catalog),
					EmojiSuggestion(completions, () => ownCatalog),
					ReferenceNode(() => references),
					ReferenceSuggestion(noteCompletions, () => references),
					CompassNode(
						() => references,
						() => node
					),
					CodeAnchors(() => code),
					InkNode,
					PictureNode(() => media),
					...DRAWN_ELEMENTS
				],
				editorProps: {
					attributes: { class: 'sloppy-prose', role: 'textbox', 'aria-label': 'Note body' },
					// The caret is scrolled clear of the controls, which sit over the
					// last of the writing whenever there is more of it than fits.
					scrollMargin: { top: 0, right: 0, bottom: BAR_CLEARANCE, left: 0 }
				},
				onUpdate: () => {
					empty = created.isEmpty;
					refreshMarks();
					saveSoon();
				},
				onFocus: keepToolbar,
				onBlur: dropToolbar,
				onSelectionUpdate: refreshMarks
			});
			editor = created;
			inFlight = Promise.resolve();
			const stack = blocks;
			const open = (from: Opened) => {
				created.commands.setContent(from.doc, { emitUpdate: false });
				showEmoji(created);
				saved = from.baseline(docBlocks(created.state.doc));
				empty = created.isEmpty;
			};
			open(openBlocks(stack, created.schema));
			ready = true;
			saveState = 'idle';
			failed = null;
			refreshMarks();

			let opened = true;
			readHeld = false;
			touched = false;
			void (async () => {
				await drafts.settled(opening);
				const held = await drafts.read(opening);
				if (!opened || created.isDestroyed) return;
				readHeld = true;
				if (!held) return;
				// Writing done here since the note opened is what stands, so the draft
				// goes in beside it rather than opening over it.
				if (touched) {
					for (const { at, sections } of heldApart(held, created.state.doc, created.schema)) {
						created.commands.insertContentAt(at, sections, { updateSelection: false });
					}
				} else {
					open(openDraft(held, stack, created.schema));
				}
				refreshMarks();
				saveSoon();
			})();

			// Listened for rather than bound: the surface is a writing area, not a
			// control, and the pen handlers must be able to refuse the browser's
			// default (a caret, a selection drag) on the way down.
			frame.addEventListener('pointerdown', onPenDown, { capture: true });
			frame.addEventListener('pointermove', onPenMove);
			frame.addEventListener('pointerup', onPenUp);
			frame.addEventListener('pointercancel', onPenUp);
			reading = scrollerOf(frame);
			// Caught on the way down: the box the note is read in scrolls, and a
			// scroll does not carry up to the window.
			window.addEventListener('scroll', viewMoved, { capture: true, passive: true });

			return () => {
				opened = false;
				for (const send of Object.values(sending)) send.cancel();
				sending = {};
				frame.removeEventListener('pointerdown', onPenDown, { capture: true });
				frame.removeEventListener('pointermove', onPenMove);
				frame.removeEventListener('pointerup', onPenUp);
				frame.removeEventListener('pointercancel', onPenUp);
				window.removeEventListener('scroll', viewMoved, { capture: true });
				clearTimeout(settling);
				settle();
				const last = plan();
				const knew = readHeld;
				era += 1;
				again = false;
				saving = false;
				changedAt = 0;
				clearTimeout(saveTimer);
				pending = [];
				stroke = null;
				ahead = null;
				reading = null;
				ready = false;
				editing = false;
				editor = null;
				created.destroy();
				// The last write of a note being left. No surface stays open for it
				// to be reported on, so the device holds the writing until it lands,
				// and the note opens from there when it does not.
				if (last) {
					if (!knew) void holdOnLeaving(last);
					void run(last)
						.then(
							() => {
								if (knew) drafts.forget(last.note, last.kept);
							},
							() => undefined
						)
						.finally(last.arrived);
				}
			};
		});
	});

	// The caret menu never takes the focus — the keys it answers are spent inside
	// the editor — so the writing is what says a list is open and which row Enter
	// would take.
	$effect(() => {
		const writing = ready ? editor?.view.dom : null;
		if (!writing) return;
		const shown = noteCompletions.open
			? {
					menu: CARET_MENU.notes,
					index: noteCompletions.index,
					rows: noteCompletions.making === null ? noteCompletions.items.length : 0
				}
			: completions.open
				? { menu: CARET_MENU.emoji, index: completions.index, rows: completions.items.length }
				: null;
		writing.setAttribute('aria-expanded', String(shown !== null));
		if (shown) writing.setAttribute('aria-controls', shown.menu);
		else writing.removeAttribute('aria-controls');
		if (shown && shown.rows > 0) {
			writing.setAttribute('aria-activedescendant', caretOptionId(shown.menu, shown.index));
		} else {
			writing.removeAttribute('aria-activedescendant');
		}
	});

	// A catalog fetched after the note opened turns its shortcodes into pictures
	// then, rather than on the next time the note is opened.
	$effect(() => {
		const entries = catalog;
		if (!ready || entries.length === 0) return;
		const current = editor;
		if (current) untrack(() => showEmoji(current));
	});

	function insertEmoji(entry: EmojiEntry, large: boolean): void {
		editor
			?.chain()
			.focus()
			.insertEmoji(emojiInsert(entry, citedLarge(entry, large)))
			.run();
	}

	async function addEmoji(entry: {
		file: File;
		shortcode: string;
		kind: 'emoji' | 'sticker';
	}): Promise<void> {
		await emoji.add(entry);
		emojiCatalogs.forget(emoji.mine);
	}

	async function removeEmoji(id: string): Promise<void> {
		await emoji.remove(id);
		emojiCatalogs.forget(emoji.mine);
	}

	function startDrawing(): void {
		if (!editor || !wet) return;
		const width = Math.max(1, Math.round(wet.getBoundingClientRect().width));
		editor.chain().focus().insertInk({ width, height: NEW_INK_HEIGHT }).run();
	}

	function addSection(): void {
		editor?.chain().focus().addSection().run();
	}

	function openSectionMenu(section: SectionActs): void {
		acts = section;
		actsOpen = true;
	}

	// The handle is plain DOM inside the writing surface; only here is it known
	// whether the menu it asked for is up.
	$effect(() => {
		const anchor = acts?.anchor;
		if (!anchor) return;
		anchor.setAttribute('aria-expanded', String(actsOpen));
		return () => anchor.removeAttribute('aria-expanded');
	});

	type Lost = Exclude<SectionHolds, 'empty'>;

	const SECTION_GOES: Record<Lost, string> = {
		writing: 'This section and everything written in it goes from the note.',
		drawing: 'This section and the drawing in it goes from the note.',
		picture: 'This section and the picture in it goes from the note.',
		several: 'This section and everything in it goes from the note.'
	};

	function removeSection(section: SectionActs): void {
		if (section.holds === 'empty') {
			section.remove();
			return;
		}
		losing = section.holds;
		takeSection = section.remove;
		removingSection = true;
	}

	const sectionMenu = $derived.by<NoteMenuItem[]>(() => {
		const on = acts;
		if (!on) return [];
		return [
			...(on.moveUp ? [{ label: 'Move up', icon: ArrowUp, onSelect: on.moveUp }] : []),
			...(on.moveDown ? [{ label: 'Move down', icon: ArrowDown, onSelect: on.moveDown }] : []),
			{
				label: 'Remove section',
				icon: Trash2,
				destructive: true,
				onSelect: () => removeSection(on)
			}
		];
	});

	/** Everything after this is the menu `[[` already opens. */
	function citeNote(): void {
		editor?.chain().focus().insertContent('[[').run();
	}

	/** A place in the code, put down as the link it is, with the caret left
	 *  after it rather than inside it. */
	async function citeCode(): Promise<void> {
		const anchor = await code?.cite();
		if (!anchor || !editor || editor.isDestroyed) return;
		editor
			.chain()
			.focus()
			.insertContent([
				{
					type: 'text',
					text: anchorLabel(anchor),
					marks: [{ type: 'link', attrs: { href: codeHref(anchor) } }]
				},
				{ type: 'text', text: ' ' }
			])
			.run();
	}

	const formatting = $derived<EditorAction[]>([
		{
			id: 'bold',
			label: 'Bold',
			icon: Bold,
			on: marks.bold,
			run: () => editor?.chain().focus().toggleBold().run()
		},
		{
			id: 'italic',
			label: 'Italic',
			icon: Italic,
			on: marks.italic,
			run: () => editor?.chain().focus().toggleItalic().run()
		},
		{
			id: 'h1',
			label: 'Heading',
			icon: Heading1,
			on: marks.h1,
			run: () => editor?.chain().focus().toggleHeading({ level: 1 }).run()
		},
		{
			id: 'h2',
			label: 'Subheading',
			icon: Heading2,
			on: marks.h2,
			run: () => editor?.chain().focus().toggleHeading({ level: 2 }).run()
		},
		{
			id: 'bullet',
			label: 'Bulleted list',
			icon: ListIcon,
			on: marks.bullet,
			run: () => editor?.chain().focus().toggleBulletList().run()
		},
		{
			id: 'ordered',
			label: 'Numbered list',
			icon: ListOrdered,
			on: marks.ordered,
			run: () => editor?.chain().focus().toggleOrderedList().run()
		},
		{
			id: 'todo',
			label: 'Checklist',
			icon: ListChecks,
			on: marks.todo,
			run: () => editor?.chain().focus().toggleTaskList().run()
		},
		{
			id: 'quote',
			label: 'Quote',
			icon: Quote,
			on: marks.quote,
			run: () => editor?.chain().focus().toggleBlockquote().run()
		},
		{
			id: 'code',
			label: 'Code',
			icon: Code,
			on: marks.code,
			run: () => editor?.chain().focus().toggleCodeBlock().run()
		}
	]);

	const inserts = $derived<EditorAction[]>([
		{ id: 'cite', label: 'Cite a note', icon: Brackets, run: citeNote },
		...(code
			? [{ id: 'code', label: 'Cite code', icon: FileCode, run: () => void citeCode() }]
			: []),
		{ id: 'picture', label: 'Picture', icon: ImageIcon, run: () => (mediaOpen = true) },
		{ id: 'emoji', label: 'Emoji', icon: Smile, run: () => (pickerOpen = true) },
		{ id: 'draw', label: 'Draw', icon: PenLine, run: startDrawing },
		// Both leave the caret in the source they open, so `focus()` is left out of
		// the chain: it takes the caret back to the writing a frame later.
		{
			id: 'formula',
			label: 'Formula',
			icon: Sigma,
			run: () => editor?.commands.insertMathBlock()
		},
		{
			id: 'diagram',
			label: 'Diagram',
			icon: Workflow,
			run: () => editor?.commands.insertDiagram()
		},
		{
			id: 'compass',
			label: 'Compass',
			icon: Compass,
			run: () => editor?.commands.insertCompass()
		}
	]);
</script>

<svelte:window onresize={viewMoved} onpagehide={flush} />
<svelte:document onvisibilitychange={whenHidden} />

<div
	class="note-body space-y-2"
	class:no-gutter={!arranging}
	data-code-anchors={code ? '' : undefined}
>
	<div class="block-gutter">
		<div bind:this={surface} class="relative">
			<div bind:this={host}></div>
			<canvas
				bind:this={wet}
				class="pointer-events-none absolute left-0 w-full text-foreground"
				style="top: 0px; height: 0px"
				aria-hidden="true"
			></canvas>
			{#if empty && ready}
				<p
					class="pointer-events-none absolute top-0 left-0 text-base text-muted-foreground select-none"
					aria-hidden="true"
				>
					Start writing.
				</p>
			{/if}
		</div>
	</div>

	<Button variant="ghost" class="add-section" onclick={addSection}>
		<Plus aria-hidden="true" />
		Add a section
	</Button>

	<p class="min-h-5 text-right text-xs text-muted-foreground" role="status">
		{#if saveState !== 'idle'}
			{#if offering}
				Kept here until you offer it
			{:else if saveState === 'saving'}
				Saving…
			{:else}
				Saved
			{/if}
		{/if}
	</p>

	{#if failed}
		<div
			class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"
			role="alert"
		>
			<span>{failed.says}</span>
			{#if failed.trouble === 'transient'}
				<Button variant="outline" size="sm" onclick={() => scheduleSave(0)}>Try now</Button>
			{/if}
		</div>
	{/if}

	<!-- Inside the writing surface: a bar over the viewport covers whatever the
	     page puts under the note, at every width, with no scroll that reaches it. -->
	{#if ready && editing}
		<div
			class="sticky lift-above-keyboard z-40 mx-auto w-full max-w-[34rem] rounded-full border bg-card/95 px-1.5 py-1 shadow-lg backdrop-blur"
		>
			<Toolbar {formatting} {inserts} />
		</div>
	{/if}
</div>

{#if ready}
	<EmojiSuggestionPopup {completions} />
	<ReferenceSuggestionPopup completions={noteCompletions} />
{/if}
<EmojiPicker
	bind:open={pickerOpen}
	custom={ownCatalog}
	onpick={insertEmoji}
	onadd={addEmoji}
	onremove={removeEmoji}
/>
<MediaPicker
	bind:open={mediaOpen}
	{media}
	onpick={(choice) => ('file' in choice ? sendPicture(choice.file) : usePicture(choice.held))}
	onremove={(picture) => media.remove(picture.upload_id)}
/>
<NoteMenu
	bind:open={actsOpen}
	title={acts?.title ?? ''}
	anchor={acts?.anchor ?? null}
	items={sectionMenu}
/>
<ConfirmModal
	bind:open={removingSection}
	title="Remove this section?"
	description={SECTION_GOES[losing]}
	confirmLabel="Remove"
	onconfirm={() => {
		takeSection?.();
		takeSection = null;
	}}
/>

<style>
	.note-body {
		--block-gutter: 1.75rem;
		--block-line: 1.75rem;
	}
	.note-body.no-gutter {
		--block-gutter: 0rem;
	}
	.block-gutter {
		padding-left: var(--block-gutter);
	}
	:global(.sloppy-prose) {
		outline: none;
		font-size: 1rem;
		line-height: 1.7;
	}
	/* A section is a ruled band, and the rule is the only structure the note
	   draws — DESIGN.md § "A block reads as a section". */
	:global(.sloppy-prose > section) {
		padding-block: 0.6rem;
		border-bottom: 1px solid var(--border);
	}
	:global(.sloppy-prose > section:last-of-type) {
		border-bottom: none;
	}
	:global(.sloppy-prose section > * + *) {
		margin-top: 0.85em;
	}
	/* The gap above a section is taken by the handle standing in it, so the
	   handle sits on the section's first line rather than in the space above it. */
	:global(.sloppy-prose > .sloppy-row + *) {
		margin-top: 0;
	}
	:global(.add-section) {
		width: 100%;
		justify-content: flex-start;
		color: var(--muted-foreground);
		padding-left: var(--block-gutter, 1.75rem);
	}
	:global(.sloppy-row) {
		position: relative;
		height: 0;
	}
	:global(.sloppy-row-handle) {
		position: absolute;
		top: 0;
		left: calc(var(--block-gutter, 1.75rem) * -1);
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: var(--block-line, 1.75rem);
		border-radius: calc(var(--radius) - 4px);
		color: var(--muted-foreground);
		opacity: 0.4;
		cursor: grab;
		/* A swipe from here still scrolls the note; `./block-handles.ts` takes the
		   gesture only once the press has been held. iOS answers that press with
		   a callout of its own unless it is told not to. */
		touch-action: pan-y;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
		transition:
			opacity 150ms ease-out,
			background-color 150ms ease-out;
	}
	@media (prefers-reduced-motion: reduce) {
		:global(.sloppy-row-handle) {
			transition: none;
		}
	}
	/* A drag is a sustained contact, so the whole gutter is the target and the
	   gutter widens to hold one a finger can find. The grip drawn inside it keeps
	   its size, and stays on the line of the section it moves. */
	@media (any-pointer: coarse) {
		.note-body {
			--block-gutter: 2.5rem;
		}
		:global(.sloppy-row-handle) {
			width: var(--block-gutter);
			height: var(--block-gutter);
			top: calc((var(--block-line, 1.75rem) - var(--block-gutter, 1.75rem)) / 2);
		}
	}
	:global(.sloppy-row-handle:hover),
	:global(.sloppy-row-handle:focus-visible),
	:global(.sloppy-row-handle.is-dragging) {
		opacity: 1;
		background: var(--muted);
	}
	:global(.sloppy-row-handle.is-dragging) {
		cursor: grabbing;
	}
	:global(.sloppy-row-handle:focus-visible) {
		outline: 2px solid var(--ring);
		outline-offset: 1px;
	}
	:global(.sloppy-row-handle svg) {
		width: 1rem;
		height: 1rem;
	}
	:global(.sloppy-drop-line) {
		position: fixed;
		z-index: 50;
		height: 2px;
		border-radius: 1px;
		background: var(--primary);
		pointer-events: none;
	}
	:global(.sloppy-prose h1) {
		font-size: 1.5rem;
		font-weight: 600;
		line-height: 1.25;
		letter-spacing: -0.01em;
	}
	:global(.sloppy-prose h2) {
		font-size: 1.2rem;
		font-weight: 600;
	}
	:global(.sloppy-prose h3) {
		font-size: 1.05rem;
		font-weight: 600;
	}
	:global(.sloppy-prose ul),
	:global(.sloppy-prose ol) {
		padding-left: 1.35em;
	}
	:global(.sloppy-prose ul) {
		list-style: disc;
	}
	:global(.sloppy-prose ol) {
		list-style: decimal;
	}
	:global(.sloppy-prose li > p) {
		margin: 0;
	}
	:global(.sloppy-prose ul[data-type='taskList']) {
		list-style: none;
		padding-left: 0;
	}
	:global(.sloppy-prose ul[data-type='taskList'] li) {
		display: flex;
		align-items: flex-start;
		gap: 0.55em;
	}
	:global(.sloppy-prose ul[data-type='taskList'] input) {
		margin-top: 0.42em;
		accent-color: var(--primary);
		width: 1em;
		height: 1em;
	}
	:global(.sloppy-prose blockquote) {
		border-left: 2px solid var(--border);
		padding-left: 0.9em;
		color: var(--muted-foreground);
	}
	:global(.sloppy-prose pre) {
		background: var(--muted);
		border-radius: var(--radius);
		padding: 0.75em 0.9em;
		overflow-x: auto;
		font-size: 0.875em;
	}
	:global(.sloppy-prose code) {
		font-family: var(--font-mono);
		font-size: 0.9em;
	}
	:global(.sloppy-prose hr) {
		border: none;
		border-top: 1px solid var(--border);
	}
	:global(.sloppy-prose a) {
		color: var(--primary);
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}
	:global(.sloppy-reference) {
		cursor: pointer;
	}
	/* An anchor into code is a chip in the sentence rather than a link to a
	   page, and carries the mark that says so — DESIGN.md § "An anchor into
	   code". It is drawn only where there is code beside the graph; anywhere
	   else it is the ordinary link it has always been. */
	:global([data-code-anchors] .sloppy-prose a[href^='code:']) {
		color: inherit;
		text-decoration: none;
		cursor: pointer;
		border-radius: calc(var(--radius) - 6px);
		background: var(--muted);
		padding-inline: 0.3em 0.4em;
		/* The chip wraps inside the paragraph rather than truncating the sentence
		   around it, and keeps its ends on both lines when it does. */
		box-decoration-break: clone;
		-webkit-box-decoration-break: clone;
	}
	:global([data-code-anchors] .sloppy-prose a[href^='code:'])::before {
		content: '';
		display: inline-block;
		width: 0.85em;
		height: 0.85em;
		margin-right: 0.3em;
		vertical-align: -0.09em;
		background: currentColor;
		opacity: 0.65;
		mask: var(--code-anchor-mark) center / contain no-repeat;
		-webkit-mask: var(--code-anchor-mark) center / contain no-repeat;
	}
	.note-body {
		--code-anchor-mark: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M9 6 3 12l6 6M15 6l6 6-6 6'/%3E%3C/svg%3E");
	}
	:global(.sloppy-reference.is-gone) {
		color: var(--muted-foreground);
		text-decoration-style: dotted;
		cursor: default;
	}
	:global(.sloppy-reference:focus-visible) {
		outline: 2px solid var(--ring);
		outline-offset: 1px;
		border-radius: calc(var(--radius) - 6px);
	}
	:global(.sloppy-emoji) {
		font-size: 1.15em;
		line-height: 1;
	}
	:global(.sloppy-sticker) {
		display: inline-block;
		font-size: 3.25em;
		line-height: 1.1;
	}
	:global(.sloppy-emoji-picture) {
		/* Tailwind's preflight draws every img as a block, which would put an
		   emoji on a line of its own in the middle of a sentence. */
		display: inline-block;
		font-size: 1em;
		width: auto;
		height: 1.35em;
		vertical-align: -0.3em;
		object-fit: contain;
	}
	:global(.sloppy-sticker.sloppy-emoji-picture) {
		height: 3.25em;
		vertical-align: -0.6em;
	}
	:global(.sloppy-picture) {
		margin: 0.85em 0;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
		background: var(--card);
	}
	:global(.sloppy-picture.is-selected) {
		outline: 2px solid color-mix(in oklab, var(--primary) 60%, transparent);
		outline-offset: 2px;
	}
	:global(.sloppy-picture-frame) {
		position: relative;
		line-height: 0;
	}
	:global(.sloppy-picture-image) {
		display: block;
		width: 100%;
		height: auto;
		max-height: 70dvh;
		object-fit: contain;
	}
	:global(.sloppy-picture-image:not([src])) {
		display: none;
	}
	:global(.sloppy-picture.is-sending .sloppy-picture-image) {
		opacity: 0.55;
	}
	:global(.sloppy-picture-note) {
		margin: 0;
		padding: 0.5rem 0.65rem;
		font-size: 0.8125rem;
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	:global(.sloppy-picture-note:empty) {
		display: none;
	}
	:global(.sloppy-picture-meter) {
		position: absolute;
		inset-inline: 0;
		bottom: 0;
		height: 3px;
		background: var(--muted);
	}
	:global(.sloppy-picture-meter > span) {
		display: block;
		height: 100%;
		background: var(--primary);
		transition: width 0.15s ease-out;
	}
	:global(.sloppy-picture-bar) {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		border-top: 1px solid var(--border);
		padding: 0.25rem;
	}
	:global(.sloppy-picture-description) {
		flex: 1 1 auto;
		min-width: 0;
		border: 0;
		background: transparent;
		padding: 0.25rem 0.55rem;
		font-size: 0.75rem;
		color: var(--foreground);
		outline: none;
	}
	:global(.sloppy-picture-description::placeholder) {
		color: var(--muted-foreground);
	}
	:global(.sloppy-picture-action) {
		border-radius: calc(var(--radius) - 2px);
		padding: 0.25rem 0.55rem;
		font-size: 0.75rem;
		color: var(--muted-foreground);
		white-space: nowrap;
	}
	:global(.sloppy-picture-action:hover) {
		background: var(--muted);
		color: var(--foreground);
	}
	:global(.sloppy-ink) {
		margin: 0.85em 0;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
		background: var(--card);
	}
	:global(.sloppy-ink.is-selected) {
		outline: 2px solid color-mix(in oklab, var(--primary) 60%, transparent);
		outline-offset: 2px;
	}
	:global(.sloppy-ink-canvas) {
		display: block;
		width: 100%;
		touch-action: pan-y;
	}
	:global(.sloppy-ink-bar) {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		border-top: 1px solid var(--border);
		padding: 0.25rem;
	}
	:global(.sloppy-ink-description) {
		flex: 1 1 auto;
		min-width: 0;
		border: 0;
		background: transparent;
		padding: 0.25rem 0.55rem;
		font-size: 0.75rem;
		color: var(--foreground);
		outline: none;
	}
	:global(.sloppy-ink-description::placeholder) {
		color: var(--muted-foreground);
	}
	:global(.sloppy-ink-action) {
		border-radius: calc(var(--radius) - 2px);
		padding: 0.25rem 0.55rem;
		font-size: 0.75rem;
		color: var(--muted-foreground);
	}
	:global(.sloppy-ink-action:hover:not(:disabled)) {
		background: var(--muted);
		color: var(--foreground);
	}
	:global(.sloppy-ink-action:disabled) {
		opacity: 0.45;
	}
	:global(.sloppy-math) {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35em;
	}
	:global(.sloppy-math.is-selected) {
		border-radius: calc(var(--radius) - 4px);
		background: color-mix(in oklab, var(--primary) 12%, transparent);
	}
	:global(.sloppy-math-block) {
		margin: 0.85em 0;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--card);
		padding: 0.6rem 0.75rem;
	}
	:global(.sloppy-math-block.is-selected) {
		outline: 2px solid color-mix(in oklab, var(--primary) 60%, transparent);
		outline-offset: 2px;
	}
	:global(.sloppy-math-block .sloppy-math-drawn) {
		overflow-x: auto;
	}
	/* A formula nobody has written yet, and one that would not draw, still take
	   a line, so the source under them does not sit against the border. */
	:global(.sloppy-math-block.is-blank .sloppy-math-drawn),
	:global(.sloppy-math-block.has-trouble .sloppy-math-drawn) {
		display: none;
	}
	:global(.sloppy-math-trouble) {
		color: var(--muted-foreground);
		font-size: 0.75rem;
	}
	:global(.sloppy-math-trouble:empty) {
		display: none;
	}
	:global(.sloppy-math .sloppy-math-source) {
		display: none;
	}
	:global(.sloppy-math.is-writing .sloppy-math-source),
	:global(.sloppy-math.is-blank .sloppy-math-source) {
		display: inline-block;
		width: 12ch;
	}
	:global(.sloppy-math-source),
	:global(.sloppy-diagram-source) {
		border: 0;
		border-radius: calc(var(--radius) - 4px);
		background: var(--muted);
		padding: 0.2rem 0.45rem;
		color: var(--foreground);
		font-family: var(--font-address);
		font-size: 0.8125rem;
		outline: none;
	}
	:global(.sloppy-math-source::placeholder),
	:global(.sloppy-diagram-source::placeholder) {
		color: var(--muted-foreground);
	}
	:global(.sloppy-math-block .sloppy-math-source) {
		display: block;
		margin-top: 0.5rem;
		width: 100%;
		resize: vertical;
	}
	:global(.sloppy-compass) {
		margin: 0.85em 0;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--card);
		padding: 0.6rem 0.75rem;
		container-type: inline-size;
	}
	:global(.sloppy-compass.is-selected) {
		outline: 2px solid color-mix(in oklab, var(--primary) 60%, transparent);
		outline-offset: 2px;
	}
	:global(.sloppy-compass-slots) {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.75rem;
	}
	:global(.sloppy-compass-note) {
		border: 1px solid var(--border);
		border-radius: calc(var(--radius) - 2px);
		padding: 0.4rem 0.6rem;
	}
	:global(.sloppy-compass-address) {
		font-size: 0.875rem;
		color: var(--muted-foreground);
	}
	:global(.sloppy-compass-title) {
		margin: 0;
		font-weight: 500;
		overflow-wrap: anywhere;
	}
	/* The note in the middle and the four slots around it — DESIGN.md § "The
	   compass card". Below this the four stack into one column, north to west. */
	@container (min-width: 30rem) {
		:global(.sloppy-compass-slots) {
			grid-template-columns: 1fr 1fr 1fr;
			align-items: start;
		}
		:global(.sloppy-compass-note) {
			grid-column: 2;
			grid-row: 2;
			text-align: center;
		}
		:global(.sloppy-compass-slot[data-direction='north']) {
			grid-column: 2;
			grid-row: 1;
		}
		:global(.sloppy-compass-slot[data-direction='west']) {
			grid-column: 1;
			grid-row: 2;
		}
		:global(.sloppy-compass-slot[data-direction='east']) {
			grid-column: 3;
			grid-row: 2;
		}
		:global(.sloppy-compass-slot[data-direction='south']) {
			grid-column: 2;
			grid-row: 3;
		}
	}
	:global(.sloppy-compass-word) {
		margin: 0;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--muted-foreground);
	}
	:global(.sloppy-compass ul.sloppy-compass-notes) {
		display: flex;
		flex-wrap: wrap;
		gap: 0.15rem 0.75rem;
		margin: 0.2rem 0 0;
		padding: 0;
		list-style: none;
	}
	:global(.sloppy-compass-notes li) {
		display: inline-flex;
		align-items: center;
		gap: 0.15rem;
		margin: 0;
	}
	:global(.sloppy-compass-asks) {
		margin: 0.2rem 0 0;
	}
	:global(.sloppy-compass-act),
	:global(.sloppy-compass-off) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 2.25rem;
		border-radius: calc(var(--radius) - 2px);
		padding: 0.25rem 0.55rem;
		font-size: 0.75rem;
		color: var(--muted-foreground);
	}
	:global(.sloppy-compass-off) {
		min-width: 2.25rem;
	}
	:global(.sloppy-compass-off svg) {
		width: 0.875rem;
		height: 0.875rem;
	}
	:global(.sloppy-compass-act) {
		margin-top: 0.1rem;
		margin-left: -0.55rem;
	}
	:global(.sloppy-compass-act:hover),
	:global(.sloppy-compass-off:hover) {
		background: var(--muted);
		color: var(--foreground);
	}
	:global(.sloppy-compass-finder) {
		margin-top: 0.35rem;
	}
	:global(.sloppy-compass-field) {
		width: 100%;
		border: 1px solid var(--border);
		border-radius: calc(var(--radius) - 2px);
		background: var(--background);
		padding: 0.4rem 0.55rem;
		font-size: 0.875rem;
		color: var(--foreground);
		outline: none;
	}
	:global(.sloppy-compass-field:focus-visible) {
		border-color: var(--ring);
	}
	:global(.sloppy-compass ul.sloppy-compass-menu) {
		margin: 0.25rem 0 0;
		padding: 0;
		list-style: none;
		max-height: 12rem;
		overflow-y: auto;
	}
	:global(.sloppy-compass-choice) {
		border-radius: calc(var(--radius) - 2px);
		padding: 0.4rem 0.55rem;
		font-size: 0.875rem;
		cursor: pointer;
	}
	:global(.sloppy-compass-choice[aria-selected='true']) {
		background: var(--muted);
	}
	:global(.sloppy-compass-said) {
		margin: 0.25rem 0 0;
		font-size: 0.75rem;
		color: var(--muted-foreground);
	}
	:global(.sloppy-diagram) {
		margin: 0.85em 0;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--card);
		padding: 0.6rem 0.75rem;
	}
	:global(.sloppy-diagram.is-selected) {
		outline: 2px solid color-mix(in oklab, var(--primary) 60%, transparent);
		outline-offset: 2px;
	}
	:global(.sloppy-diagram-drawn) {
		overflow-x: auto;
	}
	:global(.sloppy-diagram-drawn:empty) {
		display: none;
	}
	:global(.sloppy-diagram-drawn svg) {
		display: block;
		max-width: 100%;
		height: auto;
	}
	/* A language this build draws nothing for: the source is what is left to
	   read. */
	:global(.sloppy-diagram-drawn.is-plain) {
		font-family: var(--font-address);
		font-size: 0.8125rem;
		white-space: pre-wrap;
	}
	:global(.sloppy-diagram-trouble) {
		color: var(--muted-foreground);
		font-size: 0.75rem;
	}
	:global(.sloppy-diagram-trouble:empty) {
		display: none;
	}
	:global(.sloppy-diagram-source) {
		display: block;
		margin-top: 0.5rem;
		width: 100%;
		resize: vertical;
	}
</style>
