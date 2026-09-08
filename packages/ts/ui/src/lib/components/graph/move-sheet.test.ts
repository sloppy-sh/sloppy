// @vitest-environment jsdom
import type { OwnedRef } from '@sloppy/types';
import { flushSync, mount, unmount, type ComponentProps } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import MoveSheet, { type MoveTarget } from './move-sheet.svelte';

const METHOD = 'did:syr:z6MkAda/01ARZ3NDEKTSV4RRFFQ69G5FAV' as OwnedRef;
const CELLS = 'did:syr:z6MkAda/01ARZ3NDEKTSV4RRFFQ69G5FAW' as OwnedRef;

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let asked: { relation: 'under' | 'after'; note: OwnedRef }[];
let typed: string[];

const method: MoveTarget = {
	ref: METHOD,
	address: '2',
	title: 'Method',
	lands: { under: '2a', after: '3' }
};

const inside: MoveTarget = {
	ref: CELLS,
	address: '1a',
	title: 'Cells',
	lands: { refused: 'Inside the note you are moving.' }
};

async function settle(): Promise<void> {
	for (let at = 0; at < 4; at++) {
		flushSync();
		await new Promise(requestAnimationFrame);
		await new Promise((done) => setTimeout(done, 0));
	}
	flushSync();
}

async function open(props: Partial<ComponentProps<typeof MoveSheet>> = {}): Promise<void> {
	if (mounted) unmount(mounted, { outro: false });
	document.body.innerHTML = '';
	target = document.createElement('div');
	document.body.appendChild(target);
	asked = [];
	typed = [];
	mounted = mount(MoveSheet, {
		target,
		props: {
			open: true,
			query: '',
			found: [],
			onquery: (words: string) => typed.push(words),
			onmove: (to) => asked.push(to),
			...props
		}
	});
	await settle();
}

const rows = (): HTMLButtonElement[] => [
	...document.querySelectorAll<HTMLButtonElement>('ul li button')
];

function button(reads: string): HTMLButtonElement {
	const found = [...document.querySelectorAll('button')].find((b) =>
		b.textContent?.includes(reads)
	);
	if (!found) throw new Error(`No button on screen reads "${reads}"`);
	return found;
}

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

describe('the move sheet', () => {
	it('takes the caret when it opens, and says what a move carries with it', async () => {
		await open();

		const field = document.querySelector<HTMLInputElement>('input');
		expect(document.activeElement).toBe(field);
		expect(screen()).toContain('every address it has had keeps leading to it');
	});

	it('hands what was typed back to whoever is looking', async () => {
		await open();
		const field = document.querySelector<HTMLInputElement>('input');
		if (!field) throw new Error('The sheet has no field to type into');

		field.value = '2';
		field.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();

		expect(typed).toEqual(['2']);
	});

	// AI.md § "The Genealogy Is the Protocol": a note is never moved under itself
	// or a note beneath it, and somebody who reached for one is told why.
	it('will not take a note the moving one already carries, and says so', async () => {
		await open({ query: '1', found: [method, inside] });

		expect(rows()[1].disabled).toBe(true);
		expect(rows()[1].textContent).toContain('Inside the note you are moving.');

		rows()[1].click();
		await settle();

		expect(screen()).not.toContain('Put it under 1a');
	});

	it('shows the address the note takes before either placement is chosen', async () => {
		await open({ query: '2', found: [method] });

		rows()[0].click();
		await settle();

		expect(screen()).toContain('Put it under 2');
		expect(screen()).toContain('It becomes 2a, or the next one free.');
		expect(screen()).toContain('Put it beside 2');
		expect(screen()).toContain('It becomes 3, or the next one free.');
	});

	// AI.md § "The Genealogy Is the Protocol": a run under a note nobody numbered
	// numbers nothing, so the sheet offers the placement without promising one.
	it('promises no address where the note will carry none there', async () => {
		const loose: MoveTarget = { ref: CELLS, title: 'Cells', lands: {} };
		await open({ query: 'cells', found: [loose] });

		rows()[0].click();
		await settle();

		expect(screen()).toContain('Put it under Cells');
		expect(screen()).toContain('It carries no number there.');
		expect(screen()).not.toContain('or the next one free');
	});

	it('asks for the placement that was tapped', async () => {
		await open({ query: '2', found: [method] });
		rows()[0].click();
		await settle();

		button('Put it beside 2').click();
		await settle();

		expect(asked).toEqual([{ relation: 'after', note: METHOD }]);
	});

	it('leaves the placements alone while a move is with the server', async () => {
		await open({ query: '2', found: [method], busy: true });
		rows()[0].click();
		await settle();

		expect(button('Put it under 2').disabled).toBe(true);
	});

	it('goes back to the field to choose another note', async () => {
		await open({ query: '2', found: [method] });
		rows()[0].click();
		await settle();

		button('Choose another note').click();
		await settle();

		expect(screen()).not.toContain('Put it under 2');
		expect(rows()).toHaveLength(1);
	});

	// A number somebody wrote down before a move still reaches the note, so the
	// row it matched says which one it was reached by.
	it('names the address a target was reached by where the target has left it', async () => {
		await open({ query: '1c', found: [{ ...method, wasAt: '1c' }] });

		expect(rows()[0].textContent).toContain('Was at 1c');

		await open({ query: '2', found: [method] });

		expect(rows()[0].textContent).not.toContain('Was at');
	});

	it('says a refusal against the placements that earned it', async () => {
		await open({ query: '2', found: [method], refused: 'That note is gone.' });
		rows()[0].click();
		await settle();

		expect(document.querySelector('[role="alert"]')?.textContent).toContain('That note is gone.');
	});

	// Only once everything has been read may the sheet say there is no such note.
	it('waits for the whole graph before saying nothing matches', async () => {
		await open({ query: 'seeds', found: [] });
		expect(screen()).not.toContain('Nothing in this graph matches that.');

		await open({ query: 'seeds', found: [], settled: true });
		expect(screen()).toContain('Nothing in this graph matches that.');
	});
});
