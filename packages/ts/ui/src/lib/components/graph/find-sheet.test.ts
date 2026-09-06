// @vitest-environment jsdom
import type { OwnedRef } from '@sloppy/types';
import { flushSync, mount, unmount, type ComponentProps } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import FindSheet, { type FoundNote } from './find-sheet.svelte';

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

async function open(props: Partial<ComponentProps<typeof FindSheet>> = {}): Promise<void> {
	if (mounted) unmount(mounted, { outro: false });
	document.body.innerHTML = '';
	target = document.createElement('div');
	document.body.appendChild(target);
	opened = [];
	typed = [];
	mounted = mount(FindSheet, {
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

	it('says how many the list is showing, for a reader who cannot see it', async () => {
		await open({ query: 'mush', found: [found(), found({ ref: CELLS, address: '2' })] });

		const said = document.querySelector('[role="status"]');
		expect(said?.textContent).toBe('Showing 2 notes.');
	});
});
