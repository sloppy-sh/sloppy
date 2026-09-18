// The sheet a line's look is set in — DESIGN.md § Edges, "A look a person set":
// the words, the arrowhead and the break, written onto one note of the pair.

import 'fake-indexeddb/auto';
import type { NodeView, OwnedRef, UpdateNodeRequest } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initRuntime } from '../runtime.js';
import { nodes } from '../stores/nodes.svelte.js';
import { session } from '../stores/session.svelte.js';
import {
	DID,
	homeOf,
	node,
	useFakeApi,
	VIEWER,
	type FakeApi
} from '../stores/fake-api.test-support.js';
import EdgeSheet from './edge-sheet.svelte';

const HOME = homeOf(DID);
const ONE = node(1, '1', { title: 'Wheat rust' });
const TWO = node(2, '1a', {
	title: 'Spore counts',
	origin: ONE.ref,
	parent: ONE.ref,
	depth: 2
});

function pathOf(of: OwnedRef): string {
	const cut = of.lastIndexOf('/');
	return `/nodes/${encodeURIComponent(of.slice(0, cut))}/${encodeURIComponent(of.slice(cut + 1))}`;
}

function stubViewport(width: number): void {
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: (query: string) => ({
			matches: /max-width:\s*(\d+)px/.test(query)
				? width <= Number(/max-width:\s*(\d+)px/.exec(query)?.[1])
				: false,
			addEventListener: () => {},
			removeEventListener: () => {}
		})
	});
}

async function settle(): Promise<void> {
	for (let turn = 0; turn < 20; turn += 1) {
		await new Promise((wake) => setTimeout(wake));
		flushSync();
	}
}

const screen = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

const named = (words: string): HTMLButtonElement | undefined =>
	[...document.body.querySelectorAll('button')].find((one) => one.textContent?.trim() === words);

const field = (): HTMLInputElement =>
	document.body.querySelector('input[placeholder="Nothing written on it"]') as HTMLInputElement;

let api: FakeApi;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let written: UpdateNodeRequest[];
let closed: boolean;

/** The graph as the sheet finds it, with whatever looks its notes carry. */
async function graphOf(notes: NodeView[]): Promise<void> {
	api.on('GET /nodes', () => notes.filter((one) => one.ref === one.origin));
	for (const note of notes) {
		api.on(`PATCH ${pathOf(note.ref)}`, (_url, init) => {
			const request = JSON.parse(String(init?.body)) as UpdateNodeRequest;
			written.push(request);
			return { ...note, ...request };
		});
	}
	await nodes.load({ graph: HOME });
}

function show(from: NodeView, to: NodeView): void {
	mounted = mount(EdgeSheet, {
		target,
		props: {
			open: true,
			onOpenChange: (showing: boolean) => {
				if (!showing) closed = true;
			},
			from,
			to
		}
	});
	flushSync();
}

beforeEach(() => {
	nodes.clear();
	written = [];
	closed = false;
	api = useFakeApi();
	session.adopt(VIEWER, 'a-session');
	stubViewport(390);
	Element.prototype.hasPointerCapture = () => false;
	Element.prototype.setPointerCapture = () => {};
	Element.prototype.releasePointerCapture = () => {};
	Element.prototype.scrollIntoView = () => {};
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	nodes.clear();
	session.clear();
	initRuntime({ apiHost: () => '' });
	target.remove();
	document.body.innerHTML = '';
});

describe('a line nobody has set a look on', () => {
	beforeEach(async () => {
		await graphOf([ONE, TWO]);
	});

	it('names both notes, and offers the three channels', async () => {
		show(ONE, TWO);
		await settle();

		expect(screen()).toContain('Between 1 and 1a');
		expect(named('No arrow')).toBeDefined();
		expect(named('Points at 1a')).toBeDefined();
		expect(named('Points at 1')).toBeDefined();
		expect(named('Both ends')).toBeDefined();
		for (const said of ['As it is', 'Solid', 'Dashed', 'Dotted']) {
			expect(named(said), said).toBeDefined();
		}
		// Nothing to clear until there is a look on the line.
		expect(named('Clear the look')).toBeUndefined();
	});

	it('writes what was said onto the note the sheet was opened from', async () => {
		show(ONE, TWO);
		await settle();

		const words = field();
		words.value = 'grew out of';
		words.dispatchEvent(new Event('input', { bubbles: true }));
		named('Points at 1a')?.click();
		named('Dotted')?.click();
		flushSync();
		named('Save')?.click();
		await settle();

		expect(written).toEqual([
			{
				edges: [{ to: TWO.ref, label: 'grew out of', direction: 'to', stroke: 'dotted' }]
			}
		]);
		expect(closed).toBe(true);
	});

	// An absent channel is the default for that channel alone, so a look nobody
	// said anything on is never stored.
	it('says nothing about the channels nobody set', async () => {
		show(ONE, TWO);
		await settle();
		named('Dashed')?.click();
		flushSync();
		named('Save')?.click();
		await settle();

		expect(written).toEqual([{ edges: [{ to: TWO.ref, stroke: 'dashed' }] }]);
	});

	it('leaves the note alone where the words would not save', async () => {
		api.on(`PATCH ${pathOf(ONE.ref)}`, () => {
			throw new Error('nope');
		});
		show(ONE, TWO);
		await settle();
		named('Dashed')?.click();
		flushSync();
		named('Save')?.click();
		await settle();

		expect(closed).toBe(false);
		expect(screen()).toContain('Sloppy could not save that');
	});
});

describe('a line already drawn under a look', () => {
	const LOOKED = { ...ONE, edges: [{ to: TWO.ref, label: 'why', stroke: 'dashed' as const }] };
	const OTHER = node(3, '2', { title: 'Elsewhere' });

	beforeEach(async () => {
		await graphOf([
			{ ...LOOKED, edges: [...LOOKED.edges, { to: OTHER.ref, label: 'beside' }] },
			TWO,
			OTHER
		]);
	});

	it('opens on what the line carries now, from either end', async () => {
		show(TWO, nodes.get(ONE.ref) as NodeView);
		await settle();

		expect(field().value).toBe('why');
		expect(named('Dashed')?.getAttribute('aria-pressed')).toBe('true');
		expect(named('No arrow')?.getAttribute('aria-pressed')).toBe('true');
		expect(named('Clear the look')).toBeDefined();
	});

	// The whole list, never a delta — and the looks on this note's other lines
	// are not this line's to take off.
	it('takes the look off this line and leaves the others alone', async () => {
		show(TWO, nodes.get(ONE.ref) as NodeView);
		await settle();
		named('Clear the look')?.click();
		await settle();

		expect(written).toEqual([{ edges: [{ to: OTHER.ref, label: 'beside' }] }]);
		expect(closed).toBe(true);
	});
});
