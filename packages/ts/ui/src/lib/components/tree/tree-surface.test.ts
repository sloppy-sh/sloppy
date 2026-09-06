// @vitest-environment jsdom
import type { Address, OwnedRef, Tag } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubResizeObserver } from '../dom.test-support.js';
import TreeSurface, { type TreeGroup } from './tree-surface.svelte';
import { LIT_PAGE, RUN_PAGE, type TreeNote } from './walk.js';

const DID = 'did:syr:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK';

const held = (address: string): OwnedRef => `${DID}/${address}` as OwnedRef;

function letters(ordinal: number): string {
	let out = '';
	let left = ordinal;
	while (left > 0) {
		out = String.fromCharCode(97 + ((left - 1) % 26)) + out;
		left = Math.floor((left - 1) / 26);
	}
	return out;
}

function note(address: string, parent?: string, over: Partial<TreeNote> = {}): TreeNote {
	return {
		ref: held(address),
		address: address as Address,
		parent: parent === undefined ? undefined : held(parent),
		title: `About ${address}`,
		tags: [],
		...over
	};
}

const BRANCH = [note('1'), note('1a', '1'), note('1a1', '1a'), note('1b', '1'), note('2')];

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let openedNotes: OwnedRef[];
let toggled: [OwnedRef, boolean][];
let written: OwnedRef[];
let scrolledTo: HTMLElement[];

function render(
	props: {
		groups?: TreeGroup[];
		lead?: { group: string; title: string; notes: TreeNote[] }[];
		opened?: Set<OwnedRef>;
		selection?: Tag[];
		reading?: OwnedRef | null;
		/** Absent stands for a walk through notes that are not the reader's. */
		writable?: boolean;
	} = {}
) {
	mounted = mount(TreeSurface, {
		target,
		props: {
			groups: props.groups ?? [{ key: 'one', title: 'Field notes', notes: BRANCH }],
			lead: props.lead,
			opened: props.opened ?? new Set<OwnedRef>(),
			selection: props.selection,
			reading: props.reading ?? null,
			onOpen: (ref: OwnedRef) => openedNotes.push(ref),
			onToggle: (ref: OwnedRef, open: boolean) => toggled.push([ref, open]),
			writeUnder: props.writable
				? {
						keys: 'Meta+Shift+Enter Control+Shift+Enter',
						typed: (event: KeyboardEvent) =>
							event.key === 'Enter' &&
							event.shiftKey &&
							!event.altKey &&
							(event.metaKey || event.ctrlKey),
						write: (ref: OwnedRef) => written.push(ref)
					}
				: undefined
		}
	});
	flushSync();
}

const rows = () => [...target.querySelectorAll<HTMLElement>('[role="treeitem"]')];

const labelled = (address: string) =>
	rows().find((row) => row.textContent?.includes(address)) as HTMLElement;

const press = (row: HTMLElement, key: string, held: KeyboardEventInit = {}) => {
	row.focus();
	row.dispatchEvent(
		new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...held })
	);
	flushSync();
};

beforeEach(() => {
	openedNotes = [];
	toggled = [];
	written = [];
	scrolledTo = [];
	stubResizeObserver();
	Object.defineProperty(Element.prototype, 'scrollIntoView', {
		configurable: true,
		writable: true,
		value: function (this: HTMLElement) {
			scrolledTo.push(this);
		}
	});
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
});

describe('walking the notes', () => {
	it('leads every row with the address, which is what a person cites', () => {
		render();
		expect(rows()).toHaveLength(2);
		expect(rows()[0].querySelector('.address')?.textContent?.trim()).toBe('1');
	});

	it('opens a note when its row is tapped', () => {
		render();
		rows()[0].click();
		expect(openedNotes).toEqual([held('1')]);
	});

	it('asks for a branch when its own control is tapped, and does not open the note', () => {
		render();
		(rows()[0].querySelector('button') as HTMLButtonElement).click();
		expect(toggled).toEqual([[held('1'), true]]);
		expect(openedNotes).toEqual([]);
	});

	it('offers no control on a note with nothing under it', () => {
		render({ opened: new Set([held('1'), held('1a')]) });
		expect(labelled('About 1a1').querySelector('button')).toBeNull();
	});

	it('draws the children of an opened branch, in address order', () => {
		render({ opened: new Set([held('1')]) });
		expect(rows().map((row) => row.querySelector('.address')?.textContent?.trim())).toEqual([
			'1',
			'1a',
			'1b',
			'2'
		]);
	});

	it('says how far down a row sits and how long its run is', () => {
		render({ opened: new Set([held('1')]) });
		const child = labelled('About 1a');
		expect(child.getAttribute('aria-level')).toBe('2');
		expect(child.getAttribute('aria-posinset')).toBe('1');
		expect(child.getAttribute('aria-setsize')).toBe('2');
	});

	it('marks the note being read', () => {
		render({ reading: held('2') });
		expect(labelled('About 2').getAttribute('aria-selected')).toBe('true');
		expect(labelled('About 1').getAttribute('aria-selected')).toBe('false');
	});

	it('goes to the note being read', () => {
		render({ reading: held('2') });
		expect(scrolledTo).toEqual([labelled('About 2')]);
	});

	it('waits for the branches above the note to unfold, then goes once', () => {
		const opened = new SvelteSet([held('1')]);
		render({ opened, reading: held('1a1') });
		expect(scrolledTo).toEqual([]);

		opened.add(held('1a'));
		flushSync();
		expect(scrolledTo).toEqual([labelled('About 1a1')]);

		// The row leaving and coming back is not a new place to go.
		opened.delete(held('1a'));
		opened.add(held('1a'));
		flushSync();
		expect(scrolledTo).toHaveLength(1);
	});
});

describe('a keyboard', () => {
	it('walks down the rows and back up', () => {
		render({ opened: new Set([held('1')]) });
		press(rows()[0], 'ArrowDown');
		expect(document.activeElement).toBe(rows()[1]);
		press(rows()[1], 'ArrowDown');
		expect(document.activeElement).toBe(rows()[2]);
		press(rows()[2], 'ArrowUp');
		expect(document.activeElement).toBe(rows()[1]);
	});

	it('opens a branch on the way right and folds it on the way left', () => {
		render();
		press(rows()[0], 'ArrowRight');
		expect(toggled).toEqual([[held('1'), true]]);
		unmount(mounted!, { outro: false });
		render({ opened: new Set([held('1')]) });
		press(rows()[0], 'ArrowLeft');
		expect(toggled.at(-1)).toEqual([held('1'), false]);
	});

	it('steps out of a branch to the note it hangs off', () => {
		render({ opened: new Set([held('1')]) });
		press(labelled('About 1b'), 'ArrowLeft');
		expect(document.activeElement).toBe(labelled('About 1'));
	});

	it('opens the note it is on', () => {
		render();
		press(rows()[1], 'Enter');
		expect(openedNotes).toEqual([held('2')]);
	});

	it('goes to the ends of the tree', () => {
		render({ opened: new Set([held('1')]) });
		press(rows()[0], 'End');
		expect(document.activeElement).toBe(rows().at(-1));
		press(rows().at(-1)!, 'Home');
		expect(document.activeElement).toBe(rows()[0]);
	});

	it('leaves one tab stop, on the note being read', () => {
		render({ opened: new Set([held('1')]), reading: held('1b') });
		expect(rows().filter((row) => row.tabIndex === 0)).toEqual([labelled('About 1b')]);
	});
});

describe('the tags a note carries', () => {
	const dots = (row: HTMLElement) => [...row.querySelectorAll<HTMLElement>('[style*="--facet-"]')];

	it('says them in words, whether or not any is selected', () => {
		render({
			groups: [
				{ key: 'one', title: '', notes: [note('1', undefined, { tags: ['biology'] as Tag[] })] }
			]
		});
		expect(rows()[0].textContent).toContain('biology');
	});

	it('draws one hue on a note in several selected sets, the earliest-selected', () => {
		render({
			groups: [
				{
					key: 'one',
					title: '',
					notes: [note('1', undefined, { tags: ['seed', 'question'] as Tag[] })]
				}
			],
			selection: ['question', 'seed'] as Tag[]
		});
		expect(dots(rows()[0])).toHaveLength(1);
		expect(dots(rows()[0])[0].getAttribute('style')).toContain('--facet-1');
		expect(rows()[0].textContent).toContain('question, seed');
	});

	it('draws no hue on a note in none of them', () => {
		render({
			groups: [
				{ key: 'one', title: '', notes: [note('1', undefined, { tags: ['seed'] as Tag[] })] }
			],
			selection: ['question'] as Tag[]
		});
		expect(dots(rows()[0])).toHaveLength(0);
		expect(rows()[0].textContent).toContain('seed');
	});
});

describe('the tags a reader selected', () => {
	const tagged = [
		note('1', undefined, { tags: ['seed'] as Tag[] }),
		note('2', undefined, { tags: ['question'] as Tag[] })
	];

	it('dims the notes that carry none of them, and keeps them on the tree', () => {
		render({
			groups: [{ key: 'one', title: '', notes: tagged }],
			selection: ['seed'] as Tag[]
		});
		expect(rows()).toHaveLength(2);
		expect(labelled('About 1').className).not.toContain('opacity-45');
		expect(labelled('About 2').className).toContain('opacity-45');
	});

	it('dims nothing while no tag is selected', () => {
		render({ groups: [{ key: 'one', title: '', notes: tagged }] });
		expect(rows().every((row) => !row.className.includes('opacity-45'))).toBe(true);
	});

	it('reaches the notes that carry one inside a branch the reader left folded', () => {
		render({
			groups: [{ key: 'one', title: '', notes: BRANCH }],
			selection: ['question'] as Tag[]
		});
		expect(rows().map((row) => row.querySelector('.address')?.textContent?.trim())).toEqual([
			'1',
			'2'
		]);

		unmount(mounted!, { outro: false });
		render({
			groups: [
				{
					key: 'one',
					title: '',
					notes: [
						note('1'),
						note('1a', '1'),
						note('1a1', '1a', { tags: ['question'] as Tag[] }),
						note('1b', '1'),
						note('2')
					]
				}
			],
			selection: ['question'] as Tag[]
		});
		expect(rows().map((row) => row.querySelector('.address')?.textContent?.trim())).toEqual([
			'1',
			'1a',
			'1a1',
			'1b',
			'2'
		]);
		expect(labelled('About 1a').getAttribute('aria-expanded')).toBe('true');
	});

	it('folds a branch back up when the reader asks, tag or no tag', () => {
		render({
			groups: [
				{
					key: 'one',
					title: '',
					notes: [note('1'), note('1a', '1'), note('1a1', '1a', { tags: ['question'] as Tag[] })]
				}
			],
			selection: ['question'] as Tag[]
		});
		expect(rows()).toHaveLength(3);

		labelled('About 1a').querySelector<HTMLButtonElement>('[aria-label="Fold 1a"]')?.click();
		flushSync();
		expect(rows().map((row) => row.querySelector('.address')?.textContent?.trim())).toEqual([
			'1',
			'1a'
		]);
		expect(labelled('About 1a').getAttribute('aria-expanded')).toBe('false');
	});

	it('walks left out of a branch once the reader has folded it', () => {
		render({
			groups: [
				{
					key: 'one',
					title: '',
					notes: [note('1'), note('1a', '1'), note('1a1', '1a', { tags: ['question'] as Tag[] })]
				}
			],
			selection: ['question'] as Tag[]
		});
		press(labelled('About 1a'), 'ArrowLeft');
		expect(rows()).toHaveLength(2);

		press(labelled('About 1a'), 'ArrowLeft');
		expect(document.activeElement).toBe(labelled('About 1'));
	});
});

describe('several graphs on the canvas', () => {
	const groups: TreeGroup[] = [
		{ key: 'a', title: 'Thesis', notes: [note('1')] },
		{ key: 'b', title: 'Garden', notes: [note('1')] }
	];

	it('gives each its own tree, so a run never crosses between them', () => {
		render({ groups });
		expect(target.querySelectorAll('[role="tree"]')).toHaveLength(2);
		expect([...target.querySelectorAll('h2')].map((head) => head.textContent?.trim())).toEqual([
			'Thesis',
			'Garden'
		]);
	});

	it('names no graph where there is only one', () => {
		render();
		expect(target.querySelector('h2')).toBeNull();
	});

	it('draws nothing for a graph with nothing in it', () => {
		render({ groups: [...groups, { key: 'c', title: 'Empty', notes: [] }] });
		expect(target.textContent).not.toContain('Empty');
	});
});

// PRODUCT.md principle 4: somebody else's region reads as theirs at a glance,
// and the walk is the canvas's equal rather than the one surface where the line
// goes missing.
describe('notes somebody else wrote', () => {
	const label = () => target.querySelector('[role="tree"]')?.getAttribute('aria-label');
	const headings = () => [...target.querySelectorAll('h2')].map((one) => one.textContent?.trim());

	it('names the author over the only tree there is, and in its own name', () => {
		render({ groups: [{ key: 'held', title: '', notes: BRANCH, author: 'Ada Lovelace' }] });
		expect(headings()).toEqual(['Notes by Ada Lovelace']);
		expect(label()).toBe('Notes by Ada Lovelace');
	});

	it('names them beside the graph, where several trees stand together', () => {
		render({
			groups: [
				{ key: 'a', title: 'Thesis', notes: [note('1')] },
				{ key: 'b', title: 'Garden', notes: [note('1')], author: 'Ada Lovelace' }
			]
		});
		expect(headings()).toEqual(['Thesis', 'Garden by Ada Lovelace']);
		expect(
			[...target.querySelectorAll('[role="tree"]')].map((one) => one.getAttribute('aria-label'))
		).toEqual(['Thesis', 'Garden by Ada Lovelace']);
	});

	it('names them over the run at the head of their tree too', () => {
		render({
			groups: [{ key: 'held', title: '', notes: BRANCH, author: 'Ada Lovelace' }],
			lead: [{ group: 'held', title: 'Last written', notes: [note('2')] }]
		});
		expect(headings()).toEqual(['Last written by Ada Lovelace', 'Notes by Ada Lovelace']);
	});

	it('names nobody over notes the reader wrote', () => {
		render({ groups: [{ key: 'held', title: '', notes: BRANCH }] });
		expect(target.querySelector('h2')).toBeNull();
		expect(label()).toBe('Notes');
	});
});

describe('a run longer than a page', () => {
	const many = [
		note('1'),
		...Array.from({ length: RUN_PAGE + 30 }, (_, at) => note(`1${letters(at + 1)}`, '1'))
	];

	it('stops at the page and offers the rest', () => {
		render({ groups: [{ key: 'one', title: '', notes: many }], opened: new Set([held('1')]) });
		expect(rows()).toHaveLength(1 + RUN_PAGE + 1);
		expect(rows().at(-1)?.textContent).toContain('30 more under 1');
	});

	it('draws the rest once it has been asked for', () => {
		render({ groups: [{ key: 'one', title: '', notes: many }], opened: new Set([held('1')]) });
		rows().at(-1)?.click();
		flushSync();
		expect(rows()).toHaveLength(1 + RUN_PAGE + 30);
	});

	it('says how many of the waiting notes a selected tag lights up', () => {
		const asked = [
			note('1'),
			...Array.from({ length: RUN_PAGE + 30 }, (_, at) =>
				note(`1${letters(at + 1)}`, '1', { tags: at >= RUN_PAGE ? (['question'] as Tag[]) : [] })
			)
		];
		render({
			groups: [{ key: 'one', title: '', notes: asked }],
			opened: new Set([held('1')]),
			selection: ['question'] as Tag[]
		});
		expect(rows().at(-1)?.textContent).toContain('30 more under 1, 30 lit up');
	});

	it('says nothing about lighting up while no tag is selected', () => {
		render({ groups: [{ key: 'one', title: '', notes: many }], opened: new Set([held('1')]) });
		expect(rows().at(-1)?.textContent).not.toContain('lit up');
	});
});

// PRODUCT.md § Purpose: capture demands nothing, so yesterday's note is often
// untitled and untagged, and the only thing anybody remembers of it is when.
describe('the notes last written into', () => {
	const last = [{ group: 'one', title: 'Last written', notes: [note('2'), note('1a', '1')] }];

	it('heads the walk, in the order it was given rather than in address order', () => {
		render({ lead: last });
		const trees = [...target.querySelectorAll<HTMLElement>('[role="tree"]')];
		expect(trees).toHaveLength(2);
		expect(
			[...trees[0].querySelectorAll('.address')].map((one) => one.textContent?.trim())
		).toEqual(['2', '1a']);
		expect([...target.querySelectorAll('h2')].map((one) => one.textContent?.trim())).toEqual([
			'Last written'
		]);
	});

	it('opens the note whose row was tapped', () => {
		render({ lead: last });
		rows()[0].click();
		expect(openedNotes).toEqual([held('2')]);
	});

	it('counts nothing and branches nowhere', () => {
		render({ lead: [{ group: 'one', title: 'Last written', notes: [note('1')] }] });
		const first = rows()[0];
		expect(first.querySelector('[aria-label^="Unfold"]')).toBeNull();
		expect(first.getAttribute('aria-expanded')).toBeNull();
		expect(first.querySelector('.tabular-nums')).toBeNull();
	});

	it('draws nothing where nothing has been written into', () => {
		render({ lead: [{ group: 'one', title: 'Last written', notes: [] }] });
		expect(target.querySelector('h2')).toBeNull();
		expect(target.querySelectorAll('[role="tree"]')).toHaveLength(1);
	});

	it('draws nothing for a graph it was given no run for', () => {
		render({
			groups: [
				{ key: 'a', title: 'Thesis', notes: [note('1')] },
				{ key: 'b', title: 'Garden', notes: [note('2')] }
			],
			lead: [{ group: 'b', title: 'Last written in Garden', notes: [note('2')] }]
		});
		expect([...target.querySelectorAll('h2')].map((one) => one.textContent?.trim())).toEqual([
			'Thesis',
			'Last written in Garden',
			'Garden'
		]);
	});

	it('stands each run over the tree of the graph it was written in', () => {
		render({
			groups: [
				{ key: 'a', title: 'Thesis', notes: [note('1')] },
				{ key: 'b', title: 'Garden', notes: [note('2')] }
			],
			lead: [
				{ group: 'a', title: 'Last written in Thesis', notes: [note('1')] },
				{ group: 'b', title: 'Last written in Garden', notes: [note('2')] }
			]
		});
		expect([...target.querySelectorAll('h2')].map((one) => one.textContent?.trim())).toEqual([
			'Last written in Thesis',
			'Thesis',
			'Last written in Garden',
			'Garden'
		]);
		const trees = [...target.querySelectorAll<HTMLElement>('[role="tree"]')];
		expect(trees).toHaveLength(4);
		expect(trees.map((tree) => tree.querySelector('.address')?.textContent?.trim())).toEqual([
			'1',
			'1',
			'2',
			'2'
		]);
	});

	it('leaves the walk landing on the tree’s row rather than on its own', () => {
		render({
			lead: [{ group: 'one', title: 'Last written', notes: [note('2')] }],
			reading: held('2')
		});
		const trees = [...target.querySelectorAll<HTMLElement>('[role="tree"]')];
		expect(scrolledTo).toEqual([trees[1].querySelector(`[data-row="${held('2')}"]`)]);
	});
});

describe('a graph of a few thousand notes', () => {
	const notes = Array.from({ length: 40 }, (_, root) => `${root + 1}`).flatMap((root) => [
		note(root),
		...Array.from({ length: 80 }, (_, at) => note(`${root}${letters(at + 1)}`, root))
	]);

	it('draws the branches and nothing beneath them', () => {
		expect(notes.length).toBeGreaterThan(3_000);
		render({ groups: [{ key: 'one', title: '', notes }] });
		expect(rows()).toHaveLength(40);
	});

	it('draws a bounded walk when a tag most of them carry is selected', () => {
		const asked = notes.map((one, at) =>
			at % 3 === 0 ? { ...one, tags: ['question'] as Tag[] } : one
		);
		render({ groups: [{ key: 'one', title: '', notes: asked }], selection: ['question'] as Tag[] });
		expect(rows().length).toBeGreaterThan(40);
		expect(rows().length).toBeLessThanOrEqual(40 + LIT_PAGE + RUN_PAGE);
	});
});

// PRODUCT.md holds the walk a first-class equal of the canvas, so a thought that
// springs from a row is put down without leaving the walk.
describe('writing from a row', () => {
	const writeOn = (address: string) =>
		labelled(`About ${address}`).querySelector<HTMLButtonElement>(
			'[aria-label^="Write a note under"]'
		);

	it('asks for a note under the row, and does not open the row', () => {
		render({ writable: true });
		writeOn('1')?.click();
		flushSync();

		expect(written).toEqual([held('1')]);
		expect(openedNotes).toEqual([]);
	});

	it('asks for the same note from the keyboard, on the row the reader is on', () => {
		render({ writable: true });
		press(labelled('About 2'), 'Enter', { metaKey: true, shiftKey: true });

		expect(written).toEqual([held('2')]);
		expect(openedNotes).toEqual([]);
	});

	it('leaves a keystroke it does not answer for whoever is listening past it', () => {
		render({ writable: true });
		const row = labelled('About 2');
		const past: string[] = [];
		const onward = (event: KeyboardEvent) => past.push(event.key);
		document.body.addEventListener('keydown', onward);

		press(row, 'Enter', { metaKey: true });
		press(row, 'Enter', { metaKey: true, shiftKey: true, altKey: true });
		document.body.removeEventListener('keydown', onward);

		expect(written).toEqual([]);
		expect(openedNotes).toEqual([]);
		expect(past).toEqual(['Enter', 'Enter']);
	});

	it('walks on with a key held, which the row does not answer for', () => {
		render({ writable: true });
		press(rows()[0], 'ArrowDown', { metaKey: true });

		expect(document.activeElement).toBe(rows()[1]);
	});

	it('offers nothing to write with where the notes are not the reader’s', () => {
		render();
		expect(target.querySelector('[aria-label^="Write a note under"]')).toBeNull();

		press(labelled('About 1'), 'Enter', { metaKey: true, shiftKey: true });

		expect(written).toEqual([]);
		expect(openedNotes).toEqual([]);
	});
});
