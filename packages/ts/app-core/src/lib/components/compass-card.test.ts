import 'fake-indexeddb/auto';
import type { Compass, NodeView, OwnedRef } from '@sloppy/types';
import { COMPASS_WORDS } from '@sloppy/ui';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodes } from '../stores/nodes.svelte.js';
import { node, ref, useFakeApi, type FakeApi } from '../stores/fake-api.test-support.js';
import CompassCard from './compass-card.svelte';

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let opened: OwnedRef[];
let api: FakeApi;

const HERE = node(1, '1a', { title: 'Guard cells' });
const LARGER = node(2, '1', { title: 'Stomata' });
const MADE = node(3, '1a1', { title: 'Turgor' });

/** The two path segments `@sloppy/client` binds a reference as. */
function path(of: OwnedRef): string {
	const cut = of.lastIndexOf('/');
	return `/nodes/${encodeURIComponent(of.slice(0, cut))}/${encodeURIComponent(of.slice(cut + 1))}`;
}

function serve(...held: NodeView[]): void {
	for (const one of held) api.on(`GET ${path(one.ref)}`, () => one);
}

function show(compass: Partial<Compass>): void {
	mounted = mount(CompassCard, {
		target,
		props: {
			note: HERE,
			compass: { north: [], south: [], east: [], west: [], ...compass },
			onOpen: (one: OwnedRef) => void opened.push(one)
		}
	});
	flushSync();
}

const screen = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

const slot = (word: string): HTMLElement =>
	document.querySelector(`section[aria-label="${word}"]`) as HTMLElement;

const words = (element: Element | null) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

async function settled(): Promise<void> {
	for (let turn = 0; turn < 8; turn += 1) {
		await new Promise((done) => setTimeout(done, 0));
		flushSync();
	}
}

beforeEach(() => {
	opened = [];
	api = useFakeApi();
	nodes.clear();
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
	document.body.innerHTML = '';
});

describe('the compass card on a note', () => {
	it('asks under every slot nobody has filled, and complains about none of them', () => {
		show({});

		for (const { word, asks } of Object.values(COMPASS_WORDS)) {
			expect(words(slot(word))).toContain(asks);
		}
		expect(screen()).not.toContain('incomplete');
	});

	it('stands the note in the middle of the four', () => {
		show({});
		expect(screen()).toContain('Guard cells');
		expect(screen()).toContain('1a');
	});

	it('names what a slot points at, and asks no question where it is filled', async () => {
		serve(LARGER);
		show({ north: [LARGER.ref] });
		await settled();

		expect(words(slot('Part of'))).toContain('Stomata');
		expect(words(slot('Part of'))).not.toContain(COMPASS_WORDS.north.asks);
		expect(words(slot('Made of'))).toContain(COMPASS_WORDS.south.asks);
	});

	it('opens the note a slot points at', async () => {
		serve(MADE);
		show({ south: [MADE.ref] });
		await settled();

		(slot('Made of').querySelector('button') as HTMLElement).click();
		flushSync();
		expect(opened).toEqual([MADE.ref]);
	});

	// A ref is not something to put in front of a person, so a note this reader
	// cannot reach is a note and nothing more.
	it('says nothing about a note it cannot reach', async () => {
		show({ east: [ref(9)] });
		await settled();

		expect(words(slot('Like'))).toContain('A note');
		expect(screen()).not.toContain('did:syr:');
	});
});
