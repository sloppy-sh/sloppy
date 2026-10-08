// @vitest-environment jsdom
import type { OwnedRef } from '@sloppy/types';
import { flushSync, mount, unmount, type ComponentProps } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import Palette, { type FoundNote } from './palette.svelte';
import PaletteInPage from './palette.test-support.svelte';

const ORIGINS = 'did:syr:z6MkAda/01ARZ3NDEKTSV4RRFFQ69G5FAV' as OwnedRef;
const CELLS = 'did:syr:z6MkAda/01ARZ3NDEKTSV4RRFFQ69G5FAW' as OwnedRef;

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let opened: OwnedRef[];
let typed: string[];

const found = (over: Partial<FoundNote> = {}): FoundNote => ({
	ref: ORIGINS,
	address: '1a3',
	title: 'Mushrooms',
	graph: null,
	snippet: '',
	held: false,
	...over
});

async function settle(): Promise<void> {
	for (let at = 0; at < 4; at++) {
		flushSync();
		await new Promise(requestAnimationFrame);
		await new Promise((done) => setTimeout(done, 0));
	}
	flushSync();
}

async function open(props: Partial<ComponentProps<typeof Palette>> = {}): Promise<void> {
	if (mounted) unmount(mounted, { outro: false });
	document.body.innerHTML = '';
	target = document.createElement('div');
	document.body.appendChild(target);
	opened = [];
	typed = [];
	mounted = mount(Palette, {
		target,
		props: {
			open: true,
			query: '',
			found: [],
			onquery: (words: string) => typed.push(words),
			onopen: (ref: OwnedRef) => opened.push(ref),
			...props
		}
	});
	await settle();
}

const field = (): HTMLInputElement => {
	const input = document.querySelector<HTMLInputElement>('input[aria-label^="Find a note"]');
	if (!input) throw new Error('No find field is on screen');
	return input;
};

const rows = (): HTMLButtonElement[] => [
	...document.querySelectorAll<HTMLButtonElement>('ul li button')
];

const screen = () => document.body.textContent ?? '';

beforeEach(() => {
	stubMediaQuery((query) => query.includes('min-width'));
	stubResizeObserver();
	Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	document.body.innerHTML = '';
});

describe('the find sheet', () => {
	it('takes the caret when it opens, and is named for a reader who cannot see it', async () => {
		await open();

		expect(document.activeElement).toBe(field());
		expect(field().getAttribute('aria-label')).toContain('Find a note');
	});

	// A word is typed faster than whatever is looking through the notes answers
	// for it, and every character of it belongs to the person who typed it.
	it('keeps every character typed the instant it opens', async () => {
		if (mounted) unmount(mounted, { outro: false });
		document.body.innerHTML = '';
		target = document.createElement('div');
		document.body.appendChild(target);
		const said: string[] = [];
		mounted = mount(PaletteInPage, {
			target,
			props: { onsaid: (words: string) => said.push(words), answersAfter: 2 }
		});
		flushSync();

		const press = (letter: string) => {
			field().value += letter;
			field().dispatchEvent(new Event('input', { bubbles: true }));
			flushSync();
		};
		for (const letter of '1a3') press(letter);
		// The caller answers here, carrying the word as it was at the first
		// keystroke; the rest of it is still the person's.
		await settle();
		expect(field().value).toBe('1a3');

		press('b');
		await settle();
		expect(field().value).toBe('1a3b');
		expect(said.at(-1)).toBe('1a3b');
	});

	it('passes on what is typed', async () => {
		await open();

		field().value = '1a';
		field().dispatchEvent(new Event('input', { bubbles: true }));

		expect(typed).toEqual(['1a']);
	});

	it('shows a note by its number and its title', async () => {
		await open({ query: '1a3', found: [found()] });

		expect(rows()).toHaveLength(1);
		expect(rows()[0].textContent).toContain('1a3');
		expect(rows()[0].textContent).toContain('Mushrooms');
	});

	it('names no graph where every note on offer is read in the same one', async () => {
		await open({ query: 'mush', found: [found()] });

		expect(rows()[0].textContent?.replace(/\s+/g, ' ').trim()).toBe('1a3 Mushrooms');
	});

	it('names the graph a number is read in when it is given one', async () => {
		await open({ query: 'mush', found: [found({ graph: 'The garden' })] });

		expect(rows()[0].textContent).toContain('The garden');
	});

	it("says in words that a note is somebody else's", async () => {
		await open({ query: 'mush', found: [found({ held: true })] });

		expect(rows()[0].textContent).toContain("Somebody else's");
	});

	it('says which old number a row was reached by', async () => {
		await open({ query: '1c', found: [found({ address: '2c', wasAt: '1c' })] });

		expect(rows()[0].textContent?.replace(/\s+/g, ' ')).toContain('Was at 1c');
		expect(rows()[0].textContent).toContain('2c');
	});

	it('says nothing about an old number where the one typed still leads there', async () => {
		await open({ query: '1a3', found: [found()] });

		expect(screen()).not.toContain('Was at');
	});

	it('shows the writing around what matched', async () => {
		await open({ query: 'bench', found: [found({ snippet: 'the mushrooms under the bench' })] });

		expect(rows()[0].textContent).toContain('the mushrooms under the bench');
	});

	it('opens the note whose row is tapped', async () => {
		await open({ query: 'mush', found: [found({ ref: CELLS })] });

		rows()[0].click();
		await settle();

		expect(opened).toEqual([CELLS]);
	});

	it('opens the note a whole address resolves to on Enter', async () => {
		await open({ query: '1a3', found: [found()], exact: ORIGINS });

		field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await settle();

		expect(opened).toEqual([ORIGINS]);
	});

	it('opens nothing on Enter where the words resolve to no one note', async () => {
		await open({ query: 'mush', found: [found(), found({ ref: CELLS, address: '2' })] });

		field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await settle();

		expect(opened).toEqual([]);
	});

	it('waits for the answer before saying nothing matched', async () => {
		await open({ query: 'mush', found: [], looking: true });

		expect(screen()).not.toContain('Nothing on the canvas matches that.');
	});

	it('says plainly when nothing matched, and names what was looked through', async () => {
		await open({ query: 'mush', found: [], settled: true });

		expect(screen()).toContain('Nothing on the canvas matches that.');
		expect(screen()).not.toContain('Show another graph');
	});

	it('offers the graph that is not up where the reader keeps one', async () => {
		await open({ query: 'mush', found: [], settled: true, elsewhere: true });

		expect(screen()).toContain(
			'Nothing on the canvas matches that. Show another graph to look in it too.'
		);
	});

	it('says what could not be read rather than claiming nothing matched', async () => {
		await open({ query: 'mush', found: [], unreadable: 'Not right now.' });

		expect(screen()).toContain('Not right now.');
		expect(screen()).not.toContain('Nothing on the canvas matches that.');
	});

	// DESIGN.md § Eggs: the row takes nothing away, and the answer to what was
	// typed is one of the things it cannot take.
	it('still says that nothing matched behind a row that does nothing', async () => {
		await open({ query: 'teapot', found: [], settled: true });

		expect(screen()).toContain('418 · short and stout');
		expect(screen()).toContain('Nothing on the canvas matches that.');
		expect(document.querySelectorAll('[role="option"]')).toHaveLength(0);
	});

	it('reads the arrows past a row that does nothing', async () => {
		await open({ query: 'teapot', found: [found({ title: 'A teapot' })], settled: true });

		field().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
		flushSync();

		expect(field().getAttribute('aria-activedescendant')).toBe('palette-row-1');
		field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(opened).toEqual([ORIGINS]);
	});

	it('says how many the list is showing, for a reader who cannot see it', async () => {
		await open({ query: 'mush', found: [found(), found({ ref: CELLS, address: '2' })] });

		const said = document.querySelector('[role="status"]');
		expect(said?.textContent).toBe('Showing 2 notes.');
	});
});

describe('doing something from the palette', () => {
	const ACTS = [
		{ id: 'branch', label: 'New branch', says: '⌘ Return', group: 'Write' },
		{ id: 'choose', label: 'Choose notes', group: 'Graph' }
	];
	let ran: string[];
	const rowsShown = () =>
		[...document.querySelectorAll<HTMLElement>('[role="option"]')].map((row) =>
			(row.textContent ?? '').replace(/\s+/g, ' ').trim()
		);

	async function openWithActs(props: Partial<ComponentProps<typeof Palette>> = {}): Promise<void> {
		ran = [];
		await open({ acts: ACTS, onrun: (id: string) => ran.push(id), ...props });
	}

	it('lists every act with its keystroke while nothing is typed, grouped', async () => {
		await openWithActs();
		expect(rowsShown()).toEqual(['New branch ⌘ Return', 'Choose notes']);
		expect(screen()).toContain('Write');
		expect(screen()).toContain('Graph');
		expect(field().getAttribute('role')).toBe('combobox');
	});

	it('runs the act the arrow keys reached on Enter, and a lone match without them', async () => {
		await openWithActs();
		field().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
		field().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
		flushSync();
		expect(field().getAttribute('aria-activedescendant')).toBe('palette-row-1');
		field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(ran).toEqual(['choose']);

		field().value = 'cho';
		field().dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(rowsShown()).toEqual(['Choose notes']);
		field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(ran).toEqual(['choose', 'choose']);
	});

	it('puts the acts the words begin before the notes, and a tap runs one', async () => {
		await openWithActs({ query: 'ne', found: [found({ title: 'New ideas', address: '2' })] });
		expect(rowsShown()[0]).toBe('New branch ⌘ Return');
		expect(rowsShown()[1]).toContain('New ideas');
		rows()[0].click();
		expect(ran).toEqual(['branch']);
		expect(opened).toEqual([]);
	});
});

describe('standing in a column rather than over the page', () => {
	const ACTS = [
		{ id: 'branch', label: 'New branch', says: '⌘ Return', group: 'Write' },
		{ id: 'export', label: 'Export this graph', group: 'Graph' }
	];

	it('opens no surface of its own, and says nothing until something is typed', async () => {
		await open({ inline: true, acts: ACTS, found: [found()] });

		expect(document.querySelector('[role="dialog"]')).toBeNull();
		expect(field()).not.toBeNull();
		expect(document.querySelectorAll('[role="option"]')).toHaveLength(0);
	});

	it('offers what the words reach once they are typed', async () => {
		const ran: string[] = [];
		await open({ inline: true, acts: ACTS, onrun: (id: string) => ran.push(id) });

		field().value = 'exp';
		field().dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();

		const rows = [...document.querySelectorAll('[role="option"]')].map((row) =>
			(row.textContent ?? '').replace(/\s+/g, ' ').trim()
		);
		expect(rows).toEqual(['Export this graph']);
		field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(ran).toEqual(['export']);
	});
});
