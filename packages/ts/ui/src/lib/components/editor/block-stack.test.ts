// @vitest-environment jsdom
import type { BlockView, CreateBlockRequest, InkStroke, MediaAsset, OwnedRef } from '@sloppy/types';
import type { Editor } from '@tiptap/core';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emojiCatalogs } from '../../emoji/catalogs.svelte.js';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import BlockStack from './block-stack.svelte';
import type { NoteEmoji, NoteMedia } from './contract.js';
import { NOTE, OWNER, block, ref, stubCanvas } from './editor.test-support.js';

interface Written {
	created: CreateBlockRequest[];
	updated: { ref: OwnedRef; content?: string; type?: string }[];
	removed: OwnedRef[];
}

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let written: Written;
/** Set to keep every create in flight until the test lets it answer. */
let answering: Promise<void> | null;

function open(blocks: BlockView[], able: { media?: NoteMedia; emoji?: NoteEmoji } = {}) {
	mounted = mount(BlockStack, {
		target,
		props: {
			...able,
			node: NOTE,
			blocks,
			onCreate: async (request: CreateBlockRequest) => {
				written.created.push(request);
				if (answering) await answering;
				return block({ ...request, type: request.type, ref: ref() });
			},
			onUpdate: async (block: OwnedRef, request: Record<string, unknown>) => {
				written.updated.push({ ref: block, ...request });
				return {} as BlockView;
			},
			onRemove: async (block: OwnedRef) => {
				written.removed.push(block);
			},
			onReorder: async () => ({}) as BlockView
		}
	});
	flushSync();
	return mounted;
}

function close(): void {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
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
	written = { created: [], updated: [], removed: [] };
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
	target.remove();
	document.body.innerHTML = '';
});

describe('opening a note', () => {
	it('shows what is written in it, as what it is', () => {
		open([
			block({ type: 'heading', content: '## A place to start' }),
			block({ type: 'todo', content: '- [x] read it again' })
		]);
		expect(document.querySelector('h2')?.textContent).toBe('A place to start');
		expect(document.querySelector('input[type="checkbox"]')).not.toBeNull();
	});

	it('shows a stored shortcode as the emoji it names', () => {
		open([block({ type: 'paragraph', content: 'a spark :fire: of it' })]);
		const glyph = document.querySelector('[data-emoji="fire"]');
		expect(glyph?.textContent).toBe('🔥');
		expect(document.querySelector('.sloppy-prose')?.textContent).not.toContain(':fire:');
	});

	it('writes nothing back for a note nobody has touched', async () => {
		open([block({ type: 'paragraph', content: 'left alone' })]);
		await vi.advanceTimersByTimeAsync(5000);
		expect(written).toEqual({ created: [], updated: [], removed: [] });
	});

	it('leaves a shortcode inside code exactly as it was written', async () => {
		open([
			block({ type: 'code', content: '```\ngit commit -m ":fire: remove dead code"\n```' }),
			block({ type: 'paragraph', content: 'type `:fire:` to get a flame' })
		]);
		expect(document.querySelector('pre')?.textContent).toBe(
			'git commit -m ":fire: remove dead code"'
		);
		expect(document.querySelector('p code')?.textContent).toBe(':fire:');
		expect(document.querySelector('[data-emoji]')).toBeNull();

		writingIn().commands.insertContentAt(1, 'sudo ');
		await vi.advanceTimersByTimeAsync(5000);
		expect(written.created).toEqual([]);
		expect(written.removed).toEqual([]);
		expect(written.updated.map((row) => row.content)).toEqual([
			'```\nsudo git commit -m ":fire: remove dead code"\n```'
		]);
	});
});

describe('a pen on the writing surface', () => {
	it('leaves a drawing in the note where it was drawn, with no mode to find', async () => {
		open([block({ type: 'paragraph', content: 'a thought' })]);
		const surface = target.querySelector('div.relative') as HTMLElement;

		surface.dispatchEvent(penEvent('pointerdown', 40, 60, 0.2));
		surface.dispatchEvent(penEvent('pointermove', 90, 100, 0.7));
		surface.dispatchEvent(penEvent('pointermove', 140, 150, 0.95));
		surface.dispatchEvent(penEvent('pointerup', 140, 150, 0.95));

		await vi.advanceTimersByTimeAsync(5000);

		expect(written.created).toHaveLength(1);
		const drawing = written.created[0];
		expect(drawing.type).toBe('ink');
		expect(drawing.content).toBe('');
		const data = drawing.data as { strokes: InkStroke[]; width: number; height: number };
		expect(data.strokes).toHaveLength(1);
		expect(data.strokes[0].points.map((point) => point.pressure)).toEqual([0.2, 0.7, 0.95]);
		expect(data.width).toBe(320);
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
		expect((written.created[0].data as { strokes: InkStroke[] }).strokes).toHaveLength(2);
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
		open([block({ type: 'paragraph', content: 'a thought' })]);
		writingIn().commands.insertContentAt(1, 'more of ');
		await vi.advanceTimersByTimeAsync(100);
		expect(written.updated).toEqual([]);

		close();
		await vi.advanceTimersByTimeAsync(0);
		expect(written.updated.map((row) => row.content)).toEqual(['more of a thought']);
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
		expect(written.created.map((row) => row.type)).toEqual(['ink']);
	});

	it('makes a block once when the note is closed while it is still being made', async () => {
		let answer = () => {};
		answering = new Promise<void>((resolve) => (answer = resolve));

		open([block({ type: 'paragraph', content: 'a thought' })]);
		const of = writingIn();
		of.commands.setTextSelection(of.state.doc.content.size - 1);
		of.commands.splitBlock();
		of.commands.insertContent('and another');
		await vi.advanceTimersByTimeAsync(1000);
		expect(written.created.map((row) => row.content)).toEqual(['and another']);

		close();
		answer();
		await vi.advanceTimersByTimeAsync(1000);
		expect(written.created.map((row) => row.content)).toEqual(['and another']);
	});

	it('writes what is unsaved when the app goes to the background', async () => {
		open([block({ type: 'paragraph', content: 'a thought' })]);
		writingIn().commands.insertContentAt(1, 'more of ');
		await vi.advanceTimersByTimeAsync(100);

		background();
		await vi.advanceTimersByTimeAsync(0);
		expect(written.updated.map((row) => row.content)).toEqual(['more of a thought']);
	});

	it('writes what is still being typed rather than waiting for a pause that never comes', async () => {
		open([block({ type: 'paragraph', content: 'a thought' })]);
		for (let keystroke = 0; keystroke < 20; keystroke += 1) {
			writingIn().commands.insertContentAt(1, '.');
			await vi.advanceTimersByTimeAsync(200);
		}
		expect(written.updated.map((row) => row.content)).toEqual(['...............a thought']);
	});
});

/** The writing area itself, rather than the editor hung off it. */
const surface = (): HTMLElement => target.querySelector('.sloppy-prose') as HTMLElement;

describe('the writing controls', () => {
	// Pinned to the viewport they covered whatever the page put under the note,
	// at every width, with no scroll that reached it.
	it('sit in the note rather than over the page', () => {
		open([block({ type: 'paragraph', content: 'a thought' })]);
		surface().dispatchEvent(new FocusEvent('focus', { bubbles: true }));
		flushSync();

		const bar = target.querySelector('[role="toolbar"]');
		expect(bar).not.toBeNull();
		expect(bar?.closest('.fixed')).toBeNull();
		expect(bar?.closest('.sticky')).not.toBeNull();
	});
});

describe('a picture in a note', () => {
	/** A send the test lets land when it chooses. */
	function sender() {
		let land: (asset: MediaAsset) => void = () => {};
		const landed = new Promise<MediaAsset>((resolve) => (land = resolve));
		const reported: number[] = [];
		const media: NoteMedia = {
			send: (_file, report) => {
				report(0.5);
				reported.push(0.5);
				return { asset: landed, cancel: () => {} };
			},
			picture: async (uploadId) => ({ src: `blob:${uploadId}`, release: () => {} })
		};
		return { media, reported, land: (asset: MediaAsset) => land(asset) };
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

		expect(written.created).toEqual([
			expect.objectContaining({
				type: 'image',
				data: { upload_id: `${OWNER}/01UP`, width: 40, height: 20 }
			})
		]);
	});
});

describe('a shortcode its author uploaded a picture for', () => {
	const CATALOG = [{ id: 'e1', shortcode: 'parrot', src: '/proxy?ref=parrot', sticker: false }];

	it('draws the picture, and is still stored as the shortcode', async () => {
		open([block({ type: 'paragraph', content: 'look :parrot: look' })], {
			emoji: { catalog: async () => CATALOG }
		});
		await vi.advanceTimersByTimeAsync(0);
		flushSync();

		const drawn = target.querySelector('img.sloppy-emoji-picture');
		expect(drawn?.getAttribute('src')).toBe('/proxy?ref=parrot');
		expect(writingIn().storage.markdown.manager.serialize(writingIn().getJSON())).toContain(
			':parrot:'
		);
	});
});
