// Naming a place in the project's code from inside the writing.

import type { CodeAnchor } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import CiteCode, { LISTED, matching, placeIn } from './cite-code.svelte';

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let cited: (CodeAnchor | undefined)[];

const PROJECT = [
	'src/parser.ts',
	'src/history.rs',
	'docs/parser-notes.md',
	'lib/src-map.ts',
	'README.md'
];

function open(files: readonly string[] = PROJECT): void {
	mounted = mount(CiteCode, {
		target,
		props: {
			open: true,
			files: async () => files,
			onCite: (anchor: CodeAnchor | undefined) => void cited.push(anchor)
		}
	});
	flushSync();
}

const screen = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

const rows = (): HTMLButtonElement[] =>
	[...document.querySelectorAll('li button')] as HTMLButtonElement[];

const named = (words: string): HTMLButtonElement =>
	[...document.querySelectorAll('button')].find(
		(one) => one.textContent?.trim() === words
	) as HTMLButtonElement;

function type(selector: string, words: string): void {
	const field = document.querySelector(selector) as HTMLInputElement;
	field.value = words;
	field.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

async function settled(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	flushSync();
}

beforeEach(() => {
	cited = [];
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

describe('what somebody typed for where in the file', () => {
	it('is the whole file where they said nothing', () => {
		expect(placeIn('a.ts', '')).toEqual({ path: 'a.ts' });
		expect(placeIn('a.ts', '   ')).toEqual({ path: 'a.ts' });
	});

	it('is a run of lines, however they spelled one', () => {
		const run = { kind: 'lines', from: 12, to: 20 };
		expect(placeIn('a.ts', '12-20')).toEqual({ path: 'a.ts', fragment: run });
		expect(placeIn('a.ts', 'L12-L20')).toEqual({ path: 'a.ts', fragment: run });
		expect(placeIn('a.ts', '12 - 20')).toEqual({ path: 'a.ts', fragment: run });
		expect(placeIn('a.ts', '12')).toEqual({
			path: 'a.ts',
			fragment: { kind: 'lines', from: 12, to: 12 }
		});
	});

	// Nothing is refused: a line that is not a run of lines is a name to find.
	it('is a name wherever it is not a run of lines', () => {
		expect(placeIn('a.ts', 'discover')).toEqual({
			path: 'a.ts',
			fragment: { kind: 'symbol', name: 'discover' }
		});
		expect(placeIn('a.ts', '20-12')).toEqual({
			path: 'a.ts',
			fragment: { kind: 'symbol', name: '20-12' }
		});
		expect(placeIn('a.ts', '0')).toEqual({
			path: 'a.ts',
			fragment: { kind: 'symbol', name: '0' }
		});
	});
});

describe('the files offered', () => {
	it('leads with the ones whose own name carries the words', () => {
		expect(matching(PROJECT, 'src')).toEqual(['lib/src-map.ts', 'src/history.rs', 'src/parser.ts']);
	});

	it('keeps the ones matching in the name in the order they read', () => {
		expect(matching(PROJECT, 'parser')).toEqual(['docs/parser-notes.md', 'src/parser.ts']);
	});

	it('is every file where nothing has been typed', () => {
		expect(matching(PROJECT, '')).toHaveLength(PROJECT.length);
	});

	it('pays no attention to case', () => {
		expect(matching(PROJECT, 'README')).toEqual(['README.md']);
		expect(matching(PROJECT, 'readme')).toEqual(['README.md']);
	});
});

describe('citing a place in the code', () => {
	it('names the whole file where nothing more is said', async () => {
		open();
		await settled();

		named('src/parser.ts').click();
		flushSync();
		named('Cite it').click();
		flushSync();

		expect(cited).toEqual([{ path: 'src/parser.ts' }]);
	});

	it('names the lines or the name typed beside the file', async () => {
		open();
		await settled();

		type('input[aria-label="Find a file"]', 'history');
		expect(rows().map((row) => row.textContent?.trim())).toEqual(['src/history.rs']);
		named('src/history.rs').click();
		flushSync();
		type('input[placeholder^="12-20"]', 'discover');
		named('Cite it').click();
		flushSync();

		expect(cited).toEqual([
			{ path: 'src/history.rs', fragment: { kind: 'symbol', name: 'discover' } }
		]);
	});

	it('names nowhere where the writer closed it without choosing', async () => {
		open();
		await settled();

		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		flushSync();

		expect(cited).toEqual([undefined]);
	});

	// The writing takes one answer: a sheet that closes after the place was
	// named must not name nowhere over the top of it.
	it('answers once, whatever the sheet does on its way out', async () => {
		open();
		await settled();

		named('README.md').click();
		flushSync();
		named('Cite it').click();
		flushSync();
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		flushSync();

		expect(cited).toEqual([{ path: 'README.md' }]);
	});

	it('goes back to the files rather than stranding the writer on one', async () => {
		open();
		await settled();

		named('README.md').click();
		flushSync();
		(
			document.querySelector('button[aria-label="Choose another file"]') as HTMLButtonElement
		).click();
		flushSync();

		expect(rows()).toHaveLength(PROJECT.length);
	});

	it('says so where the project holds no files at all', async () => {
		open([]);
		await settled();

		expect(screen()).toContain('There are no files beside this graph');
	});

	it('asks for more of the name rather than listing a whole project', async () => {
		open(Array.from({ length: LISTED + 10 }, (_, i) => `src/file-${i}.ts`));
		await settled();

		expect(rows()).toHaveLength(LISTED);
		expect(screen()).toContain('More match. Type more of the name');
	});
});
