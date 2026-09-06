// @vitest-environment jsdom
import type {
	BlockDocument,
	BlockView,
	CreateBlockRequest,
	DocumentNode,
	InkStroke,
	MediaAsset,
	OwnedRef
} from '@sloppy/types';
import type { Editor } from '@tiptap/core';
import { Selection } from '@tiptap/pm/state';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emojiCatalogs } from '../../emoji/catalogs.svelte.js';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import BlockStack from './block-stack.svelte';
import type { NoteEmoji, NoteMedia, NoteReferences } from './contract.js';
import { SaveFailure, type DraftStore, type NoteDraft } from './document.js';
import {
	NOTE,
	OWNER,
	block,
	noDrafts,
	noEmoji,
	noMedia,
	noNotes,
	ref,
	section,
	stubCanvas,
	text
} from './editor.test-support.js';

interface Written {
	created: CreateBlockRequest[];
	updated: { ref: OwnedRef; content?: BlockDocument }[];
	removed: OwnedRef[];
	moved: { ref: OwnedRef; after: OwnedRef | null }[];
}

/** The elements of a section, by kind. */
const kinds = (content: BlockDocument | undefined): string[] =>
	(content?.content ?? []).map((element) => element.type);

/** What a section says, one line per element. */
const wording = (content: BlockDocument | undefined): string[] =>
	(content?.content ?? []).map((element) => reading(element));

function reading(element: DocumentNode): string {
	if (element.text !== undefined) return element.text;
	return (element.content ?? []).map(reading).join('');
}

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let written: Written;
/** The rows the creates became, so a note can be opened again on what landed. */
let made: BlockView[];
/** Set to keep every create in flight until the test lets it answer. */
let answering: Promise<void> | null;

/** What a device holds for a note, and every act on it, so a test can say what
 *  was kept and what was let go. */
function deviceDrafts(held: Record<string, NoteDraft> = {}) {
	const kept: NoteDraft[] = [];
	const forgotten: OwnedRef[] = [];
	let which = 0;
	const last = new Map<OwnedRef, number>();
	/** Set to keep every read of the device waiting until the test lets it answer. */
	let answeringReads: Promise<void> | null = null;
	let trips = 0;
	let arrive = () => {};
	let inAir: Promise<void> = Promise.resolve();
	const store: DraftStore = {
		read: async (note) => {
			if (answeringReads) await answeringReads;
			return held[note] ?? null;
		},
		last: (note) => last.get(note) ?? 0,
		keep: (note, draft, since) => {
			if (since !== undefined && (last.get(note) ?? 0) > since) return since;
			const copy = structuredClone(draft);
			kept.push(copy);
			held[note] = copy;
			last.set(note, ++which);
			return which;
		},
		forget: (note, since) => {
			if (since !== undefined && (last.get(note) ?? 0) > since) return;
			last.delete(note);
			forgotten.push(note);
			delete held[note];
		},
		landed: () => undefined,
		leaving: () => {
			if (trips === 0) inAir = new Promise<void>((resolve) => (arrive = resolve));
			trips += 1;
			let counted = true;
			return () => {
				if (!counted) return;
				counted = false;
				trips -= 1;
				if (trips === 0) arrive();
			};
		},
		settled: () => inAir
	};
	return {
		store,
		kept,
		forgotten,
		holds: (note: OwnedRef) => note in held,
		/** Holds every read of the device; the returned call lets them answer. */
		holdReads: () => {
			let answer = () => {};
			answeringReads = new Promise<void>((resolve) => (answer = resolve));
			return () => {
				answeringReads = null;
				answer();
			};
		}
	};
}

function open(
	blocks: BlockView[],
	able: {
		media?: NoteMedia;
		emoji?: NoteEmoji;
		references?: NoteReferences;
		drafts?: DraftStore;
		/** What the API refuses this write with, or nothing to let it land. */
		refuse?: () => unknown;
	} = {}
) {
	const refused = () => {
		const no = able.refuse?.();
		if (no) throw no;
	};
	mounted = mount(BlockStack, {
		target,
		props: {
			media: able.media ?? noMedia(),
			emoji: able.emoji ?? noEmoji(),
			references: able.references ?? noNotes(),
			drafts: able.drafts ?? noDrafts(),
			node: NOTE,
			blocks,
			onCreate: async (request: CreateBlockRequest) => {
				written.created.push(request);
				if (answering) await answering;
				refused();
				const row = block({ content: request.content as BlockDocument, ref: ref() });
				made.push(row);
				return row;
			},
			onUpdate: async (block: OwnedRef, request: Record<string, unknown>) => {
				written.updated.push({ ref: block, ...request });
				refused();
				return {} as BlockView;
			},
			onRemove: async (block: OwnedRef) => {
				written.removed.push(block);
			},
			onReorder: async (block: OwnedRef, after: OwnedRef | null) => {
				written.moved.push({ ref: block, after });
				return {} as BlockView;
			}
		}
	});
	flushSync();
	return mounted;
}

function close(): void {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
}

/** Every element of the note's first section, by kind. */
function elements(of: Editor): string[] {
	const names: string[] = [];
	of.state.doc.firstChild?.forEach((child) => names.push(child.type.name));
	return names;
}

/** TipTap hangs the editor off the element it writes into. */
const writingIn = (): Editor =>
	(target.querySelector('.sloppy-prose') as unknown as { editor: Editor }).editor;

function background(): void {
	Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
	document.dispatchEvent(new Event('visibilitychange'));
}

function penEvent(type: string, x: number, y: number, pressure = 0.5): PointerEvent {
	const event = new Event(type, { bubbles: true, cancelable: true });
	Object.assign(event, {
		pointerId: 1,
		pointerType: 'pen',
		clientX: x,
		clientY: y,
		pressure,
		tiltX: 0,
		tiltY: 0
	});
	return event as PointerEvent;
}

beforeEach(() => {
	written = { created: [], updated: [], removed: [], moved: [] };
	made = [];
	answering = null;
	stubResizeObserver();
	stubMediaQuery(() => false);
	stubCanvas();
	Element.prototype.getBoundingClientRect = () =>
		({ left: 0, top: 0, width: 320, height: 240, right: 320, bottom: 240 }) as DOMRect;
	target = document.createElement('div');
	document.body.appendChild(target);
	vi.useFakeTimers();
});

afterEach(() => {
	close();
	emojiCatalogs.forget(OWNER);
	Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
	// Discarded on the fake clock rather than handed to the real one: a teardown
	// timer that outlives this file lands in whichever file runs next.
	vi.clearAllTimers();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	target.remove();
	document.body.innerHTML = '';
});

const prose = (words: string) => block({ content: section(...text(words)) });

describe('opening a note', () => {
	it('shows one section as many elements, each as what it is', () => {
		open([
			block({
				content: section(
					{
						type: 'heading',
						attrs: { level: 2 },
						content: [{ type: 'text', text: 'A place to start' }]
					},
					...text('and a line under it'),
					{
						type: 'taskList',
						content: [
							{ type: 'taskItem', attrs: { checked: true }, content: text('read it again') }
						]
					}
				)
			})
		]);
		expect(document.querySelectorAll('section')).toHaveLength(1);
		expect(document.querySelector('h2')?.textContent).toBe('A place to start');
		expect(document.querySelector('input[type="checkbox"]')).not.toBeNull();
	});

	it('shows a stored shortcode as the emoji it names', () => {
		open([prose('a spark :fire: of it')]);
		const glyph = document.querySelector('[data-emoji="fire"]');
		expect(glyph?.textContent).toBe('🔥');
		expect(document.querySelector('.sloppy-prose')?.textContent).not.toContain(':fire:');
	});

	it('writes nothing back for a note nobody has touched', async () => {
		open([prose('left alone')]);
		await vi.advanceTimersByTimeAsync(5000);
		expect(written).toEqual({ created: [], updated: [], removed: [], moved: [] });
	});

	it('opens a note around a drawing it cannot read, and leaves that one alone', async () => {
		open([
			block({
				content: section(...text('the thought it was drawn beside'), {
					type: 'ink',
					attrs: { strokes: 'not strokes', width: 400, height: 120 }
				})
			}),
			prose('the section after it')
		]);
		expect(document.querySelector('.sloppy-prose')?.textContent).toBe('the section after it');
		await vi.advanceTimersByTimeAsync(5000);
		expect(written).toEqual({ created: [], updated: [], removed: [], moved: [] });
	});

	it('leaves a shortcode inside code exactly as it was written', async () => {
		open([
			block({
				content: section(
					{
						type: 'codeBlock',
						content: [{ type: 'text', text: 'git commit -m ":fire: remove dead code"' }]
					},
					{
						type: 'paragraph',
						content: [
							{ type: 'text', text: 'type ' },
							{ type: 'text', marks: [{ type: 'code' }], text: ':fire:' },
							{ type: 'text', text: ' to get a flame' }
						]
					}
				)
			})
		]);
		expect(document.querySelector('pre')?.textContent).toBe(
			'git commit -m ":fire: remove dead code"'
		);
		expect(document.querySelector('p code')?.textContent).toBe(':fire:');
		expect(document.querySelector('[data-emoji]')).toBeNull();

		writingIn().commands.insertContentAt(2, 'sudo ');
		await vi.advanceTimersByTimeAsync(5000);
		expect(written.created).toEqual([]);
		expect(written.removed).toEqual([]);
		expect(written.updated.map((row) => wording(row.content)[0])).toEqual([
			'sudo git commit -m ":fire: remove dead code"'
		]);
	});
});

/** The drawing in the one section a pen test writes, and what it holds. */
const inked = (content: BlockDocument | undefined) =>
	(content?.content ?? []).find((element) => element.type === 'ink')?.attrs as
		| { strokes: InkStroke[]; width: number; height: number }
		| undefined;

describe('a pen on the writing surface', () => {
	it('leaves a drawing in the section it was drawn in, with no mode to find', async () => {
		open([prose('a thought')]);
		const surface = target.querySelector('div.relative') as HTMLElement;

		surface.dispatchEvent(penEvent('pointerdown', 40, 60, 0.2));
		surface.dispatchEvent(penEvent('pointermove', 90, 100, 0.7));
		surface.dispatchEvent(penEvent('pointermove', 140, 150, 0.95));
		surface.dispatchEvent(penEvent('pointerup', 140, 150, 0.95));

		await vi.advanceTimersByTimeAsync(5000);

		expect(written.created).toEqual([]);
		expect(written.updated).toHaveLength(1);
		expect(kinds(written.updated[0].content)).toContain('ink');
		const drawing = inked(written.updated[0].content);
		expect(drawing?.strokes).toHaveLength(1);
		expect(drawing?.strokes[0].points.map((point) => point.pressure)).toEqual([0.2, 0.7, 0.95]);
		expect(drawing?.width).toBe(320);
	});

	it('gathers the strokes drawn in one sitting into a single drawing', async () => {
		open([]);
		const surface = target.querySelector('div.relative') as HTMLElement;
		for (const at of [20, 60]) {
			surface.dispatchEvent(penEvent('pointerdown', at, 40));
			surface.dispatchEvent(penEvent('pointermove', at + 20, 90));
			surface.dispatchEvent(penEvent('pointerup', at + 20, 90));
			await vi.advanceTimersByTimeAsync(100);
		}
		await vi.advanceTimersByTimeAsync(5000);

		expect(written.created).toHaveLength(1);
		expect(inked(written.created[0].content as BlockDocument)?.strokes).toHaveLength(2);
	});

	it('leaves a finger alone, so the note still scrolls', async () => {
		open([]);
		const surface = target.querySelector('div.relative') as HTMLElement;
		const touch = (type: string, x: number) => {
			const event = penEvent(type, x, 60);
			Object.assign(event, { pointerType: 'touch' });
			surface.dispatchEvent(event);
		};
		touch('pointerdown', 20);
		touch('pointermove', 80);
		touch('pointerup', 80);
		await vi.advanceTimersByTimeAsync(5000);
		expect(written.created).toEqual([]);
	});
});

describe('what a note keeps when it is left', () => {
	it('writes what was typed when the note is closed before the writing pauses', async () => {
		open([prose('a thought')]);
		writingIn().commands.insertContentAt(2, 'more of ');
		await vi.advanceTimersByTimeAsync(100);
		expect(written.updated).toEqual([]);

		close();
		await vi.advanceTimersByTimeAsync(0);
		expect(written.updated.map((row) => wording(row.content)[0])).toEqual(['more of a thought']);
	});

	it('keeps a drawing the pen has only just put down', async () => {
		open([]);
		const surface = target.querySelector('div.relative') as HTMLElement;
		surface.dispatchEvent(penEvent('pointerdown', 40, 60, 0.2));
		surface.dispatchEvent(penEvent('pointermove', 90, 100, 0.7));
		surface.dispatchEvent(penEvent('pointerup', 90, 100, 0.7));
		await vi.advanceTimersByTimeAsync(100);
		expect(written.created).toEqual([]);

		close();
		await vi.advanceTimersByTimeAsync(0);
		expect(written.created.map((row) => kinds(row.content as BlockDocument))).toEqual([
			['paragraph', 'ink']
		]);
	});

	it('makes a section once when the note is closed while it is still being made', async () => {
		let answer = () => {};
		answering = new Promise<void>((resolve) => (answer = resolve));

		open([prose('a thought')]);
		const of = writingIn();
		of.commands.addSection();
		of.commands.insertContent('and another');
		await vi.advanceTimersByTimeAsync(1000);
		expect(written.created.map((row) => wording(row.content as BlockDocument))).toEqual([
			['and another']
		]);

		close();
		answer();
		await vi.advanceTimersByTimeAsync(1000);
		expect(written.created).toHaveLength(1);
	});

	it('writes what is unsaved when the app goes to the background', async () => {
		open([prose('a thought')]);
		writingIn().commands.insertContentAt(2, 'more of ');
		await vi.advanceTimersByTimeAsync(100);

		background();
		await vi.advanceTimersByTimeAsync(0);
		expect(written.updated.map((row) => wording(row.content)[0])).toEqual(['more of a thought']);
	});

	it('writes what is still being typed rather than waiting for a pause that never comes', async () => {
		open([prose('a thought')]);
		for (let keystroke = 0; keystroke < 20; keystroke += 1) {
			writingIn().commands.insertContentAt(2, '.');
			await vi.advanceTimersByTimeAsync(200);
		}
		expect(written.updated.map((row) => wording(row.content)[0])).toEqual([
			'...............a thought'
		]);
	});
});

describe('writing that has not reached the server', () => {
	/** What a section says, as this device is holding it. */
	const holding = (section: { content: BlockDocument }) => wording(section.content)[0];
	/** The note's sections, in order. */
	const held = (draft: NoteDraft) => draft.next.map(holding);

	it('is on the device while it is on its way, and let go once it lands', async () => {
		const device = deviceDrafts();
		open([prose('a thought')], { drafts: device.store });
		writingIn().commands.insertContentAt(2, 'more of ');
		await vi.advanceTimersByTimeAsync(5000);

		expect(device.kept.map(held)).toEqual([['more of a thought']]);
		expect(device.forgotten).toEqual([NOTE.ref]);
		expect(device.holds(NOTE.ref)).toBe(false);
	});

	it('stays on the device while Sloppy cannot save it', async () => {
		const device = deviceDrafts();
		open([prose('a thought')], {
			drafts: device.store,
			refuse: () => new SaveFailure('transient')
		});
		writingIn().commands.insertContentAt(2, 'more of ');
		await vi.advanceTimersByTimeAsync(1000);
		flushSync();

		expect(device.holds(NOTE.ref)).toBe(true);
		expect(device.forgotten).toEqual([]);
		const said = target.querySelector('[role="alert"]')?.textContent ?? '';
		expect(said).toContain('Sloppy will keep trying to save this note.');
		expect(said).not.toContain('Keep this note open');
	});

	it('names the row a new section became the moment it lands', async () => {
		const device = deviceDrafts();
		let landed = 0;
		open([], {
			drafts: device.store,
			refuse: () => (++landed > 1 ? new SaveFailure('transient') : undefined)
		});
		const of = writingIn();
		of.commands.insertContent('the first');
		of.commands.addSection();
		of.commands.insertContent('and one more');
		await vi.advanceTimersByTimeAsync(1000);

		const last = device.kept.at(-1) as NoteDraft;
		expect(last.next.map(holding)).toEqual(['the first', 'and one more']);
		expect(last.next.map((section) => section.ref !== null)).toEqual([true, false]);
		expect(last.rows.map(holding)).toEqual(['the first']);
	});

	it('is what the note opens on when it comes back, and is saved from there', async () => {
		const device = deviceDrafts();
		const stored = prose('as it was');
		open([stored], { drafts: device.store, refuse: () => new SaveFailure('transient') });
		writingIn().commands.insertContentAt(2, 'unsent, ');
		await vi.advanceTimersByTimeAsync(1000);
		close();
		await vi.advanceTimersByTimeAsync(1000);
		expect(device.holds(NOTE.ref)).toBe(true);

		written = { created: [], updated: [], removed: [], moved: [] };
		open([stored], { drafts: device.store });
		await vi.advanceTimersByTimeAsync(5000);

		expect(target.querySelector('.sloppy-prose')?.textContent).toBe('unsent, as it was');
		expect(written.updated.map((row) => wording(row.content)[0])).toEqual(['unsent, as it was']);
		expect(device.holds(NOTE.ref)).toBe(false);
	});

	it('is let go when the note is left and the last write lands', async () => {
		const device = deviceDrafts();
		let answer = () => {};
		answering = new Promise<void>((resolve) => (answer = resolve));

		open([], { drafts: device.store });
		writingIn().commands.insertContent('a thought on the way out');
		await vi.advanceTimersByTimeAsync(1000);
		expect(device.holds(NOTE.ref)).toBe(true);

		close();
		answer();
		await vi.advanceTimersByTimeAsync(1000);
		expect(device.forgotten).toEqual([NOTE.ref]);
	});

	it('names a section whose create landed on the way out, so it is not written twice', async () => {
		const device = deviceDrafts();
		let reached = 0;
		open([], {
			drafts: device.store,
			refuse: () => (++reached > 1 ? new SaveFailure('transient') : undefined)
		});
		const of = writingIn();
		of.commands.insertContent('the first');
		of.commands.addSection();
		of.commands.insertContent('and one more');
		close();
		await vi.advanceTimersByTimeAsync(1000);

		const stack = made;
		expect(stack.map((row) => wording(row.content)[0])).toEqual(['the first']);

		written = { created: [], updated: [], removed: [], moved: [] };
		open(stack, { drafts: device.store });
		await vi.advanceTimersByTimeAsync(5000);

		expect(target.querySelector('.sloppy-prose')?.textContent).toBe('the firstand one more');
		expect(written.created.map((row) => wording(row.content as BlockDocument)[0])).toEqual([
			'and one more'
		]);
		expect(device.holds(NOTE.ref)).toBe(false);
	});

	it('is not written a second time when the note comes back while a section is on its way', async () => {
		const device = deviceDrafts();
		let answer = () => {};
		answering = new Promise<void>((resolve) => (answer = resolve));

		open([], { drafts: device.store });
		writingIn().commands.insertContent('a thought on the way out');
		close();
		await vi.advanceTimersByTimeAsync(100);

		// All the API can answer with is the stack it held before that create.
		open([], { drafts: device.store });
		answering = null;
		answer();
		await vi.advanceTimersByTimeAsync(5000);

		expect(written.created.map((row) => wording(row.content as BlockDocument)[0])).toEqual([
			'a thought on the way out'
		]);
		expect(made).toHaveLength(1);
	});

	it('does not come back over writing done since the note was opened again', async () => {
		const device = deviceDrafts();
		let answer = () => {};
		answering = new Promise<void>((resolve) => (answer = resolve));

		open([], { drafts: device.store });
		writingIn().commands.insertContent('the first');
		close();
		await vi.advanceTimersByTimeAsync(100);

		open([], { drafts: device.store });
		writingIn().commands.insertContent('written since');
		await vi.advanceTimersByTimeAsync(1000);
		answering = null;
		answer();
		await vi.advanceTimersByTimeAsync(5000);

		expect(target.querySelector('.sloppy-prose')?.textContent).toBe('written since');
		expect(written.created.map((row) => wording(row.content as BlockDocument)[0])).toEqual([
			'the first',
			'written since'
		]);
	});

	it('is still there when the note is left before this device has answered with it', async () => {
		const stored = prose('as it was');
		const device = deviceDrafts({
			[NOTE.ref]: {
				rows: [
					{
						uid: 'u1',
						ref: stored.ref,
						content: stored.content,
						updated_at: stored.updated_at
					}
				],
				next: [{ uid: 'u1', ref: stored.ref, content: section(...text('unsent, as it was')) }]
			}
		});
		const answerRead = device.holdReads();

		open([stored], { drafts: device.store });
		close();
		answerRead();
		await vi.advanceTimersByTimeAsync(1000);

		expect(device.forgotten).toEqual([]);
		expect(device.holds(NOTE.ref)).toBe(true);

		open([stored], { drafts: device.store });
		await vi.advanceTimersByTimeAsync(1000);
		expect(target.querySelector('.sloppy-prose')?.textContent).toBe('unsent, as it was');
	});

	it('is still there when the note is left and the last write does not land', async () => {
		const device = deviceDrafts();
		open([prose('a thought')], {
			drafts: device.store,
			refuse: () => new SaveFailure('transient')
		});
		writingIn().commands.insertContentAt(2, 'more of ');
		await vi.advanceTimersByTimeAsync(100);

		close();
		await vi.advanceTimersByTimeAsync(1000);
		expect(device.forgotten).toEqual([]);
		expect(device.holds(NOTE.ref)).toBe(true);
	});
});

describe('a save that does not land', () => {
	const alert = () => target.querySelector('[role="alert"]')?.textContent?.trim() ?? '';
	const tryNow = () =>
		[...target.querySelectorAll('button')].find((button) =>
			button.textContent?.includes('Try now')
		);

	async function typeInto(refuse: () => unknown) {
		open([prose('a thought')], { refuse });
		writingIn().commands.insertContentAt(2, 'more of ');
		await vi.advanceTimersByTimeAsync(1000);
		flushSync();
	}

	it('keeps trying while the trouble may pass', async () => {
		await typeInto(() => new SaveFailure('transient'));
		expect(written.updated).toHaveLength(1);
		expect(alert()).toContain('Sloppy will keep trying to save this note.');
		expect(tryNow()).not.toBeUndefined();

		await vi.advanceTimersByTimeAsync(5000);
		expect(written.updated.length).toBeGreaterThan(1);
	});

	it('stops, and says what to do, when trying again cannot land it', async () => {
		await typeInto(() => new SaveFailure('refused', 'Sign in again to keep this note.'));
		expect(alert()).toContain('Sign in again to keep this note.');
		expect(tryNow()).toBeUndefined();

		await vi.advanceTimersByTimeAsync(30000);
		expect(written.updated).toHaveLength(1);
	});

	it('stops, and says so, when the note was written somewhere else', async () => {
		await typeInto(() => new SaveFailure('elsewhere'));
		expect(alert()).toContain('This note was also written somewhere else.');
		expect(tryNow()).toBeUndefined();

		await vi.advanceTimersByTimeAsync(30000);
		expect(written.updated).toHaveLength(1);
	});

	it('names the stamp the surface last saw on what it writes', async () => {
		const stored = block({
			content: section(...text('a thought')),
			updated_at: '2026-03-04T05:06:07.000Z'
		});
		open([stored]);
		writingIn().commands.insertContentAt(2, 'more of ');
		await vi.advanceTimersByTimeAsync(1000);
		expect(written.updated).toEqual([
			{ ref: stored.ref, content: expect.anything(), expects: '2026-03-04T05:06:07.000Z' }
		]);
	});
});

/** The writing area itself, rather than the editor hung off it. */
const surface = (): HTMLElement => target.querySelector('.sloppy-prose') as HTMLElement;

describe('the writing controls', () => {
	// Pinned to the viewport they cover whatever the page puts under the note, at
	// every width, with no scroll that reaches it.
	it('sit in the note rather than over the page', () => {
		open([prose('a thought')]);
		surface().dispatchEvent(new FocusEvent('focus', { bubbles: true }));
		flushSync();

		const bar = target.querySelector('[role="toolbar"]');
		expect(bar).not.toBeNull();
		expect(bar?.closest('.fixed')).toBeNull();
		expect(bar?.closest('.sticky')).not.toBeNull();
	});

	// At phone width the bar is narrower than its actions, and what falls off the
	// end of a rail is a feature nobody finds.
	it('keeps what puts something in the note out of the rail that scrolls', () => {
		open([prose('a thought')]);
		surface().dispatchEvent(new FocusEvent('focus', { bubbles: true }));
		flushSync();

		const bar = target.querySelector('[role="toolbar"]') as HTMLElement;
		const rail = bar.querySelector('.overflow-x-auto') as HTMLElement;
		const control = (label: string) => bar.querySelector(`button[aria-label="${label}"]`);

		for (const label of ['Picture', 'Emoji', 'Draw']) {
			expect(control(label), label).not.toBeNull();
			expect(rail.contains(control(label)), label).toBe(false);
		}
		expect(rail.contains(control('Bold'))).toBe(true);
	});
});

describe('a picture in a note', () => {
	/** A send the test lets land when it chooses. */
	function sender() {
		let land: (asset: MediaAsset) => void = () => {};
		const landed = new Promise<MediaAsset>((resolve) => (land = resolve));
		const reported: number[] = [];
		const files: File[] = [];
		const media: NoteMedia = {
			...noMedia(),
			send: (file, report) => {
				files.push(file);
				report(0.5);
				reported.push(0.5);
				return { asset: landed, cancel: () => {} };
			}
		};
		return { media, reported, files, land: (asset: MediaAsset) => land(asset) };
	}

	async function choose(file: File): Promise<void> {
		const control = [...target.querySelectorAll('button')].find(
			(button) => button.getAttribute('aria-label') === 'Picture'
		);
		control?.click();
		flushSync();
		const chooser = document.body.querySelector('input[type="file"]') as HTMLInputElement;
		Object.defineProperty(chooser, 'files', { configurable: true, value: [file] });
		chooser.dispatchEvent(new Event('change', { bubbles: true }));
		await vi.advanceTimersByTimeAsync(0);
		flushSync();
	}

	it('is on the page at once, and a block only once the file has landed', async () => {
		const { media, reported, land } = sender();
		open([], { media });
		surface().dispatchEvent(new FocusEvent('focus', { bubbles: true }));
		flushSync();
		await choose(new File(['x'], 'kite.png', { type: 'image/png' }));

		expect(target.querySelector('[data-picture-block]')).not.toBeNull();
		expect(reported).toEqual([0.5]);
		expect(written.created).toEqual([]);

		land({ upload_id: `${OWNER}/01UP`, mime_type: 'image/png', size: 1, width: 40, height: 20 });
		await vi.advanceTimersByTimeAsync(4000);

		expect(written.created).toHaveLength(1);
		expect(
			(written.created[0].content as BlockDocument).content.find(
				(element) => element.type === 'picture'
			)
		).toEqual({
			type: 'picture',
			attrs: { upload_id: `${OWNER}/01UP`, width: 40, height: 20 }
		});
	});

	// A picture nested in a list item is below the section's own elements, where
	// neither the save plan nor the send that fills it can find it again.
	it('stands on its own even when the writing was in a list', async () => {
		const { media, land } = sender();
		open(
			[
				block({
					content: section({
						type: 'bulletList',
						content: [
							{ type: 'listItem', content: text('one') },
							{ type: 'listItem', content: text('two') }
						]
					})
				})
			],
			{ media }
		);
		const of = writingIn();
		of.commands.setTextSelection(of.state.doc.content.size - 5);
		surface().dispatchEvent(new FocusEvent('focus', { bubbles: true }));
		flushSync();
		await choose(new File(['x'], 'kite.png', { type: 'image/png' }));

		expect(elements(of)[0]).toBe('bulletList');
		expect(elements(of)).toContain('picture');

		land({ upload_id: `${OWNER}/01UP`, mime_type: 'image/png', size: 1 });
		await vi.advanceTimersByTimeAsync(4000);

		expect(written.created).toEqual([]);
		expect(written.updated.map((row) => kinds(row.content))).toEqual([
			['bulletList', 'picture', 'paragraph']
		]);
	});

	it('offers what is already in a note, and uses one without sending it again', async () => {
		open([], {
			media: {
				...noMedia(),
				library: async () => [
					{ upload_id: `${OWNER}/01OLD`, filename: 'kite.png', mime_type: 'image/png', size: 9 }
				]
			}
		});
		surface().dispatchEvent(new FocusEvent('focus', { bubbles: true }));
		flushSync();
		[...target.querySelectorAll('button')]
			.find((button) => button.getAttribute('aria-label') === 'Picture')
			?.click();
		flushSync();
		await vi.advanceTimersByTimeAsync(0);
		flushSync();

		const held = document.body.querySelector('button[aria-label="kite.png"]') as HTMLButtonElement;
		expect(held).not.toBeNull();
		held.click();
		await vi.advanceTimersByTimeAsync(4000);

		expect(written.created).toHaveLength(1);
		expect(
			(written.created[0].content as BlockDocument).content.find(
				(element) => element.type === 'picture'
			)
		).toEqual({ type: 'picture', attrs: { upload_id: `${OWNER}/01OLD` } });
	});

	it('sends the picture at the size a note draws it, not the whole original', async () => {
		const { media, files, land } = sender();
		vi.stubGlobal('createImageBitmap', async () => ({
			width: 4032,
			height: 3024,
			close: () => {}
		}));
		vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((done) =>
			done(new Blob([new Uint8Array(300_000)], { type: 'image/webp' }))
		);

		open([], { media });
		surface().dispatchEvent(new FocusEvent('focus', { bubbles: true }));
		flushSync();
		await choose(new File([new Uint8Array(4_200_000)], 'IMG_0042.jpeg', { type: 'image/jpeg' }));

		expect(files.map((file) => file.size)).toEqual([300_000]);

		land({ upload_id: `${OWNER}/01UP`, mime_type: 'image/webp', size: 300_000 });
		await vi.advanceTimersByTimeAsync(4000);
		expect(written.created.map((row) => kinds(row.content as BlockDocument))).toEqual([
			['paragraph', 'picture', 'paragraph']
		]);
	});

	it('says so when it cannot be drawn, rather than showing an empty frame', async () => {
		open([
			block({
				content: section({ type: 'picture', attrs: { upload_id: `${OWNER}/01UP` } })
			})
		]);
		await vi.advanceTimersByTimeAsync(0);
		flushSync();

		const image = target.querySelector('.sloppy-picture-image') as HTMLImageElement;
		expect(target.querySelector('.sloppy-picture-note')?.textContent).toBe('');

		image.dispatchEvent(new Event('error'));

		expect(target.querySelector('.sloppy-picture-note')?.textContent).toContain("didn't load");
	});
});

describe('a shortcode its author uploaded a picture for', () => {
	// `seedling` on purpose: Unicode claims that name too, and a note opens
	// before its author's catalog answers, so the first pass has only the
	// Unicode set to resolve against.
	const CATALOG = [{ id: 'e1', shortcode: 'seedling', src: '/proxy?ref=seedling', sticker: false }];

	/** Every emoji in a section, by the shortcode it was written as. */
	const named = (content: BlockDocument | undefined): unknown[] =>
		(content?.content ?? []).flatMap((element) =>
			(element.content ?? [])
				.filter((run) => run.type === 'emoji')
				.map((run) => [run.attrs?.name, run.attrs?.sticker])
		);

	it('draws the picture, and keeps the shortcode it was written as', async () => {
		open([prose('look :seedling: look')], { emoji: noEmoji(CATALOG) });
		await vi.advanceTimersByTimeAsync(0);
		flushSync();

		const drawn = target.querySelector('img.sloppy-emoji-picture');
		expect(drawn?.getAttribute('src')).toBe('/proxy?ref=seedling');
		expect(target.querySelector('.sloppy-prose')?.textContent).not.toContain('🌱');
	});

	it('writes nothing back for a note that only had its emoji drawn', async () => {
		open([prose('look :seedling: look')], { emoji: noEmoji(CATALOG) });
		await vi.advanceTimersByTimeAsync(5000);

		expect(written).toEqual({ created: [], updated: [], removed: [], moved: [] });
	});

	it('keeps the small form a note was written in, whatever the catalog says', async () => {
		open([prose('look :seedling: look')], {
			emoji: noEmoji([{ ...CATALOG[0], sticker: true }])
		});
		await vi.advanceTimersByTimeAsync(0);
		flushSync();
		writingIn().commands.insertContentAt(2, 'X');
		await vi.advanceTimersByTimeAsync(5000);

		expect(written.updated.map((row) => named(row.content))).toEqual([[['seedling', false]]]);
	});

	it('leaves a name the catalog does not claim as the emoji Unicode gives it', async () => {
		open([prose('a spark :fire: of it')], { emoji: noEmoji(CATALOG) });
		await vi.advanceTimersByTimeAsync(0);
		flushSync();

		expect(target.querySelector('[data-emoji="fire"]')?.textContent).toBe('🔥');
		expect(target.querySelector('img.sloppy-emoji-picture')).toBeNull();
	});
});

describe('putting a section somewhere else in the stack', () => {
	/** Sections 40 tall and stacked, so a drag has somewhere to aim at. */
	function stacked(): void {
		const flat = Element.prototype.getBoundingClientRect;
		Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
			const rows = [...target.querySelectorAll('.sloppy-prose > [data-block-uid]')];
			const index = rows.indexOf(this);
			if (index < 0) return flat.call(this);
			const top = index * 40;
			return { left: 0, right: 320, width: 320, top, bottom: top + 40, height: 40 } as DOMRect;
		};
	}

	const grips = (): HTMLButtonElement[] => [
		...target.querySelectorAll<HTMLButtonElement>('[data-block-handle]')
	];

	const stack = (): (string | null)[] =>
		[...target.querySelectorAll('.sloppy-prose > section')].map((row) => row.textContent);

	function pointer(pointerType: string) {
		return (type: string, y: number): PointerEvent => {
			const event = new Event(type, { bubbles: true, cancelable: true });
			Object.assign(event, { pointerId: 2, pointerType, button: 0, clientX: 10, clientY: y });
			return event as PointerEvent;
		};
	}
	const finger = pointer('touch');
	const mouse = pointer('mouse');

	/** How long a finger rests on a handle before it is holding the section. */
	const HELD_MS = 350;

	const press = (key: string): KeyboardEvent =>
		new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });

	const three = (): BlockView[] => [prose('one'), prose('two'), prose('three')];

	it('lands where a finger that held it drops it, and writes the one move', async () => {
		const blocks = three();
		open(blocks);
		stacked();

		grips()[0].dispatchEvent(finger('pointerdown', 20));
		await vi.advanceTimersByTimeAsync(HELD_MS);
		window.dispatchEvent(finger('pointermove', 130));
		window.dispatchEvent(finger('pointerup', 130));
		flushSync();

		expect(stack()).toEqual(['two', 'three', 'one']);
		await vi.advanceTimersByTimeAsync(5000);
		expect(written.moved).toEqual([{ ref: blocks[0].ref, after: blocks[2].ref }]);
	});

	// The gutter runs the length of the note and is where a thumb starts a
	// scroll, so a swipe from it has to stay a scroll — not a silent reordering
	// the writer never asked for and has nothing to undo it by.
	it('leaves a swipe up the gutter to the note, so the reading scrolls', async () => {
		open(three());
		stacked();

		grips()[2].dispatchEvent(finger('pointerdown', 100));
		window.dispatchEvent(finger('pointermove', 40));
		window.dispatchEvent(finger('pointerup', 20));
		flushSync();
		await vi.advanceTimersByTimeAsync(5000);

		expect(stack()).toEqual(['one', 'two', 'three']);
		expect(written.moved).toEqual([]);
	});

	it('writes nothing for a section dropped back where it was', async () => {
		open(three());
		stacked();

		grips()[1].dispatchEvent(finger('pointerdown', 60));
		await vi.advanceTimersByTimeAsync(HELD_MS);
		window.dispatchEvent(finger('pointermove', 70));
		window.dispatchEvent(finger('pointerup', 70));
		flushSync();

		expect(stack()).toEqual(['one', 'two', 'three']);
		await vi.advanceTimersByTimeAsync(5000);
		expect(written.moved).toEqual([]);
	});

	// Nothing to hold for: a mouse drag is not competing with a scroll.
	it('picks the section up the moment a mouse pulls it', async () => {
		const blocks = three();
		open(blocks);
		stacked();

		grips()[0].dispatchEvent(mouse('pointerdown', 20));
		window.dispatchEvent(mouse('pointermove', 130));
		window.dispatchEvent(mouse('pointerup', 130));
		flushSync();

		expect(stack()).toEqual(['two', 'three', 'one']);
		await vi.advanceTimersByTimeAsync(5000);
		expect(written.moved).toEqual([{ ref: blocks[0].ref, after: blocks[2].ref }]);
	});

	it('moves on the arrow keys too, for anyone reaching it without a pointer', async () => {
		const blocks = three();
		open(blocks);

		grips()[2].focus();
		grips()[2].dispatchEvent(press('ArrowUp'));
		flushSync();

		expect(stack()).toEqual(['one', 'three', 'two']);
		await vi.advanceTimersByTimeAsync(5000);
		expect(written.moved).toEqual([{ ref: blocks[2].ref, after: blocks[0].ref }]);
	});

	// The handle is rebuilt where the block landed, so the one that was under the
	// finger is a different element by then, and an unfocused one announces nothing.
	it('keeps the handle it was moved by, saying where the block is now', () => {
		open(three());

		grips()[2].focus();
		grips()[2].dispatchEvent(press('ArrowUp'));
		flushSync();

		const held = document.activeElement as HTMLElement;
		expect(held.dataset.blockHandle).toBeDefined();
		expect(held.getAttribute('aria-label')).toBe('Move section 2 of 3');
	});

	it('offers no handle on a note with nothing to put in order', () => {
		open([prose('only this')]);
		expect(grips()).toEqual([]);
	});
});

// The title above the note is a field of its own, and the key out of it has to
// land somewhere: the note page asks for this.
describe('the caret handed down from above the note', () => {
	it('puts it at the start of the writing', () => {
		const surface = open([prose('Cells divide')]) as unknown as { focusBody: () => void };
		const editor = writingIn();
		editor.commands.setTextSelection(editor.state.doc.content.size - 2);
		expect(editor.state.selection.from).not.toBe(Selection.atStart(editor.state.doc).from);

		surface.focusBody();

		expect(editor.state.selection.from).toBe(Selection.atStart(editor.state.doc).from);
	});
});

describe('a note that arrived holding writing', () => {
	const holding = (blocks: BlockView[]) =>
		open(blocks) as unknown as { carry: (text: string) => void };

	it('opens on what was written before it had somewhere to put it, and saves it', async () => {
		const stack = holding([]);
		stack.carry('two bars\n\nstill four seconds');
		flushSync();

		expect(writingIn().state.doc.textContent).toBe('two barsstill four seconds');
		await vi.advanceTimersByTimeAsync(5000);

		expect(written.created).toHaveLength(1);
		expect(wording(written.created[0].content as BlockDocument)).toEqual([
			'two bars',
			'still four seconds'
		]);
	});

	it('leaves a note that already says something exactly as it is', async () => {
		const stack = holding([prose('already here')]);
		stack.carry('never mind');
		flushSync();
		await vi.advanceTimersByTimeAsync(5000);

		expect(document.querySelector('.sloppy-prose')?.textContent).toBe('already here');
		expect(written).toEqual({ created: [], updated: [], removed: [], moved: [] });
	});
});
