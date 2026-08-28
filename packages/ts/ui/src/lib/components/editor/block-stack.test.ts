// @vitest-environment jsdom
import type { BlockView, CreateBlockRequest, InkStroke, MediaAsset, OwnedRef } from '@sloppy/types';
import type { Editor } from '@tiptap/core';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emojiCatalogs } from '../../emoji/catalogs.svelte.js';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import BlockStack from './block-stack.svelte';
import type { NoteEmoji, NoteMedia } from './contract.js';
import { NOTE, OWNER, block, noEmoji, noMedia, ref, stubCanvas } from './editor.test-support.js';

interface Written {
	created: CreateBlockRequest[];
	updated: { ref: OwnedRef; content?: string; type?: string }[];
	removed: OwnedRef[];
	moved: { ref: OwnedRef; after: OwnedRef | null }[];
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
			media: able.media ?? noMedia(),
			emoji: able.emoji ?? noEmoji(),
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

/** Every block row the document currently describes, by node kind. */
function topLevel(of: Editor): string[] {
	const names: string[] = [];
	of.state.doc.forEach((child) => names.push(child.type.name));
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
		expect(written).toEqual({ created: [], updated: [], removed: [], moved: [] });
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
	// Pinned to the viewport they cover whatever the page puts under the note, at
	// every width, with no scroll that reaches it.
	it('sit in the note rather than over the page', () => {
		open([block({ type: 'paragraph', content: 'a thought' })]);
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
		open([block({ type: 'paragraph', content: 'a thought' })]);
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

		expect(written.created).toEqual([
			expect.objectContaining({
				type: 'image',
				data: { upload_id: `${OWNER}/01UP`, width: 40, height: 20 }
			})
		]);
	});

	// A picture nested in a list item is below the top level, where neither the
	// save plan nor the send that fills it can find it again.
	it('stands on its own even when the writing was in a list', async () => {
		const { media, land } = sender();
		open([block({ type: 'list', content: '- one\n- two' })], { media });
		const of = writingIn();
		of.commands.setTextSelection(of.state.doc.content.size - 4);
		surface().dispatchEvent(new FocusEvent('focus', { bubbles: true }));
		flushSync();
		await choose(new File(['x'], 'kite.png', { type: 'image/png' }));

		expect(of.state.doc.firstChild?.type.name).toBe('bulletList');
		expect(topLevel(of)).toContain('picture');

		land({ upload_id: `${OWNER}/01UP`, mime_type: 'image/png', size: 1 });
		await vi.advanceTimersByTimeAsync(4000);

		expect(written.created.map((row) => row.type)).toEqual(['image']);
		expect(written.updated).toEqual([]);
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

		expect(written.created).toEqual([
			expect.objectContaining({ type: 'image', data: { upload_id: `${OWNER}/01OLD` } })
		]);
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
		expect(written.created.map((row) => row.type)).toEqual(['image']);
	});

	it('says so when it cannot be drawn, rather than showing an empty frame', async () => {
		open([block({ type: 'image', data: { upload_id: `${OWNER}/01UP` } })]);
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

	it('draws the picture, and is still stored as the shortcode', async () => {
		open([block({ type: 'paragraph', content: 'look :seedling: look' })], {
			emoji: noEmoji(CATALOG)
		});
		await vi.advanceTimersByTimeAsync(0);
		flushSync();

		const drawn = target.querySelector('img.sloppy-emoji-picture');
		expect(drawn?.getAttribute('src')).toBe('/proxy?ref=seedling');
		expect(target.querySelector('.sloppy-prose')?.textContent).not.toContain('🌱');
		expect(writingIn().storage.markdown.manager.serialize(writingIn().getJSON())).toContain(
			':seedling:'
		);
	});

	it('writes nothing back for a note that only had its emoji drawn', async () => {
		open([block({ type: 'paragraph', content: 'look :seedling: look' })], {
			emoji: noEmoji(CATALOG)
		});
		await vi.advanceTimersByTimeAsync(5000);

		expect(written).toEqual({ created: [], updated: [], removed: [], moved: [] });
	});

	it('keeps the small form a note was written in, whatever the catalog says', async () => {
		open([block({ type: 'paragraph', content: 'look :seedling: look' })], {
			emoji: noEmoji([{ ...CATALOG[0], sticker: true }])
		});
		await vi.advanceTimersByTimeAsync(0);
		flushSync();
		writingIn().commands.insertContentAt(1, 'X');
		await vi.advanceTimersByTimeAsync(5000);

		expect(written.updated.map((row) => row.content)).toEqual(['Xlook :seedling: look']);
	});

	it('leaves a name the catalog does not claim as the emoji Unicode gives it', async () => {
		open([block({ type: 'paragraph', content: 'a spark :fire: of it' })], {
			emoji: noEmoji(CATALOG)
		});
		await vi.advanceTimersByTimeAsync(0);
		flushSync();

		expect(target.querySelector('[data-emoji="fire"]')?.textContent).toBe('🔥');
		expect(target.querySelector('img.sloppy-emoji-picture')).toBeNull();
	});
});

describe('putting a block somewhere else in the stack', () => {
	/** Rows 40 tall and stacked, so a drag has somewhere to aim at. */
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
		[...target.querySelectorAll('.sloppy-prose > p')].map((row) => row.textContent);

	function pointer(pointerType: string) {
		return (type: string, y: number): PointerEvent => {
			const event = new Event(type, { bubbles: true, cancelable: true });
			Object.assign(event, { pointerId: 2, pointerType, button: 0, clientX: 10, clientY: y });
			return event as PointerEvent;
		};
	}
	const finger = pointer('touch');
	const mouse = pointer('mouse');

	/** How long a finger rests on a handle before it is holding the block. */
	const HELD_MS = 350;

	const press = (key: string): KeyboardEvent =>
		new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });

	const three = (): BlockView[] => [
		block({ type: 'paragraph', content: 'one' }),
		block({ type: 'paragraph', content: 'two' }),
		block({ type: 'paragraph', content: 'three' })
	];

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

	it('writes nothing for a block dropped back where it was', async () => {
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
	it('picks the block up the moment a mouse pulls it', async () => {
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
		expect(held.getAttribute('aria-label')).toBe('Move block 2 of 3');
	});

	it('offers no handle on a note with nothing to put in order', () => {
		open([block({ type: 'paragraph', content: 'only this' })]);
		expect(grips()).toEqual([]);
	});
});
