// @vitest-environment jsdom
import type { Tag } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import NotePreview from './note-preview.svelte';

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

const note = (over: Record<string, unknown> = {}) => ({
	address: '1a3',
	title: 'What a run of thought is for',
	tags: ['seed', 'question'] as Tag[],
	picture: false,
	folded: 0,
	...over
});

function show(props: Record<string, unknown> = {}) {
	mounted = mount(NotePreview, {
		target,
		props: {
			at: { clientX: 200, clientY: 300, radius: 12 },
			note: note(),
			selected: [] as Tag[],
			...props
		}
	});
	flushSync();
}

const card = () => target.querySelector<HTMLElement>('[aria-hidden="true"]');

type Mark = { clientX: number; clientY: number; radius: number };

/** Whether the mark is still visible with the card placed. jsdom lays nothing
 *  out, so this reads the edge the card anchored itself by — the one it grows
 *  away from, which is the only edge its placement decided. */
function clearOf(mark: Mark): boolean {
	const style = card()!.style;
	const left = Number.parseFloat(style.left);
	const width = Number.parseFloat(style.width);
	if (mark.clientX + mark.radius <= left) return true;
	if (mark.clientX - mark.radius >= left + width) return true;
	if (style.top !== '') return mark.clientY + mark.radius <= Number.parseFloat(style.top);
	return mark.clientY - mark.radius >= window.innerHeight - Number.parseFloat(style.bottom);
}

beforeEach(() => {
	Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
	Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	document.documentElement.style.removeProperty('--reading-dock-inset-right');
	document.documentElement.style.removeProperty('--app-chrome-inset-start');
	target.remove();
});

describe('the note preview', () => {
	it('says what the mark is', () => {
		show({ note: note({ picture: true, folded: 12 }) });
		const text = card()?.textContent ?? '';

		expect(text).toContain('1a3');
		expect(text).toContain('What a run of thought is for');
		expect(text).toContain('seed');
		expect(text).toContain('+12 folded');
		expect(card()?.querySelector('svg')).not.toBeNull();
	});

	// The mark is what the reader is pointing at; a card over it answers a
	// question by hiding the thing it is about.
	it('sits beside the mark, never over it', () => {
		const mark = { clientX: 200, clientY: 300, radius: 12 };
		show({ at: mark });

		expect(card()?.style.left).toBe('224px');
		expect(card()?.style.top).toBe('300px');
		expect(clearOf(mark)).toBe(true);
	});

	it('turns back from the edges it would hang off', () => {
		show({ at: { clientX: 1180, clientY: 700, radius: 10 } });

		expect(Number.parseFloat(card()?.style.left ?? '')).toBeLessThanOrEqual(1200 - 264 - 8);
		// Anchored by its foot, so a card near the bottom grows upward.
		expect(card()?.style.bottom).toBe('100px');
		expect(card()?.style.top).toBe('');
	});

	// A narrow window with a pointer in it is real: a trackpad in Split View is
	// the one pointer this whole feature answers. There the card is wider than
	// the room beside the mark, so it goes under or over the mark instead.
	it('goes clear of the mark where neither side of it has room', () => {
		Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 });
		const mark = { clientX: 250, clientY: 300, radius: 10 };
		show({ at: mark });
		const style = card()!.style;

		expect(clearOf(mark)).toBe(true);
		expect(Number.parseFloat(style.left)).toBeGreaterThanOrEqual(8);
		expect(Number.parseFloat(style.left) + Number.parseFloat(style.width)).toBeLessThanOrEqual(492);
	});

	it('narrows rather than hanging off a window smaller than it', () => {
		Object.defineProperty(window, 'innerWidth', { configurable: true, value: 240 });
		const mark = { clientX: 120, clientY: 600, radius: 8 };
		show({ at: mark });

		expect(card()?.style.width).toBe('224px');
		expect(card()?.style.left).toBe('8px');
		expect(clearOf(mark)).toBe(true);
	});

	// A note docked beside the graph takes the right of the screen, and the card
	// belongs to the graph — DESIGN.md § "The four inset vars".
	it('stays inside the room a docked note leaves the graph', () => {
		document.documentElement.style.setProperty('--reading-dock-inset-right', '544px');
		const mark = { clientX: 620, clientY: 300, radius: 10 };
		show({ at: mark });
		const style = card()!.style;

		expect(Number.parseFloat(style.left) + Number.parseFloat(style.width)).toBeLessThanOrEqual(
			1200 - 544 - 8
		);
		expect(clearOf(mark)).toBe(true);
	});

	// The chrome beside the graph takes the leading edge the same way, and it is
	// the side the card falls back to once the docked note has taken the other.
	it('stays inside the room the chrome beside the graph leaves it', () => {
		document.documentElement.style.setProperty('--app-chrome-inset-start', '256px');
		document.documentElement.style.setProperty('--reading-dock-inset-right', '544px');
		const mark = { clientX: 380, clientY: 300, radius: 10 };
		show({ at: mark });
		const style = card()!.style;

		expect(Number.parseFloat(style.left)).toBeGreaterThanOrEqual(256 + 8);
		expect(Number.parseFloat(style.left) + Number.parseFloat(style.width)).toBeLessThanOrEqual(
			1200 - 544 - 8
		);
		expect(clearOf(mark)).toBe(true);
	});

	// DESIGN.md § Hue: the rail hands out the hues in selection order, and the
	// card is reading the same answer back.
	it('draws a selected tag in the hue the rail gave it', () => {
		show({ selected: ['question'] as Tag[] });
		const dot = card()?.querySelector<HTMLElement>('span[style*="--facet-"]');

		expect(dot?.getAttribute('style')).toContain('var(--facet-1)');
		expect(card()?.textContent).toContain('seed');
	});

	// A mega-node stands for every tag under it, which is more than fits. The
	// ones the reader asked about are the ones that must not be the ones cut.
	it('leads with the tags the reader selected, and counts the rest', () => {
		const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g'] as Tag[];
		show({ note: note({ tags: many }), selected: ['g', 'f'] as Tag[] });
		const chips = [...(card()?.querySelectorAll('span.rounded-full.border') ?? [])];

		expect(chips.map((chip) => chip.textContent?.trim())).toEqual(['g', 'f', 'a', 'b', 'c']);
		expect(card()?.textContent).toContain('+2');
	});

	it('draws nothing with no mark under the pointer, or no note in hand', () => {
		show({ at: null });
		expect(card()).toBeNull();
		unmount(mounted!, { outro: false });

		show({ note: undefined });
		expect(card()).toBeNull();
	});

	it('takes no pointer, so a click lands on the canvas under it', () => {
		show();
		expect(card()?.className).toContain('pointer-events-none');
	});
});
