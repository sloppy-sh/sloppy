// The code a note points at, read where it stands.

import type { CodeAnchor, OwnedRef } from '@sloppy/types';
import type { WhyHere } from '../code-provenance.js';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import CodePreview from './code-preview.svelte';
import {
	childrenOf,
	excerpt,
	fragmentSays,
	linesOf,
	whereNamed,
	PAGE_LINES,
	RUN_LINES
} from './code-preview.js';

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

const FILE = ['export function discover() {', '\treturn 1;', '}', '', 'const discover2 = 2;'].join(
	'\n'
);

function show(over: {
	anchor?: CodeAnchor | null;
	read?: (path: string) => Promise<string | undefined>;
	list?: (path: string) => Promise<string[]>;
	openWhereFilesOpen?: (path: string) => Promise<void>;
}): void {
	mounted = mount(CodePreview, {
		target,
		props: {
			open: true,
			anchor: over.anchor ?? { path: 'src/parser.ts' },
			read: over.read ?? (async () => FILE),
			...(over.list ? { list: over.list } : {}),
			...(over.openWhereFilesOpen ? { openWhereFilesOpen: over.openWhereFilesOpen } : {})
		}
	});
	flushSync();
}

/** Lets the sheet read, list and draw. */
async function settled(): Promise<void> {
	for (let i = 0; i < 4; i += 1) await Promise.resolve();
	flushSync();
}

const button = (text: string): HTMLButtonElement => {
	const found = [...document.body.querySelectorAll('button')].find(
		(one) => one.textContent?.trim() === text
	);
	if (!found) throw new Error(`Nothing on screen reads "${text}"`);
	return found;
};

const screen = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');
const code = () => document.body.querySelector('code')?.textContent ?? '';

beforeEach(() => {
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

describe('which lines an anchor stands for', () => {
	const lines = (count: number) =>
		Array.from({ length: count }, (_, i) => `line ${i + 1}`).join('\n');

	it('counts the lines an editor counts, whatever the file ends with', () => {
		expect(linesOf('a\nb\n')).toEqual(['a', 'b']);
		expect(linesOf('a\nb')).toEqual(['a', 'b']);
		expect(linesOf('a\r\nb\r\n')).toEqual(['a', 'b']);
		expect(linesOf('')).toEqual(['']);
	});

	it('is the whole file where the anchor names no part of it', () => {
		const held = excerpt(lines(3), { path: 'a.ts' });
		expect(held).toMatchObject({ from: 1, total: 3, more: false, missing: false });
		expect(held.lines).toEqual(['line 1', 'line 2', 'line 3']);
	});

	it('is the run of lines named, numbered from where it starts', () => {
		const held = excerpt(lines(50), {
			path: 'a.ts',
			fragment: { kind: 'lines', from: 12, to: 14 }
		});
		expect(held.from).toBe(12);
		expect(held.lines).toEqual(['line 12', 'line 13', 'line 14']);
	});

	// A run written against a file that has since been cut short still reads.
	it('stops at the end of the file where the run reaches past it', () => {
		const held = excerpt(lines(3), { path: 'a.ts', fragment: { kind: 'lines', from: 2, to: 99 } });
		expect(held.lines).toEqual(['line 2', 'line 3']);
		expect(held.more).toBe(false);
	});

	it('shows a page of a long file, and the rest when it is asked for', () => {
		const held = excerpt(lines(PAGE_LINES * 2 + 5), { path: 'a.ts' });
		expect(held.lines).toHaveLength(PAGE_LINES);
		expect(held.more).toBe(true);
		expect(excerpt(lines(PAGE_LINES * 2 + 5), { path: 'a.ts' }, 3).more).toBe(false);
	});

	it('opens a run above the name it was asked for', () => {
		const held = excerpt(lines(200), {
			path: 'a.ts',
			fragment: { kind: 'symbol', name: 'line 100' }
		});
		expect(held.from).toBe(98);
		expect(held.lines).toHaveLength(RUN_LINES);
		expect(held.missing).toBe(false);
	});

	it('shows the file from the top where nothing in it is called that', () => {
		const held = excerpt(lines(3), { path: 'a.ts', fragment: { kind: 'symbol', name: 'nowhere' } });
		expect(held).toMatchObject({ from: 1, missing: true });
		expect(held.lines).toHaveLength(3);
	});

	it('finds the name where it stands alone rather than inside another word', () => {
		expect(whereNamed(['const discovery = 1;', 'function discover() {}'], 'discover')).toBe(2);
	});

	// Two things of one name resolve to the first: nothing parses the file.
	it('answers with the first line the name is on', () => {
		expect(whereNamed(['a discover b', 'discover'], 'discover')).toBe(1);
	});

	it('falls back to wherever the name reads at all', () => {
		expect(whereNamed(['x.discovery_rate = 1'], 'discovery_rate')).toBe(1);
		expect(whereNamed(['const a = 1;'], 'b')).toBeUndefined();
	});

	it('says what of the file is named, for a reader', () => {
		expect(fragmentSays({ path: 'a.ts' })).toBeUndefined();
		expect(fragmentSays({ path: 'a.ts', fragment: { kind: 'lines', from: 3, to: 3 } })).toBe(
			'Line 3'
		);
		expect(fragmentSays({ path: 'a.ts', fragment: { kind: 'lines', from: 3, to: 9 } })).toBe(
			'Lines 3 to 9'
		);
		expect(fragmentSays({ path: 'a.ts', fragment: { kind: 'symbol', name: 'discover' } })).toBe(
			'discover'
		);
	});
});

describe('reading the code an anchor names', () => {
	it('shows the path and the lines it stands for', async () => {
		show({ anchor: { path: 'src/parser.ts', fragment: { kind: 'lines', from: 2, to: 3 } } });
		await Promise.resolve();
		flushSync();

		expect(screen()).toContain('src/parser.ts');
		expect(screen()).toContain('Lines 2 to 3');
		expect(code()).toContain('return 1;');
		expect(code()).not.toContain('export function discover');
	});

	it('numbers the lines from where the run starts', async () => {
		show({ anchor: { path: 'src/parser.ts', fragment: { kind: 'lines', from: 2, to: 2 } } });
		await Promise.resolve();
		flushSync();

		expect(code().trim().startsWith('2')).toBe(true);
	});

	it('says so where this checkout has not got the file', async () => {
		show({ read: async () => undefined });
		await Promise.resolve();
		flushSync();

		expect(screen()).toContain('There is nothing at this path in the project now');
	});

	it('says so where nothing in the file is called that, and shows the file', async () => {
		show({ anchor: { path: 'src/parser.ts', fragment: { kind: 'symbol', name: 'parse' } } });
		await Promise.resolve();
		flushSync();

		expect(screen()).toContain('Nothing in this file is called “parse” now');
		expect(code()).toContain('export function discover');
	});

	it('offers the file to whatever opens files here, by its path', async () => {
		const opened: string[] = [];
		show({ openWhereFilesOpen: async (path) => void opened.push(path) });
		await Promise.resolve();
		flushSync();

		const act = [...document.querySelectorAll('button')].find(
			(one) => one.textContent?.trim() === 'Open in your editor'
		) as HTMLButtonElement;
		act.click();
		await Promise.resolve();

		expect(opened).toEqual(['src/parser.ts']);
	});

	it('does not offer that where this platform opens none', async () => {
		show({});
		await Promise.resolve();
		flushSync();

		expect(screen()).not.toContain('Open in your editor');
	});
});

describe('colour on the lines', () => {
	it('colours a file it knows the language of', async () => {
		show({ anchor: { path: 'src/parser.ts' } });
		for (let i = 0; i < 200 && !document.body.querySelector('span.shiki'); i += 1) {
			await new Promise((done) => setTimeout(done, 25));
			flushSync();
		}
		const runs = [...document.body.querySelectorAll('span.shiki')];
		expect(runs.length).toBeGreaterThan(0);
		expect(runs.map((run) => run.textContent).join('')).toContain('export function discover');
		expect(runs[0]?.getAttribute('style')).toContain('--shiki-dark');
		expect(code()).toContain('return 1;');
	}, 15000);
});

describe('a folder a note points at', () => {
	const IN_SRC = ['src/parser.ts', 'src/lexer/tokens.ts', 'src/lexer/scan.ts'];
	const project = {
		read: async (path: string) => (path === 'src/parser.ts' ? FILE : undefined),
		list: async (path: string) => IN_SRC.filter((one) => one.startsWith(`${path}/`))
	};

	it('sorts what stands directly inside it, folders first', () => {
		expect(childrenOf('src', IN_SRC)).toEqual([
			{ name: 'lexer', path: 'src/lexer', folder: true },
			{ name: 'parser.ts', path: 'src/parser.ts', folder: false }
		]);
		expect(childrenOf('', ['a.ts'])).toEqual([{ name: 'a.ts', path: 'a.ts', folder: false }]);
		expect(childrenOf('elsewhere', IN_SRC)).toEqual([]);
	});

	it('leads to what is in it, and from there into a file and back', async () => {
		show({ anchor: { path: 'src' }, ...project });
		await settled();

		expect(screen()).toContain('3 files');
		expect(screen()).toContain('lexer/');
		expect(screen()).not.toContain('nothing at this path');

		button('parser.ts').click();
		await settled();
		expect(code()).toContain('export function discover');
		expect(screen()).toContain('src/parser.ts');

		button('src').click();
		await settled();
		expect(screen()).toContain('lexer/');

		button('lexer/').click();
		await settled();
		expect(screen()).toContain('tokens.ts');
		expect(screen()).toContain('2 files');
	});

	it('says so where neither a file nor a folder is there', async () => {
		show({ anchor: { path: 'gone' }, ...project });
		await settled();
		expect(screen()).toContain('nothing at this path');
	});
});

describe('why this code', () => {
	const NOTE_A = 'did:plc:ada/01JZ0000000000000000000001';
	const NOTE_B = 'did:plc:ada/01JZ0000000000000000000002';
	const SECTION = 'did:plc:ada/01JZ0000000000000000000009';
	const LONG = Array.from({ length: 30 }, (_, i) =>
		i === 19 ? 'export function discover() {' : `const line${i + 1} = ${i + 1};`
	).join('\n');

	function reaching(over: Partial<WhyHere> & Pick<WhyHere, 'anchor'>): WhyHere {
		return {
			ref: NOTE_A,
			title: 'The parser',
			address: '1a',
			block: SECTION,
			heading: 'What it reads',
			text: 'It reads the notes first.\nThen the code.',
			...over
		};
	}

	function showWhy(
		why: WhyHere[],
		over: { anchor?: CodeAnchor; onOpenNote?: (note: OwnedRef) => void } = {}
	): void {
		mounted = mount(CodePreview, {
			target,
			props: {
				open: true,
				anchor: over.anchor ?? { path: 'src/parser.ts' },
				read: async () => LONG,
				why: async () => why,
				...(over.onOpenNote ? { onOpenNote: over.onOpenNote } : {})
			}
		});
		flushSync();
	}

	const chips = (at?: number) =>
		[
			...document.body.querySelectorAll<HTMLButtonElement>(
				at === undefined
					? '[data-why-rail] [data-why-chip]'
					: `[data-why-at="${at}"] [data-why-chip]`
			)
		].map((one) => one.textContent?.replace(/\s+/g, ' ').trim());
	const marked = () =>
		[...document.body.querySelectorAll('[data-why-marked]')].map((line) =>
			Number(line.firstElementChild?.textContent)
		);

	it('stands a chip for each note at the first line of the run it reaches, and marks the run', async () => {
		showWhy([
			reaching({ anchor: { path: 'src/parser.ts', fragment: { kind: 'lines', from: 4, to: 6 } } }),
			reaching({
				ref: NOTE_B,
				title: 'Reading order',
				address: '2',
				anchor: { path: 'src/parser.ts', fragment: { kind: 'lines', from: 4, to: 5 } }
			})
		]);
		await settled();

		expect(screen()).toContain('Why this code');
		expect(chips(4)).toEqual(['1a The parser', '2 Reading order']);
		expect(marked()).toEqual([4, 5, 6]);
	});

	it('stands a note on a name at the line the name is on', async () => {
		showWhy([
			reaching({
				anchor: { path: 'src/parser.ts', fragment: { kind: 'symbol', name: 'discover' } }
			})
		]);
		await settled();

		expect(chips(20)).toEqual(['1a The parser']);
		expect(marked()[0]).toBe(20);
	});

	it('stands a note on the whole file at the head, marking no lines', async () => {
		showWhy([reaching({ anchor: { path: 'src/parser.ts' } })]);
		await settled();

		expect(chips()).toEqual(['1a The parser · The whole file']);
		expect(marked()).toEqual([]);
	});

	it('says at the head where a name the note gives is not in the file now', async () => {
		showWhy([
			reaching({ anchor: { path: 'src/parser.ts', fragment: { kind: 'symbol', name: 'parse' } } })
		]);
		await settled();

		expect(chips()).toEqual(['1a The parser · “parse” is not in this file now']);
	});

	it('opens the section that holds the place in the code’s own place, and goes back', async () => {
		const opened: OwnedRef[] = [];
		showWhy(
			[
				reaching({ anchor: { path: 'src/parser.ts', fragment: { kind: 'lines', from: 4, to: 6 } } })
			],
			{ onOpenNote: (note) => opened.push(note) }
		);
		await settled();

		document.body.querySelector<HTMLButtonElement>('[data-why-at="4"] [data-why-chip]')?.click();
		flushSync();

		expect(document.body.querySelector(`[data-why-section="${SECTION}"]`)).not.toBeNull();
		expect(screen()).toContain('What it reads');
		expect(screen()).toContain('It reads the notes first.');
		expect(code()).toBe('');

		button('Back to the code').click();
		flushSync();
		expect(code()).toContain('const line4 = 4;');

		document.body.querySelector<HTMLButtonElement>('[data-why-at="4"] [data-why-chip]')?.click();
		flushSync();
		button('Open the note').click();
		flushSync();
		expect(opened).toEqual([NOTE_A]);
	});

	it('says so in one quiet line where nothing in the notes points at the file', async () => {
		showWhy([]);
		await settled();

		expect(screen()).toContain('Nothing in the notes points here yet.');
		expect(document.body.querySelectorAll('[data-why-chip]')).toHaveLength(0);
	});

	it('draws no rail where nothing says which notes reach the code', async () => {
		show({});
		await settled();

		expect(screen()).not.toContain('Why this code');
	});
});
