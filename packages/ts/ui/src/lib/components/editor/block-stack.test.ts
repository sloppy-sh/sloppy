// @vitest-environment jsdom
import type { BlockView, CreateBlockRequest, InkStroke, OwnedRef } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import BlockStack from './block-stack.svelte';
import { NOTE, block, ref, stubCanvas } from './editor.test-support.js';

interface Written {
	created: CreateBlockRequest[];
	updated: { ref: OwnedRef; content?: string; type?: string }[];
	removed: OwnedRef[];
}

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let written: Written;

function open(blocks: BlockView[]) {
	mounted = mount(BlockStack, {
		target,
		props: {
			node: NOTE,
			blocks,
			onCreate: async (request: CreateBlockRequest) => {
				written.created.push(request);
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
	stubResizeObserver();
	stubMediaQuery(() => false);
	stubCanvas();
	Element.prototype.getBoundingClientRect = () =>
		({ left: 0, top: 0, width: 320, height: 240, right: 320, bottom: 240 }) as DOMRect;
	Element.prototype.setPointerCapture = () => {};
	Element.prototype.releasePointerCapture = () => {};
	target = document.createElement('div');
	document.body.appendChild(target);
	vi.useFakeTimers();
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
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
