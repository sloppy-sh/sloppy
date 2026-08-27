<script lang="ts">
	// A node's interior: one writing surface whose top-level nodes ARE the block
	// rows. `./document.ts` owns that correspondence, `./contract.ts` the props.
	//
	// A pen drawing anywhere on this surface settles into an ink block where it
	// was drawn; there is no drawing mode to find (DESIGN.md § The canvas).
	import Bold from '@lucide/svelte/icons/bold';
	import Code from '@lucide/svelte/icons/code';
	import Heading1 from '@lucide/svelte/icons/heading-1';
	import Heading2 from '@lucide/svelte/icons/heading-2';
	import ImageIcon from '@lucide/svelte/icons/image';
	import Italic from '@lucide/svelte/icons/italic';
	import ListIcon from '@lucide/svelte/icons/list';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import ListOrdered from '@lucide/svelte/icons/list-ordered';
	import PenLine from '@lucide/svelte/icons/pen-line';
	import Quote from '@lucide/svelte/icons/quote';
	import Smile from '@lucide/svelte/icons/smile';
	import type { InkStroke, OwnedRef } from '@sloppy/types';
	import { Editor } from '@tiptap/core';
	import { TaskItem, TaskList } from '@tiptap/extension-list';
	import { Markdown } from '@tiptap/markdown';
	import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
	import StarterKit from '@tiptap/starter-kit';
	import { untrack } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { EmojiEntry } from '../../emoji/catalog.js';
	import { emojiCatalogs } from '../../emoji/catalogs.svelte.js';
	import { tokenizeContent } from '../../emoji/tokenize.js';
	import { BlockHandles } from './block-handles.js';
	import type { BlockStackProps, HeldPicture } from './contract.js';
	import {
		BlockIdentity,
		docBlocks,
		openBlocks,
		planSave,
		runSave,
		type DocBlock,
		type SavedBlock
	} from './document.js';
	import EmojiPicker from './emoji-picker.svelte';
	import { emojiInsert, EmojiNode, EMOJI_NODE, reclaimEmoji } from './emoji-node.js';
	import EmojiSuggestionPopup from './emoji-suggestion-popup.svelte';
	import { EmojiCompletions, EmojiSuggestion } from './emoji-suggestion.svelte.js';
	import { InkNode } from './ink-node.js';
	import {
		NIB_WIDTH,
		StrokeInProgress,
		capturePointer,
		drawStroke,
		prepareCanvas,
		strokeBounds,
		translateStrokes
	} from './ink.js';
	import MediaPicker from './media-picker.svelte';
	import { PICTURE_NODE, PictureNode } from './picture-node.js';
	import Toolbar, { type EditorAction } from './toolbar.svelte';

	let { node, blocks, onCreate, onUpdate, onRemove, onReorder, media, emoji }: BlockStackProps =
		$props();

	const SAVE_AFTER_MS = 700;
	/** However long the writing runs on, no change waits longer than this to be written. */
	const SAVE_WITHIN_MS = 3000;
	const RETRY_AFTER_MS = 4000;
	/** How long the pen may rest before the strokes so far settle into a block. */
	const SETTLE_AFTER_MS = 900;
	const INK_PADDING = 12;
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
	let saveState = $state<'idle' | 'saving' | 'saved' | 'failed'>('idle');
	let pickerOpen = $state(false);
	let mediaOpen = $state(false);

	const completions = new EmojiCompletions();

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

	const manager = (of: Editor) => of.storage.markdown.manager;

	// ── Saving ───────────────────────────────────────────────────────────────
	/** One trip to the API, holding everything it needs to outlive this surface. */
	interface Write {
		note: OwnedRef;
		/** The document it was read from, stamped with the row each new block became. */
		from: Editor;
		rows: SavedBlock[];
		next: DocBlock[];
	}

	/** The trip still in the air, so the next one queues behind it rather than racing it. */
	let inFlight: Promise<void> = Promise.resolve();

	function plan(): Write | null {
		const current = editor;
		if (!current || current.isDestroyed) return null;
		return {
			note: writingTo,
			from: current,
			rows: saved,
			next: docBlocks(current.state.doc, manager(current))
		};
	}

	/** What reaches the API is worked out when the trip leaves, not when it was asked for. */
	function run(write: Write): Promise<void> {
		const trip = inFlight.then(async () => {
			const ops = planSave(write.rows, write.next);
			if (ops.length === 0) return;
			await runSave(ops, write.rows, write.next, {
				create: (request) =>
					onCreate({
						node: write.note,
						type: request.type,
						content: request.content,
						...(request.after ? { after: request.after } : {}),
						...(request.data === undefined ? {} : { data: request.data })
					}).then((created) => created.ref),
				update: (ref, changes) => onUpdate(ref, changes).then(() => undefined),
				reorder: (ref, after) => onReorder(ref, after).then(() => undefined),
				remove: (ref) => onRemove(ref),
				placed: (uid, ref) => stamp(write.from, uid, ref)
			});
		});
		inFlight = trip.catch(() => undefined);
		return trip;
	}

	function scheduleSave(delay: number): void {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => void save(), delay);
	}

	/** A change waits for the writing to pause, but never past its own deadline. */
	function saveSoon(): void {
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
			if (mine === era) saveState = 'saved';
		} catch {
			if (mine === era) {
				saveState = 'failed';
				scheduleSave(RETRY_AFTER_MS);
			}
		} finally {
			saving = false;
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
		if (tr) from.view.dispatch(quiet(tr));
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
		from.state.doc.forEach((child, pos) => {
			if (child.type.name !== PICTURE_NODE || child.attrs.preview !== preview) return;
			tr = (tr ?? from.state.tr).setNodeMarkup(pos, undefined, { ...child.attrs, ...attrs });
		});
		if (!tr) return false;
		from.view.dispatch(quiet(tr));
		return true;
	}

	/** The file is on the page at once and the block only when it has landed —
	 *  `docBlocks` in `./document.ts` keeps one with nothing to name out of the
	 *  stack, so a note is never stored pointing at bytes that never arrived. */
	function sendPicture(file: File): void {
		const current = editor;
		if (!current) return;
		const preview = URL.createObjectURL(file);
		current.chain().focus().insertPicture({ preview }).run();
		const send = media.send(file, (fraction) => retouch(current, preview, { progress: fraction }));
		sending[preview] = send;
		void send.asset
			.then((asset) => {
				const placed = retouch(current, preview, {
					uploadId: asset.upload_id,
					width: asset.width ?? null,
					height: asset.height ?? null,
					progress: null
				});
				if (placed) saveSoon();
			})
			.catch((error: unknown) => {
				retouch(current, preview, {
					progress: null,
					failure:
						error instanceof Error && error.message
							? error.message
							: 'That picture could not be added. Remove it and try again.'
				});
			})
			.finally(() => delete sending[preview]);
	}

	function usePicture(picture: HeldPicture): void {
		editor
			?.chain()
			.focus()
			.insertPicture({
				uploadId: picture.upload_id,
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

	function penSurface() {
		const rect = wet!.getBoundingClientRect();
		return { left: rect.left, top: rect.top, scale: 1 };
	}

	function penContext(): { ctx: CanvasRenderingContext2D; width: number; height: number } | null {
		if (!wet) return null;
		const rect = wet.getBoundingClientRect();
		const ctx = prepareCanvas(wet, rect.width, rect.height);
		if (!ctx) return null;
		ctx.strokeStyle = getComputedStyle(wet).color;
		ctx.fillStyle = ctx.strokeStyle;
		return { ctx, width: rect.width, height: rect.height };
	}

	function repaintPen(): void {
		const prepared = penContext();
		if (!prepared) return;
		prepared.ctx.clearRect(0, 0, prepared.width, prepared.height);
		for (const done of pending) drawStroke(prepared.ctx, done, 1);
		if (stroke) drawStroke(prepared.ctx, { points: stroke.points, width: stroke.width }, 1);
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
		if (!stroke) return;
		event.preventDefault();
		const before = stroke.points.length;
		stroke.extend(event, penSurface());
		const prepared = penContext();
		if (prepared) {
			drawStroke(
				prepared.ctx,
				{ points: stroke.points, width: stroke.width },
				1,
				Math.max(1, before)
			);
		}
	}

	function onPenUp(): void {
		const done = stroke?.finish();
		stroke = null;
		if (!done) return;
		pending = [...pending, done];
		clearTimeout(settling);
		settling = setTimeout(settle, SETTLE_AFTER_MS);
	}

	/** Where in the note the ink was drawn: after the block its top sits on. */
	function positionFor(y: number): number {
		const current = editor!;
		const end = current.state.doc.content.size;
		try {
			const rect = wet!.getBoundingClientRect();
			const found = current.view.posAtCoords({ left: rect.left + 8, top: rect.top + y });
			if (!found) return end;
			const at = current.state.doc.resolve(found.inside >= 0 ? found.inside : found.pos);
			return at.depth === 0 ? found.pos : at.after(1);
		} catch {
			return end;
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
		const width = Math.max(1, Math.round(wet!.getBoundingClientRect().width));
		const height = Math.max(80, Math.ceil(bounds.bottom + INK_PADDING - top));
		editor.commands.insertContentAt(positionFor(bounds.top), {
			type: 'ink',
			attrs: { width, height, strokes: translateStrokes(strokes, 0, -top) }
		});
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
					StarterKit,
					Markdown,
					TaskList,
					TaskItem.configure({ nested: true }),
					BlockIdentity,
					BlockHandles,
					EmojiNode(() => catalog),
					EmojiSuggestion(completions, () => ownCatalog),
					InkNode,
					PictureNode(() => media)
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
			const stack = openBlocks(blocks, manager(created));
			created.commands.setContent(stack.doc, { emitUpdate: false });
			showEmoji(created);
			saved = stack.baseline(docBlocks(created.state.doc, manager(created)));
			ready = true;
			empty = created.isEmpty;
			saveState = 'idle';
			refreshMarks();

			// Listened for rather than bound: the surface is a writing area, not a
			// control, and the pen handlers must be able to refuse the browser's
			// default (a caret, a selection drag) on the way down.
			frame.addEventListener('pointerdown', onPenDown, { capture: true });
			frame.addEventListener('pointermove', onPenMove);
			frame.addEventListener('pointerup', onPenUp);
			frame.addEventListener('pointercancel', onPenUp);

			return () => {
				for (const send of Object.values(sending)) send.cancel();
				sending = {};
				frame.removeEventListener('pointerdown', onPenDown, { capture: true });
				frame.removeEventListener('pointermove', onPenMove);
				frame.removeEventListener('pointerup', onPenUp);
				frame.removeEventListener('pointercancel', onPenUp);
				clearTimeout(settling);
				settle();
				const last = plan();
				era += 1;
				again = false;
				saving = false;
				changedAt = 0;
				clearTimeout(saveTimer);
				pending = [];
				stroke = null;
				ready = false;
				editing = false;
				editor = null;
				created.destroy();
				// The last write of a note being left: no surface stays open for a
				// failure to be reported on, or retried from.
				if (last) void run(last).catch(() => undefined);
			};
		});
	});

	// A catalog fetched after the note opened turns its shortcodes into pictures
	// then, rather than on the next time the note is opened.
	$effect(() => {
		const entries = catalog;
		if (!ready || entries.length === 0) return;
		const current = editor;
		if (current) untrack(() => showEmoji(current));
	});

	function insertEmoji(entry: EmojiEntry, sticker: boolean): void {
		editor?.chain().focus().insertEmoji(emojiInsert(entry, sticker)).run();
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

	const actions = $derived<EditorAction[]>([
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
		},
		{ id: 'picture', label: 'Picture', icon: ImageIcon, run: () => (mediaOpen = true) },
		{ id: 'emoji', label: 'Emoji', icon: Smile, run: () => (pickerOpen = true) },
		{ id: 'draw', label: 'Draw', icon: PenLine, run: startDrawing }
	]);
</script>

<svelte:window onresize={repaintPen} />
<svelte:document onvisibilitychange={whenHidden} />

<div class="space-y-2">
	<div class="block-gutter">
		<div bind:this={surface} class="relative">
			<div bind:this={host}></div>
			<canvas
				bind:this={wet}
				class="pointer-events-none absolute inset-0 size-full text-foreground"
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

	<p class="min-h-5 text-right text-xs text-muted-foreground" role="status">
		{#if saveState === 'saving'}
			Saving…
		{:else if saveState === 'saved'}
			Saved
		{/if}
	</p>

	{#if saveState === 'failed'}
		<div
			class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"
			role="alert"
		>
			<span>Sloppy hasn't saved your last changes. Keep this note open — it will keep trying.</span>
			<Button variant="outline" size="sm" onclick={() => scheduleSave(0)}>Try now</Button>
		</div>
	{/if}

	<!-- Inside the writing surface: a bar over the viewport covers whatever the
	     page puts under the note, at every width, with no scroll that reaches it. -->
	{#if ready && editing}
		<div
			class="sticky lift-above-keyboard z-40 mx-auto w-full max-w-[34rem] rounded-full border bg-card/95 px-1.5 py-1 shadow-lg backdrop-blur"
		>
			<Toolbar {actions} />
		</div>
	{/if}
</div>

{#if ready}
	<EmojiSuggestionPopup {completions} />
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
/>

<style>
	.block-gutter {
		--block-gutter: 1.75rem;
		padding-left: var(--block-gutter);
	}
	:global(.sloppy-prose) {
		outline: none;
		font-size: 1rem;
		line-height: 1.7;
	}
	/* A handle stands between the two blocks it separates, so the gap it would
	   otherwise take is left to the block, exactly as it is without handles. */
	:global(.sloppy-prose > * + *:not(.sloppy-row)) {
		margin-top: 0.85em;
	}
	:global(.sloppy-prose > .sloppy-row:first-child + *) {
		margin-top: 0;
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
		height: 1.75rem;
		border-radius: calc(var(--radius) - 4px);
		color: var(--muted-foreground);
		opacity: 0.4;
		cursor: grab;
		/* The browser must not claim the gesture: a drag here is not a scroll,
		   and on a coarse pointer it is not a text selection either. */
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		transition:
			opacity 150ms ease-out,
			background-color 150ms ease-out;
	}
	@media (prefers-reduced-motion: reduce) {
		:global(.sloppy-row-handle) {
			transition: none;
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
		gap: 0.25rem;
		justify-content: flex-end;
		border-top: 1px solid var(--border);
		padding: 0.25rem;
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
</style>
