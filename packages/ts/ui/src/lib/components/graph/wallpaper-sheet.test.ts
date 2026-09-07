// @vitest-environment jsdom
import type { MediaAsset, PictureSeries } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import type { HeldPicture, NoteMedia } from '../editor/contract.js';
import WallpaperSheet from './wallpaper-sheet.svelte';

type Choice = PictureSeries & { strength: number };

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let changed: Choice[];
let held: HeldPicture[];
let sent: File[];
let removed: string[];
/** What the store says when it will not let a picture go; null where it does. */
let refuseRemoval: string | null;

const picture = (id: string): HeldPicture => ({
	upload_id: id,
	filename: `${id}.webp`,
	mime_type: 'image/webp',
	size: 9
});

const moving = (id: string): HeldPicture => ({ ...picture(id), mime_type: 'image/gif' });

const media: NoteMedia = {
	send(file) {
		sent.push(file);
		const asset: MediaAsset = { upload_id: 'sent-1', mime_type: file.type, size: file.size };
		held = [...held, { ...asset, filename: file.name }];
		return { asset: Promise.resolve(asset), cancel: () => {} };
	},
	picture: async (uploadId) => ({ src: `blob:${uploadId}`, release: () => {} }),
	library: async () => held,
	remove: async (uploadId) => {
		if (refuseRemoval) throw new Error(refuseRemoval);
		removed.push(uploadId);
		held = held.filter((one) => one.upload_id !== uploadId);
	}
};

/** A ground nobody has said anything about beyond which pictures are on it. */
function ground(pictures: string[], over: Partial<Choice> = {}): Choice {
	return { pictures, strength: 0.25, every: 60, transition: 'fade', ...over };
}

async function settle(): Promise<void> {
	for (let at = 0; at < 8; at++) {
		flushSync();
		await new Promise((done) => setTimeout(done, 0));
	}
	flushSync();
}

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
			choice,
			onchange: (next: Choice) => changed.push(next)
		}
	});
	// The library is read in an effect and answered on a promise, so settling is
	// what makes the grid there to assert on.
	await settle();
}

/** The grid's own tiles: every one of them stands for a picture, and is named
 *  by it. */
const tiles = () => [
	...document.body.querySelectorAll<HTMLElement>('button[aria-pressed][aria-label]')
];
const strength = () => document.body.querySelector<HTMLInputElement>('input[type="range"]');
const says = () => document.body.textContent ?? '';

const named = (label: string): HTMLButtonElement => {
	const found = [...document.body.querySelectorAll('button')].find(
		(button) => button.textContent?.trim() === label
	);
	if (!found) throw new Error(`no control named ${label}`);
	return found;
};

beforeEach(() => {
	stubResizeObserver();
	stubMediaQuery(() => false);
	held = [picture('a'), picture('b')];
	sent = [];
	removed = [];
	refuseRemoval = null;
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
		await open(ground([]));
		expect(tiles().map((tile) => tile.getAttribute('aria-label'))).toEqual(['a.webp', 'b.webp']);
		expect(tiles().every((tile) => tile.getAttribute('aria-pressed') === 'false')).toBe(true);
	});

	// A background may move if that is what somebody wants behind their graph.
	it('offers a picture that animates like any other', async () => {
		held = [picture('a'), moving('spin'), picture('b')];

		await open(ground([]));

		expect(tiles().map((tile) => tile.getAttribute('aria-label'))).toEqual([
			'a.webp',
			'spin.webp',
			'b.webp'
		]);
	});

	it('adds one to the turn and takes it back out', async () => {
		await open(ground([]));
		tiles()[1].click();
		expect(changed[0].pictures).toEqual(['b']);

		await open(ground(['b']));
		expect(tiles()[1].getAttribute('aria-pressed')).toBe('true');
		tiles()[1].click();
		expect(changed[0].pictures).toEqual([]);
	});

	it('keeps the order the pictures were picked in', async () => {
		await open(ground(['b', 'a']));
		expect(tiles().map((tile) => tile.textContent?.trim())).toEqual(['2', '1']);
	});

	// A strength and a cadence with no picture to apply them to is a question
	// about nothing.
	it('asks nothing about a picture nobody has chosen', async () => {
		await open(ground([]));
		expect(strength()).toBeNull();
		expect(says()).not.toContain('How much shows');
	});

	it('asks how much shows as soon as there is one', async () => {
		await open(ground(['a'], { strength: 0.4 }));
		expect(strength()?.value).toBe('40');
		expect(says()).not.toContain('Takes turns');
	});

	it('asks about turns only where there is more than one to take them', async () => {
		await open(ground(['a', 'b'], { every: 30 }));
		expect(says()).toContain('Takes turns');
		expect(says()).toContain('Every half hour');
	});

	// The cadences are an open set, so one a newer Sloppy offered still has to
	// read as itself rather than as the shortest one this build knows.
	it('reads back a cadence it does not offer as the one that is stored', async () => {
		await open(ground(['a', 'b'], { every: 10_080 }));
		expect(says()).toContain('Every 7 days');
		expect(says()).not.toContain('Every five minutes');
	});

	// DESIGN.md § Layout: the graph's chrome is thumb-sized, and this surface is
	// on the phone as much as on the desk.
	it('offers controls a thumb can land on', async () => {
		await open(ground(['a', 'b'], { every: 30 }));
		expect(strength()?.className).toContain('h-11');
		const turn = document.body.querySelector<HTMLElement>('[data-slot="select-trigger"]');
		expect(turn?.className).toContain('h-11');
		for (const tile of tiles()) expect(tile.className).toContain('aspect-square');
	});
});

// DESIGN.md § "A picture that takes turns": the ground and a mark read one model,
// so a reader who has learnt this on one has learnt it on the other.
describe('how one picture gives way to the next', () => {
	it('is not asked about a ground that never changes', async () => {
		await open(ground(['a']));
		expect(says()).not.toContain('How it changes');
	});

	it('offers the three, and keeps the one already chosen', async () => {
		await open(ground(['a', 'b'], { transition: 'slide' }));
		expect(says()).toContain('How it changes');
		for (const word of ['Crossfade', 'Slide', 'Slow zoom']) expect(says()).toContain(word);
		expect(named('Slide').getAttribute('aria-pressed')).toBe('true');
	});

	it('changes it without disturbing the rest of the ground', async () => {
		await open(ground(['a', 'b'], { strength: 0.4, every: 30 }));
		named('Slow zoom').click();
		expect(changed).toEqual([
			{ pictures: ['a', 'b'], strength: 0.4, every: 30, transition: 'zoom' }
		]);
	});
});

// A sheet that lists only what is already in a note leaves a reader who has
// added none with nowhere to go, so a picture can be got from here.
describe('getting a picture in from here', () => {
	async function choose(file: File): Promise<void> {
		named('Choose a picture').click();
		await settle();
		const chooser = document.body.querySelector('input[type="file"]') as HTMLInputElement;
		Object.defineProperty(chooser, 'files', { configurable: true, value: [file] });
		chooser.dispatchEvent(new Event('change', { bubbles: true }));
		await settle();
	}

	it('offers a way to add one where the reader has none', async () => {
		held = [];
		await open(ground([]));
		expect(tiles()).toEqual([]);
		expect(named('Choose a picture')).toBeTruthy();
	});

	it('puts the picture it added straight behind the graph', async () => {
		held = [];
		await open(ground([]));
		await choose(new File([new Uint8Array(90)], 'kite.webp', { type: 'image/webp' }));

		expect(sent.map((file) => file.name)).toEqual(['kite.webp']);
		expect(changed.at(-1)?.pictures).toEqual(['sent-1']);
	});

	// The sheet is already showing every picture in their notes, and a second copy
	// of that grid is a phone gone two full surfaces deep for one picture.
	it('does not ask again for what the sheet is already offering', async () => {
		await open(ground([]));
		expect(tiles().map((tile) => tile.getAttribute('aria-label'))).toEqual(['a.webp', 'b.webp']);

		named('Choose a picture').click();
		await settle();

		expect(document.body.querySelectorAll('button[aria-label="b.webp"]')).toHaveLength(1);
		expect(says()).not.toContain('Already in your notes');
	});

	// The picker is a note's as much as the graph's, and it says which.
	it('says the picture it is asking for is the graph', async () => {
		await open(ground([]));
		named('Choose a picture').click();
		await settle();

		expect(says()).toContain('It goes behind the graph.');
		expect(says()).not.toContain('Add one to this note.');
	});
});

describe('taking a picture out of the store from here', () => {
	async function dropFirst(): Promise<void> {
		named('Edit').click();
		await settle();
		const tile = document.body.querySelector<HTMLButtonElement>(
			'button[aria-label="Remove a.webp"]'
		);
		if (!tile) throw new Error('the sheet offers no removal');
		tile.click();
		await settle();
		named('Remove').click();
		await settle();
	}

	it('offers no removal until the reader asks to edit', async () => {
		await open(ground([]));
		expect(document.body.querySelector('button[aria-label="Remove a.webp"]')).toBeNull();
	});

	it('takes it out of the store and stops offering it', async () => {
		await open(ground([]));

		await dropFirst();

		expect(removed).toEqual(['a']);
		expect(document.body.querySelector('button[aria-label="Remove a.webp"]')).toBeNull();
	});

	// A ground still naming a picture nobody holds any more has nothing to draw.
	it('takes it off the graph it was under', async () => {
		await open(ground(['a', 'b']));

		await dropFirst();

		expect(changed.at(-1)?.pictures).toEqual(['b']);
	});

	it('keeps the picture and says why when the store will not let it go', async () => {
		await open(ground(['a']));
		refuseRemoval = 'That picture is in use just now.';

		await dropFirst();

		expect(says()).toContain('That picture is in use just now.');
		expect(changed).toEqual([]);
	});
});
