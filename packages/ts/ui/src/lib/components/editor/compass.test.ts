// @vitest-environment jsdom
import {
	citedNotes,
	compassNode,
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

function open(references: NoteReferences, blocks = [block({ content: section() })]) {
	mounted = mount(BlockStack, {
		target,
		props: {
			media: noMedia(),
			emoji: noEmoji(),
			drafts: noDrafts(),
			references,
			node: NOTE,
			blocks,
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

/** The compass's slots exactly as the writing holds them, entries this build
 *  cannot read included. */
function kept(): Record<string, unknown> {
	let attrs: Record<string, unknown> = {};
	writingIn().state.doc.descendants((child) => {
		if (child.type.name !== 'compass') return true;
		attrs = child.attrs;
		return false;
	});
	return attrs;
}

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

const field = (): HTMLInputElement =>
	card().querySelector('.sloppy-compass-field') as HTMLInputElement;

/** One keystroke, into whatever holds the keyboard: a field the caret has left
 *  between one character and the next never sees the rest of the word. */
function press(letter: string): void {
	const held = document.activeElement;
	if (!(held instanceof HTMLInputElement)) return;
	held.value += letter;
	held.dispatchEvent(new Event('input', { bubbles: true }));
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

	it('keeps the keyboard in the field for every character of the word', () => {
		open(graph([note('1b', 'Seed banks'), note('1c', 'Photosynthesis')]));
		put();
		tap(act('north', 'Cite a note'));
		expect(document.activeElement).toBe(field());

		for (const letter of 'see') press(letter);

		expect(field().value).toBe('see');
		expect(menu().map(words)).toEqual(['Seed banks', 'Write “see” as a stub']);
	});

	// WebKit takes the caret out of the field on Escape before the field has
	// answered for it, and a picker left standing cites whatever the next tap
	// lands on.
	it('shuts on Escape with nothing cited, from wherever the keyboard is', () => {
		open(graph([note('1b', 'Seed banks')]));
		put();
		tap(act('north', 'Cite a note'));
		type('seed');
		expect(menu()).not.toHaveLength(0);
		field().blur();

		document.body.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
		);
		flushSync();

		expect(card().querySelector('.sloppy-compass-field')).toBeNull();
		expect(menu()).toHaveLength(0);
		expect(stored()?.north).toEqual([]);
		expect(words(slot('north').querySelector('.sloppy-compass-asks'))).toBe(
			COMPASS_WORDS.north.asks
		);
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

	// The card is the note in the middle and four slots around it — DESIGN.md
	// § "The compass card" — and it is the only drawing of the four.
	it('stands the note it is on in the middle of the card', () => {
		open(graph([]));
		put();

		expect(words(card().querySelector('.sloppy-compass-title'))).toBe(NOTE.title);
		expect(words(card().querySelector('.sloppy-compass-address'))).toBe(NOTE.address);
	});

	// A slot entry this build cannot read is still the author's: citing into one
	// slot is not a chance to normalise the other three.
	it('keeps what a slot holds that it cannot read when another slot is cited into', async () => {
		const seed = note('1b', 'Seed banks');
		open(graph([seed]));
		writingIn().commands.insertContent({
			type: 'compass',
			attrs: { north: [], south: [{ note: 'later', how: 'a key this build has never seen' }] }
		});
		flushSync();

		tap(act('north', 'Cite a note'));
		type('seed');
		tap(menu()[0]);
		await settled();

		expect(stored()?.north).toEqual([seed.ref]);
		expect(kept().south).toEqual([{ note: 'later', how: 'a key this build has never seen' }]);
	});

	// A note written outside the app — `sloppy init` writes one per part of a
	// project, pointing north at the project's own note — arrives with its
	// compass already in the writing.
	it('draws a compass the note was already carrying when it opened', async () => {
		const project = note('1', 'thing');
		const carried = block({
			content: section(compassNode({ north: [project.ref], south: [], east: [], west: [] }))
		});
		open(graph([project]), [carried]);
		await settled();

		expect(stored()).toEqual({ north: [project.ref], south: [], east: [], west: [] });
		expect(words(slot('north').querySelector('.sloppy-reference'))).toBe('thing');
		for (const direction of ['south', 'east', 'west'] as const) {
			expect(words(slot(direction).querySelector('.sloppy-compass-asks'))).toBe(
				COMPASS_WORDS[direction].asks
			);
		}
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
