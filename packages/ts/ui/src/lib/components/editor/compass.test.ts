// @vitest-environment jsdom
import {
	citedNotes,
	compassOf,
	type BlockDocument,
	type CreateBlockRequest,
	type NodeView
} from '@sloppy/types';
import type { Editor } from '@tiptap/core';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import BlockStack from './block-stack.svelte';
import { COMPASS_WORDS } from './compass-node.js';
import type { NoteReferences } from './contract.js';
import { docBlocks } from './document.js';
import {
	NOTE,
	block,
	noDrafts,
	noEmoji,
	noMedia,
	ref,
	section,
	stubCanvas
} from './editor.test-support.js';

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let wrote: { title: string; relation: string }[];
let opened: string[];

function note(address: string, title: string): NodeView {
	return { ...NOTE, ref: ref(), address, depth: address.length, title };
}

const carries = (one: NodeView, query: string) =>
	!query ||
	(one.address ?? '').startsWith(query.toLowerCase()) ||
	one.title.toLowerCase().includes(query.toLowerCase());

function graph(held: NodeView[], writing?: (title: string) => Promise<NodeView>): NoteReferences {
	return {
		find: (query) => held.filter((one) => carries(one, query)),
		elsewhere: () => [],
		read: async (target) => held.find((one) => one.ref === target) ?? null,
		write: async (title, relation) => {
			wrote.push({ title, relation });
			if (!writing) throw new Error('That note could not be added. Try again in a moment.');
			return writing(title);
		},
		open: (target) => void opened.push(target)
	};
}

function open(references: NoteReferences) {
	mounted = mount(BlockStack, {
		target,
		props: {
			media: noMedia(),
			emoji: noEmoji(),
			drafts: noDrafts(),
			references,
			node: NOTE,
			blocks: [block({ content: section() })],
			onCreate: async (request: CreateBlockRequest) =>
				block({ content: request.content as BlockDocument }),
			onUpdate: async () => block(),
			onRemove: async () => {},
			onReorder: async () => block()
		}
	});
	flushSync();
}

const writingIn = (): Editor =>
	(target.querySelector('.sloppy-prose') as unknown as { editor: Editor }).editor;

/** The compass in the writing, as it would be stored. */
function stored() {
	const sections = docBlocks(writingIn().state.doc);
	for (const one of sections) {
		const held = compassOf(one.content);
		if (held) return held;
	}
	return undefined;
}

const card = (): HTMLElement => document.querySelector('.sloppy-compass') as HTMLElement;

const slot = (direction: string): HTMLElement =>
	card().querySelector(`[data-direction="${direction}"]`) as HTMLElement;

const words = (element: Element | null) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

function put(): void {
	writingIn().commands.insertCompass();
	flushSync();
}

function act(direction: string, label: string): HTMLButtonElement {
	return [...slot(direction).querySelectorAll('button')].find(
		(one) => words(one) === label || one.getAttribute('aria-label') === label
	) as HTMLButtonElement;
}

function tap(element: HTMLElement): void {
	element.click();
	flushSync();
}

const menu = (): HTMLElement[] => [...card().querySelectorAll<HTMLElement>('[role="option"]')];

function type(words: string): void {
	const field = card().querySelector('.sloppy-compass-field') as HTMLInputElement;
	field.value = words;
	field.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

async function settled(): Promise<void> {
	await vi.advanceTimersByTimeAsync(0);
	flushSync();
}

beforeEach(() => {
	wrote = [];
	opened = [];
	stubResizeObserver();
	stubMediaQuery(() => false);
	stubCanvas();
	Element.prototype.getBoundingClientRect = () =>
		({ left: 0, top: 0, width: 320, height: 240, right: 320, bottom: 240 }) as DOMRect;
	const noRects = (() => []) as unknown as Element['getClientRects'];
	Element.prototype.getClientRects = noRects;
	Range.prototype.getClientRects = noRects as unknown as Range['getClientRects'];
	Range.prototype.getBoundingClientRect = Element.prototype.getBoundingClientRect;
	target = document.createElement('div');
	document.body.appendChild(target);
	vi.useFakeTimers();
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	vi.clearAllTimers();
	vi.useRealTimers();
	vi.restoreAllMocks();
	target.remove();
	document.body.innerHTML = '';
});

describe('a compass in the writing', () => {
	it('opens with four empty slots, each asking its own question', () => {
		open(graph([]));
		put();

		expect(stored()).toEqual({ north: [], south: [], east: [], west: [] });
		for (const [direction, { word, asks }] of Object.entries(COMPASS_WORDS)) {
			expect(words(slot(direction).querySelector('.sloppy-compass-word'))).toBe(word);
			expect(words(slot(direction).querySelector('.sloppy-compass-asks'))).toBe(asks);
		}
	});

	// A note points one way: only the first compass in it is read, so a second
	// would be a slot nobody sees.
	it('takes the writer to the one already here rather than putting in a second', () => {
		open(graph([]));
		put();
		put();

		expect(document.querySelectorAll('.sloppy-compass')).toHaveLength(1);
	});

	it('cites a note into the slot it was found from', async () => {
		const seed = note('1b', 'Seed banks');
		open(graph([seed, note('1c', 'Photosynthesis')]));
		put();
		tap(act('north', 'Cite a note'));
		type('seed');
		expect(menu().map(words)).toEqual(['Seed banks', 'Write “seed” as a stub']);

		tap(menu()[0]);
		await settled();

		expect(stored()?.north).toEqual([seed.ref]);
		expect(stored()?.south).toEqual([]);
	});

	// A slot is a citation and nothing else, which is why the canvas draws the
	// line it already draws for one.
	it('counts a cited slot among the notes the section cites', () => {
		const seed = note('1b', 'Seed banks');
		open(graph([seed]));
		put();
		tap(act('north', 'Cite a note'));
		type('seed');
		tap(menu()[0]);

		const sections = docBlocks(writingIn().state.doc);
		expect(sections.flatMap((one) => citedNotes(one.content))).toEqual([seed.ref]);
	});

	it('writes a stub that springs from nothing, and cites that', async () => {
		const made = note('', 'Modularity');
		open(graph([], async (title) => ({ ...made, title })));
		put();
		tap(act('north', 'Cite a note'));
		type('Modularity');
		tap(menu().at(-1) as HTMLElement);
		await settled();

		expect(wrote).toEqual([{ title: 'Modularity', relation: 'free' }]);
		expect(stored()?.north).toEqual([made.ref]);
	});

	it('says what stopped a stub being written, and keeps the slot as it was', async () => {
		open(graph([]));
		put();
		tap(act('north', 'Cite a note'));
		type('Modularity');
		tap(menu().at(-1) as HTMLElement);
		await settled();

		expect(words(card().querySelector('.sloppy-compass-said'))).toBe(
			'That note could not be added. Try again in a moment.'
		);
		expect(stored()?.north).toEqual([]);
	});

	it('shows a cited note by what it is called now, and opens it when tapped', async () => {
		const seed = note('1b', 'Seed banks');
		open(graph([seed]));
		put();
		tap(act('north', 'Cite a note'));
		type('seed');
		tap(menu()[0]);
		await settled();

		const link = slot('north').querySelector('.sloppy-reference') as HTMLElement;
		expect(words(link)).toBe('Seed banks');
		tap(link);
		expect(opened).toEqual([seed.ref]);
	});

	it('takes a note back out of the slot it was put in', async () => {
		const seed = note('1b', 'Seed banks');
		open(graph([seed]));
		put();
		tap(act('north', 'Cite a note'));
		type('seed');
		tap(menu()[0]);
		await settled();

		tap(act('north', 'Take Seed banks out of Part of'));
		expect(stored()?.north).toEqual([]);
		expect(words(slot('north').querySelector('.sloppy-compass-asks'))).toBe(
			COMPASS_WORDS.north.asks
		);
	});

	it('offers nothing a slot already points at', async () => {
		const seed = note('1b', 'Seed banks');
		open(graph([seed]));
		put();
		tap(act('north', 'Cite a note'));
		type('seed');
		tap(menu()[0]);
		await settled();

		tap(act('north', 'Cite a note'));
		type('seed');
		expect(menu().map(words)).toEqual(['Write “seed” as a stub']);
	});
});
