// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import type { HeldPicture, NoteMedia, ShownPicture } from './contract.js';
import { noMedia, OWNER } from './editor.test-support.js';
import MediaPicker from './media-picker.svelte';

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
/** Every upload the grid has asked for, in the order it asked. */
let read: string[];
/** One reply per upload, held until the test lets it land. */
let answer: Map<string, (picture: ShownPicture) => void>;
let released: string[];
let scrolled: number;

const upload = (index: number) => `${OWNER}/0${index}`;

function library(count: number): HeldPicture[] {
	return Array.from({ length: count }, (_, index) => ({
		upload_id: upload(index),
		filename: `kite-${index}.png`,
		mime_type: 'image/png',
		size: 9
	}));
}

function shelf(held: HeldPicture[]): NoteMedia {
	return {
		...noMedia(),
		library: async () => held,
		picture: (uploadId) => {
			read.push(uploadId);
			return new Promise<ShownPicture>((resolve) => answer.set(uploadId, resolve));
		}
	};
}

function land(uploadId: string): void {
	answer.get(uploadId)?.({ src: `blob:${uploadId}`, release: () => released.push(uploadId) });
	answer.delete(uploadId);
}

/** Tiles `height` tall stacked inside a grid `viewport` tall, moved by `scrolled`. */
function laidOut(height: number, viewport: number): void {
	Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
		const label = this.getAttribute('aria-label') ?? '';
		const at = label.startsWith('kite-') ? Number.parseInt(label.slice(5), 10) : -1;
		if (at < 0) return { top: 0, bottom: viewport, height: viewport } as DOMRect;
		const top = at * height - scrolled;
		return { top, bottom: top + height, height } as DOMRect;
	};
}

async function settle(): Promise<void> {
	await new Promise((done) => setTimeout(done, 0));
	flushSync();
}

async function open(media: NoteMedia): Promise<void> {
	mounted = mount(MediaPicker, { target, props: { open: true, media, onpick: () => {} } });
	flushSync();
	await settle();
}

const tiles = (): HTMLElement[] => [
	...document.body.querySelectorAll<HTMLElement>('button[aria-label^="kite-"]')
];

beforeEach(() => {
	read = [];
	released = [];
	scrolled = 0;
	answer = new Map();
	stubResizeObserver();
	stubMediaQuery(() => false);
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
	document.body.innerHTML = '';
});

describe('the pictures already in a note', () => {
	it('reads only what somebody can see, and the rest as they scroll to it', async () => {
		laidOut(1000, 400);
		await open(shelf(library(6)));

		expect(tiles()).toHaveLength(6);
		expect(read).toEqual([upload(0), upload(1)]);

		scrolled = 2000;
		(tiles()[0].parentElement as HTMLElement).dispatchEvent(new Event('scroll'));
		land(read[0]);
		await settle();

		expect(read).toEqual([upload(0), upload(1), upload(2), upload(3)]);
	});

	// Every one of these is a whole original, and a phone asked for a grid of
	// them at once is the tab that never comes back.
	it('never has more than three of them in the air at once', async () => {
		laidOut(0, 0);
		await open(shelf(library(9)));

		expect(read).toHaveLength(3);

		land(read[0]);
		await settle();

		expect(read).toHaveLength(4);
	});

	it('lets go of what it held once the picker is shut', async () => {
		laidOut(0, 0);
		await open(shelf(library(3)));

		land(read[0]);
		await settle();
		expect(document.body.querySelector('img')).not.toBeNull();

		unmount(mounted as ReturnType<typeof mount>, { outro: false });
		mounted = undefined;
		flushSync();

		expect(released).toEqual([upload(0)]);
	});
});
