// @vitest-environment jsdom
import { flushSync, mount, unmount, type ComponentProps } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import NestingSheet, { type NestingAsk } from './nesting-sheet.svelte';

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let acts: string[];

async function settle(): Promise<void> {
	for (let at = 0; at < 4; at++) {
		flushSync();
		await new Promise(requestAnimationFrame);
		await new Promise((done) => setTimeout(done, 0));
	}
	flushSync();
}

async function open(
	ask: NestingAsk,
	props: Partial<ComponentProps<typeof NestingSheet>> = {}
): Promise<void> {
	if (mounted) unmount(mounted, { outro: false });
	document.body.innerHTML = '';
	target = document.createElement('div');
	document.body.appendChild(target);
	acts = [];
	mounted = mount(NestingSheet, {
		target,
		props: {
			open: true,
			ask,
			oncarry: () => acts.push('carry'),
			onkeep: () => acts.push('keep'),
			onelse: () => acts.push('else'),
			...props
		}
	});
	await settle();
}

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

// AI.md § "The Genealogy Is the Protocol": a number that says a note springs
// from somewhere it does not is a question, never a silent write.
describe('the sheet a number with another parent in it opens', () => {
	it('offers to carry the note where the number says, or to leave it where it is', async () => {
		await open({ kind: 'carry', address: '3a1', here: '2', under: '3a', takes: '3a1' });

		expect(screen()).toContain('3a1 springs from 3a.');
		expect(screen()).toContain('This note springs from 2.');
		button('Move it under 3a').click();
		button('Keep it under 2 as 3a1').click();
		button('Cancel').click();
		await settle();

		expect(acts).toEqual(['carry', 'keep', 'else']);
		expect(screen()).toContain('It becomes 3a1, and everything under it comes along.');
	});

	it('says where a number that only led to the note now leads, and what it takes there', async () => {
		await open({ kind: 'carry', address: '3a1', here: '2', under: '5b', wasAt: '3a' });

		expect(screen()).toContain('3a1 springs from 3a, which now leads to 5b.');
		expect(screen()).toContain('It takes the next number under 5b');
		expect(screen()).not.toContain('It becomes');
		button('Move it under 3a, now 5b').click();
		await settle();

		expect(acts).toEqual(['carry']);
	});

	it('offers a branch of its own to a note given a whole number', async () => {
		await open({ kind: 'branch', address: '5', here: '2' });

		expect(screen()).toContain("5 is a branch's own number.");
		button('Make it a branch of its own').click();
		await settle();

		expect(acts).toEqual(['carry']);
		expect(screen()).toContain('Keep it under 2 as 5');
	});

	it('says when nothing is at the number, and offers another', async () => {
		await open({ kind: 'nowhere', address: '3a1', here: '2', parent: '3a', looking: 'whole' });

		expect(screen()).toContain('There is no note at 3a yet');
		expect(screen()).not.toContain('Move it under');
		button('Pick another number').click();
		await settle();

		expect(acts).toEqual(['else']);
	});

	it('offers to write the note nothing is at, and to carry this one under it', async () => {
		let wrote = 0;
		await open(
			{
				kind: 'nowhere',
				address: '3a1',
				here: '2',
				parent: '3a',
				looking: 'whole',
				writes: ['3a']
			},
			{ onwrite: () => (wrote += 1) }
		);

		expect(screen()).toContain(
			'A new note at 3a, and this one becomes 3a1 under it, with everything under it.'
		);
		button('Write 3a and move it there').click();
		await settle();

		expect(wrote).toBe(1);
		expect(screen()).toContain('Keep it under 2 as 3a1');
	});

	it('names every note it would write where the number springs through several', async () => {
		await open(
			{
				kind: 'nowhere',
				address: '7b3c',
				here: '2',
				parent: '7b3',
				looking: 'whole',
				writes: ['7', '7b', '7b3']
			},
			{ onwrite: () => undefined }
		);

		expect(button('Write 7, 7b and 7b3, and move it there')).toBeTruthy();
		expect(screen()).toContain(
			'New notes at 7, 7b and 7b3, and this one becomes 7b3c under 7b3, with everything under it.'
		);
	});

	it('offers to write nothing where a number on the way already leads somewhere', async () => {
		await open(
			{ kind: 'nowhere', address: '3a1', here: '2', parent: '3a', looking: 'whole' },
			{ onwrite: () => undefined }
		);

		expect(screen()).not.toContain('and move it there');
	});

	it('offers to write nothing while a graph has not been read', async () => {
		await open(
			{
				kind: 'nowhere',
				address: '3a1',
				here: '2',
				parent: '3a',
				looking: 'reading',
				writes: ['3a']
			},
			{ onwrite: () => undefined }
		);

		expect(screen()).not.toContain('and move it there');
	});

	it('never says there is no such note while the graphs are still opening', async () => {
		await open({ kind: 'nowhere', address: '3a1', here: '2', parent: '3a', looking: 'reading' });

		expect(screen()).toContain('Still looking for a note at 3a');
		expect(screen()).not.toContain('There is no note at 3a yet');
		expect(screen()).toContain('Keep it under 2 as 3a1');
	});

	it('offers another look where a graph would not open, rather than an answer', async () => {
		let again = 0;
		await open(
			{ kind: 'nowhere', address: '3a1', here: '2', parent: '3a', looking: 'short' },
			{ onlookagain: () => (again += 1) }
		);

		expect(screen()).toContain('Sloppy could not find a note at 3a');
		expect(screen()).toContain('a note at 3a may be missing here');
		button('Look again').click();
		await settle();

		expect(again).toBe(1);
	});

	it('names the note as springing from nothing where it has no note above it', async () => {
		await open({ kind: 'carry', address: '3a1', under: '3a' });

		expect(screen()).toContain('This note springs from nothing.');
		expect(screen()).toContain('Keep it as 3a1');
	});

	it('repeats the words a refusal came back with, and stops taking taps while it waits', async () => {
		await open(
			{ kind: 'carry', address: '3a1', here: '2', under: '3a', takes: '3a1' },
			{ refused: '3a1 already leads to “Osmosis”. Pick another number.', busy: true }
		);

		expect(screen()).toContain('3a1 already leads to “Osmosis”');
		expect(button('Move it under 3a').disabled).toBe(true);
	});
});
