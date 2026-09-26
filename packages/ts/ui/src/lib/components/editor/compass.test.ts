// @vitest-environment jsdom
import {
	citedNotes,
	compassNode,
	compassOf,
	compassSlotWords,
	COMPASS_DIRECTIONS,
	type BlockDocument,
	type CreateBlockRequest,
	type DocumentNode,
	type NodeView
} from '@sloppy/types';
import type { Editor } from '@tiptap/core';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import { Refusal } from '../../refusal.js';
import BlockStack from './block-stack.svelte';
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

/** Words a graph refused in, deliberately not the line a surface falls back to. */
const REFUSED = 'This notebook is closed to writing just now.';

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
			if (!writing) throw new Refusal(REFUSED);
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

/** The compass element itself, as a section hands it to a vault, the API and a
 *  peer — before anything reading one normalises it. */
function writtenDown(): DocumentNode | undefined {
	for (const one of docBlocks(writingIn().state.doc)) {
		const held = (one.content.content ?? []).find((element) => element.type === 'compass');
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
		for (const direction of COMPASS_DIRECTIONS) {
			const { word, asks } = compassSlotWords('idea', direction);
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
			compassSlotWords('idea', 'north').asks
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

		expect(words(card().querySelector('.sloppy-compass-said'))).toBe(REFUSED);
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
			compassSlotWords('idea', 'north').asks
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
				compassSlotWords('idea', direction).asks
			);
		}
	});

	function chooses(kind: string): void {
		const held = card().querySelector('.sloppy-compass-method') as HTMLSelectElement;
		held.value = kind;
		held.dispatchEvent(new Event('change', { bubbles: true }));
		flushSync();
	}

	const asked = (direction: string): string =>
		words(slot(direction).querySelector('.sloppy-compass-asks'));

	// A person choosing reads the questions, not two acronyms they can only
	// learn by picking one — DESIGN.md § "The compass card".
	it('offers each method by the questions it would read the note by', () => {
		open(graph([]));
		put();

		const options = [...card().querySelectorAll('.sloppy-compass-method option')].map((one) =>
			words(one)
		);

		expect(options).toEqual([
			'Idea compass — part of, made of, like, instead of',
			'QEC — the question, the conclusion, the evidence, counter-evidence',
			'AJI — the assumption, the implication, the justification, the objection'
		]);
	});

	it('reads the same slots as the method the person chose', () => {
		open(graph([]));
		put();
		tap(act('west', 'Cite a note'));
		chooses('qec');

		expect(card().querySelector('.sloppy-compass-field')).toBeNull();

		expect(words(slot('north').querySelector('.sloppy-compass-word'))).toBe('The question');
		expect(asked('north')).toBe('What is the question?');
		// The chain runs down the vertical and the lateral relation across the
		// horizontal, so the conclusion is south and the evidence east.
		expect(words(slot('south').querySelector('.sloppy-compass-word'))).toBe('The conclusion');
		expect(words(slot('east').querySelector('.sloppy-compass-word'))).toBe('The evidence');
		expect(words(slot('west').querySelector('.sloppy-compass-word'))).toBe('Counter-evidence');
		expect(slot('west').hidden).toBe(false);
	});

	// Nothing moves when the method does, so switching back is not a repair.
	it('leaves every citation where it was through a switch and back', async () => {
		const seed = note('1b', 'Seed banks');
		const moon = note('1c', 'Moonlight');
		open(graph([seed, moon]));
		put();
		tap(act('north', 'Cite a note'));
		type('seed');
		tap(menu()[0]);
		tap(act('west', 'Cite a note'));
		type('moon');
		tap(menu()[0]);
		await settled();

		const before = stored();
		chooses('aji');
		expect(stored()).toEqual({ ...before, kind: 'aji' });

		chooses('idea');
		expect(stored()).toEqual(before);
		expect(kept().kind).toBeNull();
	});

	// An absent kind is what the idea compass says on the wire, so a compass in
	// it must reach a vault, the API and a peer carrying none — the node's own
	// attribute is null there, and a null is not writing.
	it('writes down the method only where the note is read by another one', async () => {
		const seed = note('1b', 'Seed banks');
		open(graph([seed]));
		put();
		tap(act('north', 'Cite a note'));
		type('seed');
		tap(menu()[0]);
		await settled();

		const slots = { north: [{ note: seed.ref }], south: [], east: [], west: [] };
		expect(writtenDown()?.attrs).toEqual(slots);

		chooses('qec');
		expect(writtenDown()?.attrs).toEqual({ ...slots, kind: 'qec' });

		chooses('idea');
		expect(writtenDown()?.attrs).toEqual(slots);
	});

	// A method a later build added is somebody's writing, and this one keeps
	// what it cannot read.
	it('writes down a method it has never heard of as it stands', async () => {
		open(graph([]));
		writingIn().commands.insertContent({
			type: 'compass',
			attrs: { north: [], south: [], east: [], west: [], kind: 'swot' }
		});
		flushSync();
		await settled();

		expect(writtenDown()?.attrs?.kind).toBe('swot');
	});

	// A slot a method has no question for still holds citations the canvas
	// draws, so it is never quietly hidden.
	// Every method fills both poles of both axes, so a citation is never left in
	// a slot the method has no question for.
	it('asks the opposing pole under every method', async () => {
		const moon = note('1c', 'Moonlight');
		open(graph([moon]));
		put();
		tap(act('west', 'Cite a note'));
		type('moon');
		tap(menu()[0]);
		await settled();

		chooses('qec');

		expect(slot('west').hidden).toBe(false);
		expect(words(slot('west').querySelector('.sloppy-compass-word'))).toBe('Counter-evidence');
		expect(words(slot('west').querySelector('.sloppy-reference'))).toBe('Moonlight');
		expect(act('west', 'Cite a note').hidden).toBe(false);
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
