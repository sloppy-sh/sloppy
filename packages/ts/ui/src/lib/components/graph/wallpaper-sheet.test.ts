// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import type { HeldPicture, NoteMedia } from '../editor/contract.js';
import WallpaperSheet from './wallpaper-sheet.svelte';

type Choice = { uploads: string[]; strength: number; every: number };

const TURNS = [
	{ value: 30, label: 'Every half hour' },
	{ value: 60, label: 'Hourly' }
];

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let changed: Choice[];
let held: HeldPicture[];

const picture = (id: string): HeldPicture => ({
	upload_id: id,
	filename: `${id}.webp`,
	mime_type: 'image/webp',
	size: 9
});

const media: Pick<NoteMedia, 'library' | 'picture'> = {
	picture: async (uploadId) => ({ src: `blob:${uploadId}`, release: () => {} }),
	library: async () => held
};

async function open(choice: Choice) {
	if (mounted) unmount(mounted, { outro: false });
	document.body.innerHTML = '';
	target = document.createElement('div');
	document.body.appendChild(target);
	changed = [];
	mounted = mount(WallpaperSheet, {
		target,
		props: {
			open: true,
			media,
			turns: TURNS,
			choice,
			onchange: (next: Choice) => changed.push(next)
		}
	});
	// The library is read in an effect and answered on a promise, so settling is
	// what makes the grid there to assert on.
	for (let at = 0; at < 8; at++) {
		flushSync();
		await new Promise((done) => setTimeout(done, 0));
	}
	flushSync();
}

const tiles = () => [...document.body.querySelectorAll<HTMLElement>('button[aria-pressed]')];
const strength = () => document.body.querySelector<HTMLInputElement>('input[type="range"]');
const says = () => document.body.textContent ?? '';

beforeEach(() => {
	stubResizeObserver();
	stubMediaQuery(() => false);
	held = [picture('a'), picture('b')];
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
	document.body.innerHTML = '';
});

describe('choosing the picture under the graph', () => {
	it('offers what the reader has already put in a note', async () => {
		await open({ uploads: [], strength: 0.25, every: 60 });
		expect(tiles().map((tile) => tile.getAttribute('aria-label'))).toEqual(['a.webp', 'b.webp']);
		expect(tiles().every((tile) => tile.getAttribute('aria-pressed') === 'false')).toBe(true);
	});

	it('adds one to the turn and takes it back out', async () => {
		await open({ uploads: [], strength: 0.25, every: 60 });
		tiles()[1].click();
		expect(changed[0].uploads).toEqual(['b']);

		await open({ uploads: ['b'], strength: 0.25, every: 60 });
		expect(tiles()[1].getAttribute('aria-pressed')).toBe('true');
		tiles()[1].click();
		expect(changed[0].uploads).toEqual([]);
	});

	it('keeps the order the pictures were picked in', async () => {
		await open({ uploads: ['b', 'a'], strength: 0.25, every: 60 });
		expect(tiles().map((tile) => tile.textContent?.trim())).toEqual(['2', '1']);
	});

	// A strength and a cadence with no picture to apply them to is a question
	// about nothing.
	it('asks nothing about a picture nobody has chosen', async () => {
		await open({ uploads: [], strength: 0.25, every: 60 });
		expect(strength()).toBeNull();
		expect(says()).not.toContain('How much shows');
	});

	it('asks how much shows as soon as there is one', async () => {
		await open({ uploads: ['a'], strength: 0.4, every: 60 });
		expect(strength()?.value).toBe('40');
		expect(says()).not.toContain('Takes turns');
	});

	it('asks about turns only where there is more than one to take them', async () => {
		await open({ uploads: ['a', 'b'], strength: 0.4, every: 30 });
		expect(says()).toContain('Takes turns');
		expect(says()).toContain('Every half hour');
	});

	// DESIGN.md § Layout: the graph's chrome is thumb-sized, and this surface is
	// on the phone as much as on the desk.
	it('offers controls a thumb can land on', async () => {
		await open({ uploads: ['a', 'b'], strength: 0.4, every: 30 });
		expect(strength()?.className).toContain('h-11');
		const turn = document.body.querySelector<HTMLElement>('[data-slot="select-trigger"]');
		expect(turn?.className).toContain('h-11');
		for (const tile of tiles()) expect(tile.className).toContain('aspect-square');
	});
});
