// What somebody offering a change on a note they do not write reads back
// before it goes.

import 'fake-indexeddb/auto';
import { compassNode, type BlockDocument, type Compass, type OwnedRef } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { node, ref, useFakeApi, type FakeApi } from '../stores/fake-api.test-support.js';
import { nodes } from '../stores/nodes.svelte.js';
import OfferChange from './offer-change.svelte';
import type { WritingSide } from './offer-difference.js';

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let api: FakeApi;

const NOTE = ref(1);
const SECTION = ref(2);
const LARGER = node(3, '1', { title: 'Stomata' });
const NOWHERE: Compass = { north: [], south: [], east: [], west: [] };

function path(of: OwnedRef): string {
	const cut = of.lastIndexOf('/');
	return `/nodes/${encodeURIComponent(of.slice(0, cut))}/${encodeURIComponent(of.slice(cut + 1))}`;
}

function words(said: string): BlockDocument {
	return {
		type: 'doc',
		content: [{ type: 'paragraph', content: [{ type: 'text', text: said }] }]
	};
}

function pointing(slots: Partial<Compass>, said = 'The decision'): WritingSide {
	const content: BlockDocument = {
		type: 'doc',
		content: [
			{ type: 'paragraph', content: [{ type: 'text', text: said }] },
			compassNode({ ...NOWHERE, ...slots })
		]
	};
	return { title: 'Guard cells', tags: [], sections: [{ ref: SECTION, content }] };
}

function show(now: WritingSide, offered: WritingSide): void {
	mounted = mount(OfferChange, {
		target,
		props: {
			open: true,
			note: NOTE,
			owner: 'Ada',
			now,
			offered,
			onOffer: async () => {}
		}
	});
	flushSync();
}

const screen = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

async function settled(): Promise<void> {
	for (let turn = 0; turn < 8; turn += 1) {
		await new Promise((done) => setTimeout(done, 0));
		flushSync();
	}
}

beforeEach(() => {
	api = useFakeApi();
	api.on(`GET ${path(LARGER.ref)}`, () => LARGER);
	nodes.clear();
	Element.prototype.hasPointerCapture = () => false;
	Element.prototype.setPointerCapture = () => {};
	Element.prototype.releasePointerCapture = () => {};
	Element.prototype.scrollIntoView = () => {};
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: (query: string) => ({
			matches: query.includes('min-width'),
			addEventListener: () => {},
			removeEventListener: () => {}
		})
	});
	Object.defineProperty(globalThis, 'ResizeObserver', {
		configurable: true,
		writable: true,
		value: class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	});
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
	document.body.innerHTML = '';
});

describe('offering a change to where a note points', () => {
	// The slot that moved is what the offer is about, and a block of changed
	// markup says the same thing less clearly — DESIGN.md § "The compass card".
	it('reads as the slot that gained a note', async () => {
		show(pointing({}), pointing({ north: [LARGER.ref] }));
		await settled();

		expect(screen()).toContain('Part of: gained Stomata');
		expect(screen()).not.toContain('Edited');
	});

	it('says which slot no longer points at a note', async () => {
		show(pointing({ west: [LARGER.ref] }), pointing({}));
		await settled();

		expect(screen()).toContain('Instead of: no longer Stomata');
	});

	it('still reads the writing where the section changed around the compass', async () => {
		show(pointing({}, 'The decision'), pointing({ north: [LARGER.ref] }, 'Sharpened'));
		await settled();

		expect(screen()).toContain('Part of: gained Stomata');
		expect(screen()).toContain('Sharpened');
	});

	it('says nothing has changed where nothing has', async () => {
		show(pointing({}), pointing({}));
		await settled();

		expect(screen()).toContain('You have not changed anything yet.');
	});
});

describe('offering a look on a line', () => {
	function saying(edges: WritingSide['edges']): WritingSide {
		return {
			title: 'Guard cells',
			tags: [],
			...(edges === undefined ? {} : { edges }),
			sections: [{ ref: SECTION, content: words('The decision') }]
		};
	}

	it('names the note at the other end and what the look says', async () => {
		show(
			saying([]),
			saying([{ to: LARGER.ref, label: 'follows from', direction: 'to', stroke: 'dashed' }])
		);
		await settled();

		expect(screen()).toContain('Line to Stomata: \u201cfollows from\u201d, \u2192, dashed');
	});

	it('says a line the offer takes the look off carries no look', async () => {
		show(saying([{ to: LARGER.ref, label: 'follows from' }]), saying([]));
		await settled();

		expect(screen()).toContain('Line to Stomata: no look');
	});

	// Absent is an offer that says nothing about the lines, which is every offer
	// made before somebody set a look on one.
	it('leaves the note\u2019s looks alone where the offer names none', async () => {
		show(saying([{ to: LARGER.ref, label: 'follows from' }]), saying(undefined));
		await settled();

		expect(screen()).not.toContain('Line to');
		expect(screen()).toContain('You have not changed anything yet.');
	});
});
