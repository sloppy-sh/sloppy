// @vitest-environment jsdom
import type { Address, NoteDestination, OwnedRef, Tag } from '@sloppy/types';
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubResizeObserver } from '../dom.test-support.js';
import { reactive } from '../props.test-support.svelte.js';
import type { OutlineSections, TreeSection } from './sections.js';
import TreeSurface, { type TreeGroup, type TreeSurfaceProps } from './tree-surface.svelte';
import { LIT_PAGE, RUN_PAGE, type TreeNote } from './walk.js';

const DID = 'did:syr:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK';

const held = (address: string): OwnedRef => `${DID}/${address}` as OwnedRef;

/** Every fixture note is written in the same moment; what orders these runs
 *  is their addresses. */
const WRITTEN = '2026-01-01T00:00:00.000Z';

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
		created_at: WRITTEN,
		parent: parent === undefined ? undefined : held(parent),
		title: `About ${address}`,
		tags: [],
		published: false,
		...over
	};
}

const BRANCH = [note('1'), note('1a', '1'), note('1a1', '1a'), note('1b', '1'), note('2')];

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let openedNotes: OwnedRef[];
let toggled: [OwnedRef, boolean][];
let written: OwnedRef[];
let besides: OwnedRef[];
let moves: [OwnedRef, NoteDestination][];
let alone: boolean[];
let chose: OwnedRef[];
let choosing: boolean[];
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
		/** False stands for a surface that was given no way to write beside a row,
		 *  which is the one the control cannot be dragged on. */
		draggable?: boolean;
		/** Absent stands for a walk nobody is choosing on. */
		chosen?: Set<OwnedRef>;
		/** Absent stands for a walk that cannot be chosen on at all. */
		choosable?: boolean;
		/** Absent stands for a walk with no sections in it, which is what a region
		 *  pulled from somebody else is. */
		sections?: TreeSurfaceProps['sections'];
		/** What an open note draws under its row; absent stands for a walk given
		 *  no surface to draw one with. */
		interior?: TreeSurfaceProps['interior'];
		/** Absent stands for a walk where no note is the reader's to carry. */
		movable?: boolean;
		/** Absent stands for a walk with no way to start a note of its own. */
		writeAlone?: boolean;
		/** What the app says about a note that did not go. */
		moveRefused?: string;
	} = {}
) {
	const bound: TreeSurfaceProps = reactive({
		groups: props.groups ?? [{ key: 'one', title: 'Field notes', notes: BRANCH }],
		lead: props.lead,
		opened: props.opened ?? new Set<OwnedRef>(),
		selection: props.selection,
		reading: props.reading ?? null,
		chosen: props.chosen,
		onChoose: props.choosable || props.chosen ? (ref: OwnedRef) => chose.push(ref) : undefined,
		onChoosing: props.choosable || props.chosen ? (on: boolean) => choosing.push(on) : undefined,
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
					write: (ref: OwnedRef) => written.push(ref),
					beside: props.draggable === false ? undefined : (ref: OwnedRef) => besides.push(ref)
				}
			: undefined,
		writeAlone: props.writeAlone ? () => alone.push(true) : undefined,
		sections: props.sections,
		interior: props.interior,
		moveNote: props.movable
			? {
					move: (ref: OwnedRef, to: NoteDestination) => moves.push([ref, to]),
					refused: props.moveRefused
				}
			: undefined
	});
	mounted = mount(TreeSurface, { target, props: bound });
	flushSync();
	return bound;
}

const rows = () => [...target.querySelectorAll<HTMLElement>('[role="treeitem"]')];

/** One tree's rows and the interiors opened between them, in the order they are
 *  drawn; a tree owns its rows by id, so its own element holds nothing. */
const rowsAndInteriors = (tree: Element): HTMLElement[] =>
	([...tree.children] as HTMLElement[]).filter(
		(part) => part.getAttribute('role') === 'treeitem' || part.hasAttribute('data-interior')
	);

const labelled = (address: string) =>
	rows().find((row) => row.textContent?.includes(address)) as HTMLElement;

/** The outline laid out: rows 44 tall, each row's words set in by its depth. */
function lay(): void {
	for (const [at, row] of rows().entries()) {
		const level = Number(row.getAttribute('aria-level') ?? 1);
		Object.defineProperty(row, 'getBoundingClientRect', {
			configurable: true,
			value: () => ({ top: at * 44, bottom: at * 44 + 44, left: 0, right: 400 })
		});
		const words = row.querySelector('.grip');
		if (!words) continue;
		Object.defineProperty(words, 'getBoundingClientRect', {
			configurable: true,
			value: () => ({ top: at * 44, bottom: at * 44 + 44, left: 10 + (level - 1) * 20 })
		});
	}
}

const pull = (type: string, x: number, y: number, by = 'mouse'): PointerEvent => {
	const event = new Event(type, { bubbles: true, cancelable: true });
	Object.assign(event, { pointerId: 5, pointerType: by, button: 0, clientX: x, clientY: y });
	return event as PointerEvent;
};

/** What the surface says a drop will do, as anyone listening hears it. */
const said = () => target.querySelector('[role="status"]')?.textContent?.trim() ?? '';

const marked = () =>
	rows()
		.filter((row) => row.className.includes('border-dashed'))
		.map((row) => row.querySelector('.address')?.textContent?.trim());

/** The row's write control, which is the drag that adds a note. */
const gripOn = (address: string) =>
	labelled(`About ${address}`).querySelector<HTMLButtonElement>(
		'[aria-label^="Write a note under"]'
	) as HTMLButtonElement;

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
	besides = [];
	moves = [];
	alone = [];
	chose = [];
	choosing = [];
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
		const trees = [...target.querySelectorAll<HTMLElement>('[data-tree]')];
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
		const trees = [...target.querySelectorAll<HTMLElement>('[data-tree]')];
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
		const trees = [...target.querySelectorAll<HTMLElement>('[data-tree]')];
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

// AI.md § "The Genealogy Is the Protocol": a drag writes one more note at the
// end of a run, and no note already written moves.
describe('dragging a row’s write control to where the note goes', () => {
	const OPEN = { writable: true, opened: new Set([held('1')]) };

	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	// The row's own indent is what "level with it" is read against: 1a's words
	// start 20 in, so x=35 is level with 1a and x=60 is past it.
	it('writes under the row a mouse drags past, and does not open it', () => {
		render(OPEN);
		lay();

		gripOn('1').dispatchEvent(pull('pointerdown', 200, 10));
		window.dispatchEvent(pull('pointermove', 60, 60));
		flushSync();
		expect(said()).toBe('Write under 1a About 1a');
		expect(marked()).toEqual(['1a']);

		window.dispatchEvent(pull('pointerup', 60, 60));
		flushSync();

		expect(written).toEqual([held('1a')]);
		expect(besides).toEqual([]);
		expect(openedNotes).toEqual([]);
		expect(said()).toBe('');
	});

	// A note's open sections stand between its row and the next note's, and they
	// are part of the note they were written in.
	it('writes under the note whose sections are open, not the note after them', () => {
		const stack: TreeSection[] = [
			{ ref: held('1a/s1'), says: 'The first thing' },
			{ ref: held('1a/s2'), says: 'The last thing' }
		];
		render({
			...OPEN,
			sections: {
				shown: new SvelteSet([held('1a')]),
				of: (note) => (note === held('1a') ? stack : undefined),
				says: () => ({ says: '', again: false }),
				onShow: () => {},
				onMove: () => {}
			},
			interior: createRawSnippet<[TreeNote]>(() => ({
				render: () => '<div>What 1a says</div>'
			}))
		});
		lay();
		// The row of 1a is 44 tall from 44; the interior it opened stands under
		// it, 60 more, and the note after it starts below that.
		const opened = target.querySelector('[data-interior]') as HTMLElement;
		Object.defineProperty(opened, 'getBoundingClientRect', {
			configurable: true,
			value: () => ({ top: 88, bottom: 148, left: 0, right: 400 })
		});

		gripOn('1').dispatchEvent(pull('pointerdown', 200, 10));
		window.dispatchEvent(pull('pointermove', 60, 120));
		flushSync();
		expect(said()).toBe('Write under 1a About 1a');
		expect(marked()).toEqual(['1a']);

		window.dispatchEvent(pull('pointerup', 60, 120));
		flushSync();
		expect(written).toEqual([held('1a')]);
	});

	it('writes beside the row a mouse drags level with, and lights that run', () => {
		render(OPEN);
		lay();

		gripOn('1').dispatchEvent(pull('pointerdown', 200, 10));
		window.dispatchEvent(pull('pointermove', 35, 60));
		flushSync();
		expect(said()).toBe('Write beside 1a About 1a');
		expect(marked()).toEqual(['1a', '1b']);

		window.dispatchEvent(pull('pointerup', 35, 60));
		flushSync();

		expect(besides).toEqual([held('1a')]);
		expect(written).toEqual([]);
	});

	it('waits for a finger to be held before it carries anything', () => {
		render(OPEN);
		lay();

		gripOn('1').dispatchEvent(pull('pointerdown', 200, 10, 'touch'));
		window.dispatchEvent(pull('pointermove', 60, 60, 'touch'));
		flushSync();
		expect(said()).toBe('');

		window.dispatchEvent(pull('pointerup', 60, 60, 'touch'));
		flushSync();
		expect(written).toEqual([]);
		expect(besides).toEqual([]);
	});

	it('carries the note once a finger has been held on the control', async () => {
		render(OPEN);
		lay();

		gripOn('1').dispatchEvent(pull('pointerdown', 200, 10, 'touch'));
		await vi.advanceTimersByTimeAsync(400);
		window.dispatchEvent(pull('pointermove', 60, 60, 'touch'));
		flushSync();
		expect(said()).toBe('Write under 1a About 1a');

		window.dispatchEvent(pull('pointerup', 60, 60, 'touch'));
		flushSync();

		expect(written).toEqual([held('1a')]);
	});

	it('writes nothing when Escape calls the drag off', () => {
		render(OPEN);
		lay();

		gripOn('1').dispatchEvent(pull('pointerdown', 200, 10));
		window.dispatchEvent(pull('pointermove', 60, 60));
		flushSync();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		flushSync();
		expect(said()).toBe('');

		window.dispatchEvent(pull('pointerup', 60, 60));
		flushSync();

		expect(written).toEqual([]);
		expect(besides).toEqual([]);
	});

	it('writes nothing when the note is let go off the outline', () => {
		render(OPEN);
		lay();

		gripOn('1').dispatchEvent(pull('pointerdown', 200, 10));
		window.dispatchEvent(pull('pointermove', 60, -80));
		flushSync();
		expect(said()).toBe('Move over a note to write there');
		expect(marked()).toEqual([]);

		window.dispatchEvent(pull('pointerup', 60, -80));
		flushSync();

		expect(written).toEqual([]);
		expect(besides).toEqual([]);
	});

	// The click a drag ends with is the drag ending, not a tap on the row under it.
	it('neither writes twice nor opens the row a drag ends on', () => {
		render(OPEN);
		lay();

		gripOn('1').dispatchEvent(pull('pointerdown', 200, 10));
		window.dispatchEvent(pull('pointermove', 60, 20));
		window.dispatchEvent(pull('pointerup', 60, 20));
		labelled('About 1').click();
		flushSync();

		expect(written).toEqual([held('1')]);
		expect(openedNotes).toEqual([]);

		labelled('About 1').click();
		flushSync();
		expect(openedNotes).toEqual([held('1')]);
	});

	it('leaves the control a tap where there is no way to write beside a row', () => {
		render({ ...OPEN, draggable: false });
		lay();

		gripOn('1').dispatchEvent(pull('pointerdown', 200, 10));
		window.dispatchEvent(pull('pointermove', 35, 60));
		flushSync();
		expect(said()).toBe('');

		window.dispatchEvent(pull('pointerup', 35, 60));
		gripOn('1').click();
		flushSync();

		expect(written).toEqual([held('1')]);
		expect(besides).toEqual([]);
	});
});

// AI.md § "The Genealogy Is the Protocol": a note carried to another run takes
// the next address there, nobody else is renumbered, and the address it leaves
// keeps leading to it.
describe('carrying a note to another run', () => {
	const OPEN = { movable: true, writable: true, opened: new Set([held('1'), held('1a')]) };

	/** The row's grip, which is the address it is read by. */
	const addressOf = (address: string) =>
		labelled(`About ${address}`).querySelector('.address') as HTMLElement;

	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	// The rows lie 1, 1a, 1a1, 1b, 2 at 44 apiece, and a row's own indent is
	// what "level with it" is read against: 1a's words start 20 in, so x=35 is
	// level with 1a and x=60 is past it.
	it('takes the next address in the run a mouse drags it into', () => {
		render(OPEN);
		lay();

		addressOf('2').dispatchEvent(pull('pointerdown', 12, 190));
		window.dispatchEvent(pull('pointermove', 60, 60));
		flushSync();
		expect(said()).toBe('Goes under 1a About 1a, as 1a2 or later');
		expect(marked()).toEqual(['1a', '1a1']);

		window.dispatchEvent(pull('pointerup', 60, 60));
		flushSync();

		expect(moves).toEqual([[held('2'), { relation: 'under', note: held('1a') }]]);
		expect(openedNotes).toEqual([]);
	});

	it('continues the run of the row it is dragged level with', () => {
		render(OPEN);
		lay();

		addressOf('2').dispatchEvent(pull('pointerdown', 12, 190));
		window.dispatchEvent(pull('pointermove', 35, 60));
		flushSync();
		expect(said()).toBe('Goes beside 1a About 1a, as 1c or later');

		window.dispatchEvent(pull('pointerup', 35, 60));
		flushSync();

		expect(moves).toEqual([[held('2'), { relation: 'after', note: held('1a') }]]);
	});

	it('carries the note once a finger has been held on its address', async () => {
		render(OPEN);
		lay();

		addressOf('2').dispatchEvent(pull('pointerdown', 12, 190, 'touch'));
		window.dispatchEvent(pull('pointermove', 60, 60, 'touch'));
		flushSync();
		expect(said()).toBe('');

		addressOf('2').dispatchEvent(pull('pointerdown', 12, 190, 'touch'));
		await vi.advanceTimersByTimeAsync(400);
		window.dispatchEvent(pull('pointermove', 60, 60, 'touch'));
		flushSync();
		expect(said()).toBe('Goes under 1a About 1a, as 1a2 or later');

		window.dispatchEvent(pull('pointerup', 60, 60, 'touch'));
		flushSync();
		expect(moves).toEqual([[held('2'), { relation: 'under', note: held('1a') }]]);
	});

	it('refuses a note carried into its own branch, in words', () => {
		render(OPEN);
		lay();

		addressOf('1').dispatchEvent(pull('pointerdown', 12, 10));
		window.dispatchEvent(pull('pointermove', 80, 100));
		flushSync();
		expect(said()).toBe('A note cannot go inside itself');
		expect(marked()).toEqual([]);

		window.dispatchEvent(pull('pointerup', 80, 100));
		flushSync();
		expect(moves).toEqual([]);
	});

	it('refuses a note carried into another graph, in words', () => {
		render({
			...OPEN,
			groups: [
				{ key: 'one', title: 'Thesis', notes: BRANCH },
				{ key: 'two', title: 'Garden', notes: [note('7')] }
			]
		});
		lay();

		addressOf('2').dispatchEvent(pull('pointerdown', 12, 190));
		window.dispatchEvent(pull('pointermove', 60, 230));
		flushSync();
		expect(said()).toBe('A note stays in the graph it was written in');

		window.dispatchEvent(pull('pointerup', 60, 230));
		flushSync();
		expect(moves).toEqual([]);
	});

	it('says a note dropped at the end of its own run stays where it is', () => {
		render(OPEN);
		lay();

		addressOf('1b').dispatchEvent(pull('pointerdown', 12, 145));
		window.dispatchEvent(pull('pointermove', 35, 60));
		flushSync();
		expect(said()).toBe('Stays where it is');

		window.dispatchEvent(pull('pointerup', 35, 60));
		flushSync();
		expect(moves).toEqual([]);
	});

	// A thumb resting on a row is a hold, and a hold that never travels has aimed
	// at the row it started on: an address is not rewritten by an accident.
	it('moves nothing where a finger is held on an address and lifted again', async () => {
		render(OPEN);
		lay();

		addressOf('1a').dispatchEvent(pull('pointerdown', 32, 60, 'touch'));
		await vi.advanceTimersByTimeAsync(400);
		flushSync();
		expect(said()).toBe('Stays where it is');

		window.dispatchEvent(pull('pointerup', 32, 60, 'touch'));
		flushSync();
		expect(moves).toEqual([]);
	});

	it('moves nothing when Escape calls the drag off', () => {
		render(OPEN);
		lay();

		addressOf('2').dispatchEvent(pull('pointerdown', 12, 190));
		window.dispatchEvent(pull('pointermove', 60, 60));
		flushSync();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		flushSync();
		expect(said()).toBe('');

		window.dispatchEvent(pull('pointerup', 60, 60));
		flushSync();
		expect(moves).toEqual([]);
	});

	it('leaves the address a tap on the row, which opens the note', () => {
		render(OPEN);
		lay();

		addressOf('2').dispatchEvent(pull('pointerdown', 12, 190));
		window.dispatchEvent(pull('pointerup', 12, 190));
		labelled('About 2').click();
		flushSync();

		expect(moves).toEqual([]);
		expect(openedNotes).toEqual([held('2')]);
	});

	// AI.md § "The Genealogy Is the Protocol": a note with no address is an
	// ordinary note, and what it is read by is its grip like any other row's.
	it('carries a note with no address by the title it is read by', () => {
		const loose = note('loose', undefined, { address: undefined, title: 'On its own' });
		render({ ...OPEN, groups: [{ key: 'one', title: 'Field notes', notes: [...BRANCH, loose] }] });
		lay();

		const grip = labelled('On its own').querySelector('.grip') as HTMLElement;
		grip.dispatchEvent(pull('pointerdown', 12, 230));
		window.dispatchEvent(pull('pointermove', 60, 60));
		flushSync();
		expect(said()).toBe('Goes under 1a About 1a');

		window.dispatchEvent(pull('pointerup', 60, 60));
		flushSync();
		expect(moves).toEqual([[held('loose'), { relation: 'under', note: held('1a') }]]);
	});

	it('leaves every note where it is on a walk that is not the reader’s', () => {
		render({ opened: new Set([held('1'), held('1a')]) });
		lay();

		addressOf('2').dispatchEvent(pull('pointerdown', 12, 190));
		window.dispatchEvent(pull('pointermove', 60, 60));
		flushSync();

		expect(said()).toBe('');
		expect(moves).toEqual([]);
	});

	// Both drags start on the same row and mean different things: the write
	// control still only ever adds a note.
	it('leaves the write control writing', () => {
		render(OPEN);
		lay();

		gripOn('1').dispatchEvent(pull('pointerdown', 200, 10));
		window.dispatchEvent(pull('pointermove', 60, 60));
		flushSync();
		expect(said()).toBe('Write under 1a About 1a');

		window.dispatchEvent(pull('pointerup', 60, 60));
		flushSync();
		expect(written).toEqual([held('1a')]);
		expect(moves).toEqual([]);
	});

	it('carries the focused row under the note above it, from the keyboard', () => {
		render(OPEN);

		press(labelled('About 2'), 'ArrowRight', { altKey: true, shiftKey: true });

		expect(moves).toEqual([[held('2'), { relation: 'under', note: held('1b') }]]);
		expect(toggled).toContainEqual([held('1b'), true]);
	});

	it('carries the focused row into that note’s run instead, from the keyboard', () => {
		render(OPEN);

		press(labelled('About 2'), 'ArrowUp', { altKey: true, shiftKey: true });

		expect(moves).toEqual([[held('2'), { relation: 'after', note: held('1b') }]]);
	});

	// Nothing previews the chord, so it never spends an address on a note that is
	// already in the run it would be carried to.
	it('leaves a row already under the note above it where it is', () => {
		render(OPEN);

		press(labelled('About 1a'), 'ArrowRight', { altKey: true, shiftKey: true });

		expect(moves).toEqual([]);
		expect(said()).toBe('Stays where it is');
	});

	it('says so where there is nothing above the focused row', () => {
		render(OPEN);

		press(labelled('About 1'), 'ArrowUp', { altKey: true, shiftKey: true });

		expect(moves).toEqual([]);
		expect(said()).toBe('There is no note above this one');
	});

	it('leaves the sections chord to the sections', () => {
		const stack: TreeSection[] = [{ ref: held('1a/s1'), says: 'The first thing' }];
		const shown = new SvelteSet<OwnedRef>();
		render({
			...OPEN,
			sections: {
				shown,
				of: (note) => (note === held('1a') ? stack : undefined),
				says: () => ({ says: '', again: false }),
				onShow: (note, show) => (show ? shown.add(note) : shown.delete(note)),
				onMove: () => {}
			}
		});

		press(labelled('About 1a'), 'ArrowRight', { altKey: true });

		expect([...shown]).toEqual([held('1a')]);
		expect(moves).toEqual([]);
	});

	it('says where the note landed once the walk has it there', () => {
		const bound = render(OPEN);
		lay();

		addressOf('2').dispatchEvent(pull('pointerdown', 12, 190));
		window.dispatchEvent(pull('pointermove', 60, 60));
		window.dispatchEvent(pull('pointerup', 60, 60));
		flushSync();
		expect(said()).toBe('');

		bound.groups = [
			{
				key: 'one',
				title: 'Field notes',
				notes: [
					note('1'),
					note('1a', '1'),
					note('1a1', '1a'),
					note('1b', '1'),
					{ ...note('1a2', '1a'), ref: held('2') }
				]
			}
		];
		flushSync();

		expect(said()).toBe('2 is now 1a2, and 2 still leads to it');
	});

	it('says why a note did not go, where the app has words for it', () => {
		render({ ...OPEN, moveRefused: 'That note is not here any more.' });

		expect(said()).toBe('That note is not here any more.');
		expect(target.querySelector('.text-destructive')?.textContent?.trim()).toBe(
			'That note is not here any more.'
		);
	});
});

// PRODUCT.md: what anyone with the address can read is never carried by a drawn
// mark alone, and the walk is where there is no drawing to read.
describe('what a row says about a note', () => {
	const OUT = [note('1', undefined, { published: true }), note('1a', '1'), note('2')];

	it('says a note is published, in the row’s own words', () => {
		render({ groups: [{ key: 'one', title: '', notes: OUT }] });
		expect(labelled('About 1').textContent).toContain('Published');
		expect(labelled('About 2').textContent).not.toContain('Published');
	});

	it('says what the number beside a branch counts', () => {
		render({ groups: [{ key: 'one', title: '', notes: OUT }] });
		expect(labelled('About 1').textContent).toContain('1 note under this');
		expect(labelled('About 2').textContent).not.toContain('under this');
	});

	it('counts several notes as several', () => {
		render();
		expect(labelled('About 1').textContent).toContain('3 notes under this');
	});
});

// AI.md § "The Genealogy Is the Protocol": a note written with no parent and no
// address is an ordinary note, and the walk is one place to start one.
describe('writing a note of its own from the walk', () => {
	const newNote = () =>
		[...target.querySelectorAll<HTMLButtonElement>('button')].find(
			(button) => button.textContent?.trim() === 'New note'
		);

	it('offers it over the run, and asks for it once', () => {
		render({ writeAlone: true });
		newNote()?.click();
		expect(alone).toEqual([true]);
	});

	// The band over a set being chosen acts on that set, and writing is not one
	// of the acts it offers.
	it('offers it on the ordinary walk and not while a set is being chosen', () => {
		render({ writeAlone: true, chosen: new Set([held('1')]) });
		expect(newNote()).toBeUndefined();
	});

	it('offers nothing on a walk that is not the reader’s to write in', () => {
		render();
		expect(newNote()).toBeUndefined();
	});
});

describe('choosing notes on the walk', () => {
	const choice = () =>
		[...target.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
			/Choose notes|Done choosing/.test(button.textContent ?? '')
		);

	it('offers the way in, and the way back out once somebody is choosing', () => {
		render({ choosable: true });
		expect(choice()?.textContent).toContain('Choose notes');
		choice()?.click();
		expect(choosing).toEqual([true]);

		unmount(mounted!, { outro: false });
		render({ chosen: new Set([held('1')]) });
		expect(choice()?.textContent).toContain('Done choosing');
		choice()?.click();
		expect(choosing).toEqual([true, false]);
	});

	it('says which rows are chosen, in words as well as a mark', () => {
		render({ chosen: new Set([held('1')]) });
		expect(labelled('About 1').getAttribute('aria-checked')).toBe('true');
		expect(labelled('About 1').textContent).toContain('Chosen');
		expect(labelled('About 2').getAttribute('aria-checked')).toBe('false');
		expect(labelled('About 2').textContent).not.toContain('Chosen');
	});

	it('keeps the note being read apart from the notes chosen', () => {
		render({ chosen: new Set([held('2')]), reading: held('1') });

		expect(labelled('About 1').getAttribute('aria-selected')).toBe('true');
		expect(labelled('About 1').getAttribute('aria-checked')).toBe('false');
		expect(labelled('About 2').getAttribute('aria-selected')).toBe('false');
		expect(labelled('About 2').getAttribute('aria-checked')).toBe('true');
	});

	it('says nothing about choosing on a walk nobody is choosing on', () => {
		render();
		expect(labelled('About 1').hasAttribute('aria-checked')).toBe(false);
		expect(labelled('About 1').hasAttribute('aria-keyshortcuts')).toBe(false);
	});

	it('adds and removes on a tap while somebody is choosing, rather than opening', () => {
		render({ chosen: new Set([held('1')]) });
		labelled('About 2').click();
		labelled('About 1').click();

		expect(chose).toEqual([held('2'), held('1')]);
		expect(openedNotes).toEqual([]);
	});

	it('opens a row again once the choosing is done', () => {
		render({ choosable: true });
		labelled('About 2').click();

		expect(chose).toEqual([]);
		expect(openedNotes).toEqual([held('2')]);
	});

	it('chooses the row the reader is on from the keyboard, choosing or not', () => {
		render({ choosable: true });
		press(labelled('About 2'), ' ', { ctrlKey: true });

		expect(chose).toEqual([held('2')]);
		expect(openedNotes).toEqual([]);
	});

	it('leaves the walk with nothing to choose with where nothing can be chosen', () => {
		render();
		expect(choice()).toBeUndefined();

		press(labelled('About 2'), ' ', { ctrlKey: true });
		expect(chose).toEqual([]);
	});
});

// AI.md § "A Block Is a Section": a section has a handle that reorders it, and
// reordering is the only act on one here.
describe('a note read and arranged under its row in the walk', () => {
	const S1 = held('1/s1');
	const S2 = held('1/s2');
	const S3 = held('1/s3');
	const T1 = held('2/t1');
	const T2 = held('2/t2');

	let stacks: Record<string, TreeSection[]>;
	let shows: [OwnedRef, boolean][];
	let moves: [OwnedRef, OwnedRef, OwnedRef | null][];
	let into: [OwnedRef, OwnedRef, OwnedRef | null][];
	let onto: [OwnedRef, OwnedRef][];
	let out: [OwnedRef, OwnedRef, string][];
	let word: string;
	let again: boolean;

	function sections(
		shown: OwnedRef[] = [held('1')],
		carries = true
	): OutlineSections & { shown: SvelteSet<OwnedRef> } {
		return {
			shown: new SvelteSet(shown),
			of: (note) => stacks[note],
			says: () => ({ says: word, again }),
			onShow: (note, show) => shows.push([note, show]),
			onMove: (note, section, after) => moves.push([note, section, after]),
			onCarry: carries
				? {
						into: (section, note, after) => into.push([section, note, after]),
						onto: (section, note) => onto.push([section, note]),
						out: (section, on, relation) => out.push([section, on, relation])
					}
				: undefined
		};
	}

	/** What the writing surface puts under a row, standing in for it: one element
	 *  per saved section, which is what the handles beside them line up with. */
	const interior = createRawSnippet<[TreeNote]>((note) => ({
		render: () =>
			`<div>${(stacks[note().ref] ?? [])
				.map((one) => `<p data-block-ref="${one.ref}">${one.says}</p>`)
				.join('')}</div>`
	}));

	const interiorOf = (note: OwnedRef) =>
		target.querySelector<HTMLElement>(`[data-interior="${note}"]`) as HTMLElement;

	const gripIn = (of: OwnedRef) =>
		target.querySelector<HTMLButtonElement>(`[data-handle="${of}"]`) as HTMLButtonElement;

	const beside = (of: OwnedRef, label: string) =>
		gripIn(of).parentElement?.querySelector<HTMLButtonElement>(`[aria-label^="${label}"]`) ?? null;

	function box(part: Element, top: number, bottom: number): void {
		Object.defineProperty(part, 'getBoundingClientRect', {
			configurable: true,
			value: () => ({ top, bottom, left: 0, right: 400 })
		});
	}

	/** Note rows 44 tall, and each open note's interior as tall as the sections
	 *  the writing surface drew in it, 40 apiece. */
	function lay(): void {
		let y = 0;
		for (const tree of target.querySelectorAll('[data-tree]')) {
			for (const part of rowsAndInteriors(tree)) {
				const drawn = [...part.querySelectorAll<HTMLElement>('[data-block-ref]')];
				const tall = part.hasAttribute('data-interior') ? Math.max(40, drawn.length * 40) : 44;
				box(part, y, y + tall);
				drawn.forEach((one, at) => box(one, y + at * 40, y + at * 40 + 40));
				y += tall;
			}
		}
	}

	const pull = (type: string, x: number, y: number): PointerEvent => {
		const event = new Event(type, { bubbles: true, cancelable: true });
		Object.assign(event, { pointerId: 7, pointerType: 'mouse', button: 0, clientX: x, clientY: y });
		return event as PointerEvent;
	};

	const said = () => target.querySelector('[role="status"]')?.textContent?.trim() ?? '';

	/** Drags the handle on `section` to `y`, and answers what the walk said there. */
	function drag(section: OwnedRef, to: { x?: number; y: number }, from = 60): string {
		gripIn(section).dispatchEvent(pull('pointerdown', 30, from));
		window.dispatchEvent(pull('pointermove', to.x ?? 0, to.y));
		flushSync();
		return said();
	}

	function letGo(to: { x?: number; y: number }): void {
		window.dispatchEvent(pull('pointerup', to.x ?? 0, to.y));
		flushSync();
	}

	beforeEach(() => {
		stacks = {
			[held('1')]: [
				{ ref: S1, says: 'The first thing' },
				{ ref: S2, says: 'A drawing' },
				{ ref: S3, says: 'The last thing' }
			],
			[held('2')]: [
				{ ref: T1, says: 'Something else' },
				{ ref: T2, says: 'And after it' }
			]
		};
		shows = [];
		moves = [];
		into = [];
		onto = [];
		out = [];
		word = '';
		again = false;
	});

	it('opens the note where it stands when its row is tapped', () => {
		render({ sections: sections([]), interior });
		labelled('About 1').click();
		flushSync();
		expect(shows).toEqual([[held('1'), true]]);
		expect(openedNotes).toEqual([]);
		expect(toggled).toEqual([]);
	});

	it('folds it back up on the next tap', () => {
		render({ sections: sections(), interior });
		labelled('About 1').click();
		flushSync();
		expect(shows).toEqual([[held('1'), false]]);
	});

	it('draws what is written in the note under its row, and folds it away again', () => {
		const surface = sections();
		render({ sections: surface, interior });
		expect(interiorOf(held('1')).textContent).toContain('The first thing');
		expect(interiorOf(held('2'))).toBeNull();

		surface.shown.delete(held('1'));
		flushSync();
		expect(interiorOf(held('1'))).toBeNull();
	});

	it('names the note its interior belongs to', () => {
		render({ sections: sections(), interior });
		expect(interiorOf(held('1')).getAttribute('aria-label')).toBe('What is written in 1');
		expect(interiorOf(held('1')).getAttribute('role')).toBe('group');
	});

	it('stands a handle on every section, counted in the note it is in', () => {
		render({ sections: sections(), interior });
		expect(gripIn(S2).getAttribute('aria-label')).toBe('Move section 2 of 3 in 1');
		expect(gripIn(S3).getAttribute('aria-label')).toBe('Move section 3 of 3 in 1');
	});

	it('reaches the note’s own page from the row’s own act', () => {
		render({ sections: sections(), interior });
		const act = labelled('About 1').querySelector<HTMLButtonElement>(
			'[aria-label^="Open the page of"]'
		) as HTMLButtonElement;
		expect(act.getAttribute('aria-label')).toBe('Open the page of 1');
		act.click();
		flushSync();
		expect(openedNotes).toEqual([held('1')]);
		expect(shows).toEqual([]);
	});

	it('leaves the walk the notes alone where it was given no sections', () => {
		render();
		expect(rows()).toHaveLength(2);
		expect(target.querySelector('[aria-label^="Open the page of"]')).toBeNull();
		expect(target.querySelector('[data-interior]')).toBeNull();
	});

	it('opens the note and folds it back from the keyboard, apart from the branch', () => {
		render({ sections: sections([]), opened: new Set([held('1')]), interior });
		const note = labelled('About 1');
		expect(note.getAttribute('aria-keyshortcuts')).toBe('Alt+ArrowRight Alt+ArrowLeft');

		press(note, 'ArrowRight', { altKey: true });
		press(note, 'ArrowLeft', { altKey: true });
		expect(shows).toEqual([
			[held('1'), true],
			[held('1'), false]
		]);
		expect(toggled).toEqual([]);
	});

	it('leaves the plain arrows folding the branch', () => {
		render({ sections: sections([]), interior });
		press(labelled('About 1'), 'ArrowRight');
		expect(toggled).toEqual([[held('1'), true]]);
		expect(shows).toEqual([]);
	});

	it('says what stands under a note that has nothing to draw, and answers no tap', () => {
		stacks[held('1')] = [];
		word = 'Nothing is written in this note yet';
		render({ sections: sections(), interior });
		const only = rows().find((row) => row.textContent?.trim() === word) as HTMLElement;
		expect(only).toBeTruthy();

		only.click();
		flushSync();
		expect(shows).toEqual([]);
		expect(only.className).not.toContain('cursor-pointer');
	});

	it('asks for the note again from the one word that offers it', () => {
		stacks[held('1')] = [];
		word = 'These sections could not be read. Tap to try again.';
		again = true;
		render({ sections: sections(), interior });
		const only = rows().find((row) => row.textContent?.trim() === word) as HTMLElement;
		expect(only.className).toContain('cursor-pointer');

		only.click();
		flushSync();
		expect(shows).toEqual([[held('1'), true]]);
	});

	it('keeps the row’s own fold what aria-expanded stands for', () => {
		render({ sections: sections(), interior });
		expect(labelled('About 1').getAttribute('aria-expanded')).toBe('false');
		expect(labelled('About 2').getAttribute('aria-expanded')).toBeNull();
	});

	it('says a note is open where it stands, and closed again', () => {
		const surface = sections([]);
		render({ sections: surface, interior });
		labelled('About 1').click();
		flushSync();
		expect(said()).toBe('1 is open here');

		surface.shown.add(held('1'));
		flushSync();
		labelled('About 1').click();
		flushSync();
		expect(said()).toBe('1 is closed');
	});

	it('points the row at what it opened, and leaves the writing outside the tree', () => {
		render({ sections: sections(), interior });
		const tree = target.querySelector('[role="tree"]') as HTMLElement;
		expect(tree.querySelector('[data-interior]')).toBeNull();
		expect(tree.querySelector('[role="treeitem"]')).toBeNull();
		expect(tree.getAttribute('aria-owns')?.split(' ')).toContain(labelled('About 1').id);
		expect(labelled('About 1').getAttribute('aria-controls')).toBe(interiorOf(held('1')).id);
		expect(labelled('About 2').getAttribute('aria-controls')).toBeNull();
	});

	it('stands each handle clear of the one above it, however short the section', () => {
		render({ sections: sections(), interior });
		expect([S1, S2, S3].map((one) => gripIn(one).parentElement?.style.top)).toEqual([
			'0px',
			'44px',
			'88px'
		]);
	});

	it('opens a note tapped at the head of the walk on its own row down the tree', () => {
		render({
			lead: [{ group: 'one', title: 'Last written', notes: [note('1a1', '1a')] }],
			sections: sections([]),
			interior
		});
		rows()[0].click();
		flushSync();
		expect(shows).toEqual([[held('1a1'), true]]);
		expect(openedNotes).toEqual([]);
		expect(toggled).toEqual([
			[held('1a'), true],
			[held('1'), true]
		]);
	});

	it('takes the walk down to that row once the tree draws it', () => {
		render({
			lead: [{ group: 'one', title: 'Last written', notes: [note('2')] }],
			sections: sections([]),
			interior
		});
		rows()[0].click();
		flushSync();
		const trees = [...target.querySelectorAll<HTMLElement>('[data-tree]')];
		expect(scrolledTo).toEqual([trees[1].querySelector(`[data-row="${held('2')}"]`)]);
	});

	it('leaves the sections chord to the tree, not to the run at its head', () => {
		render({
			lead: [{ group: 'one', title: 'Last written', notes: [note('1')] }],
			sections: sections([]),
			interior
		});
		const head = rows()[0];
		expect(head.getAttribute('aria-keyshortcuts')).toBeNull();

		press(head, 'ArrowRight', { altKey: true });
		expect(shows).toEqual([]);
	});

	it('moves a section with the arrow keys, within its own note', () => {
		render({ sections: sections(), interior });
		press(gripIn(S3), 'ArrowUp', { altKey: true });
		expect(moves).toEqual([[held('1'), S3, S1]]);

		press(gripIn(S1), 'ArrowDown', { altKey: true });
		expect(moves).toEqual([
			[held('1'), S3, S1],
			[held('1'), S1, S2]
		]);
	});

	it('moves nothing at either end of the stack', () => {
		render({ sections: sections(), interior });
		press(gripIn(S1), 'ArrowUp', { altKey: true });
		press(gripIn(S3), 'ArrowDown', { altKey: true });
		expect(moves).toEqual([]);
	});

	// Row 1 is 0–44 and its three sections 44–164; row 2 is 164–208, and where
	// note 2 is open too its two sections are 208–288.
	it('puts a dragged section where it is let go in its own note, and says so first', () => {
		render({ sections: sections([held('1'), held('2')]), interior });
		lay();

		expect(drag(S3, { y: 50 }, 150)).toBe('Put it first in 1');
		letGo({ y: 50 });
		expect(moves).toEqual([[held('1'), S3, null]]);
		expect(said()).toBe('');
	});

	it('names the section a drop would follow', () => {
		render({ sections: sections(), interior });
		lay();

		expect(drag(S1, { y: 140 }, 50)).toBe('Put it after A drawing');
		letGo({ y: 140 });
		expect(moves).toEqual([[held('1'), S1, S2]]);
	});

	it('carries a section into another open note, and counts where it lands', () => {
		render({ sections: sections([held('1'), held('2')]), interior });
		lay();

		expect(drag(S1, { y: 240 }, 50)).toBe('Into 2, after the first section');
		letGo({ y: 240 });
		expect(into).toEqual([[S1, held('2'), T1]]);
		expect(moves).toEqual([]);
	});

	it('carries a section to the top of another open note', () => {
		render({ sections: sections([held('1'), held('2')]), interior });
		lay();

		expect(drag(S1, { y: 215 }, 50)).toBe('Into 2, first');
		letGo({ y: 215 });
		expect(into).toEqual([[S1, held('2'), null]]);
	});

	it('carries a section onto a note that is not open, at the end of it', () => {
		render({ sections: sections(), interior });
		lay();

		expect(drag(S1, { y: 186 }, 50)).toBe('Onto 2, at the end');
		letGo({ y: 186 });
		expect(onto).toEqual([[S1, held('2')]]);
		expect(into).toEqual([]);
	});

	it('says a section let go back on its own note stays where it is, and moves nothing', () => {
		render({ sections: sections(), interior });
		lay();

		expect(drag(S1, { y: 22 }, 50)).toBe('Stays where it is');
		letGo({ y: 22 });
		expect(onto).toEqual([]);
		expect(into).toEqual([]);
	});

	it('carries a section out between two rows, where it becomes a note in that run', () => {
		render({ sections: sections(), interior });
		lay();

		expect(drag(S1, { y: 168 }, 50)).toBe('Becomes a note beside 2');
		letGo({ y: 168 });
		expect(out).toEqual([[S1, held('2'), 'after']]);
	});

	it('becomes a note under the row it is let go past the row’s own words', () => {
		render({ sections: sections(), interior });
		lay();

		expect(drag(S1, { x: 60, y: 204 }, 50)).toBe('Becomes a note under 2');
		letGo({ x: 60, y: 204 });
		expect(out).toEqual([[S1, held('2'), 'under']]);
	});

	it('leaves a section in its own note on a walk with no way to carry one', () => {
		render({ sections: sections([held('1')], false), interior });
		lay();

		drag(S1, { y: 186 }, 50);
		letGo({ y: 186 });
		expect(onto).toEqual([]);
		expect(out).toEqual([]);
	});

	it('neither moves nor opens the note when Escape calls the drag off', () => {
		render({ sections: sections(), interior });
		lay();

		drag(S1, { y: 140 }, 50);
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		letGo({ y: 140 });

		expect(moves).toEqual([]);
		expect(into).toEqual([]);
		expect(openedNotes).toEqual([]);
	});

	// A finger has no hover and no held key, so the handle answers a tap with
	// the same move a drag makes.
	it('offers a place up and a place down from the handle it is dragged by', () => {
		render({ sections: sections(), interior });
		gripIn(S2).click();
		flushSync();

		beside(S2, 'Move it up')?.click();
		beside(S2, 'Move it down')?.click();
		flushSync();
		expect(moves).toEqual([
			[held('1'), S2, null],
			[held('1'), S2, S3]
		]);
		expect(openedNotes).toEqual([]);
	});

	it('offers neither at the end of the stack it is already at', () => {
		render({ sections: sections(), interior });
		gripIn(S1).click();
		flushSync();
		expect(beside(S1, 'Move it up')?.disabled).toBe(true);
		expect(beside(S1, 'Move it down')?.disabled).toBe(false);
	});

	it('draws them on the one handle that was tapped, and folds them back', () => {
		render({ sections: sections(), interior });
		gripIn(S1).click();
		flushSync();
		expect(beside(S2, 'Move it up')).toBeNull();

		gripIn(S1).click();
		flushSync();
		expect(beside(S1, 'Move it up')).toBeNull();
	});

	it('lets go of the handle it was offering when the note is folded back up', () => {
		const surface = sections();
		render({ sections: surface, interior });
		gripIn(S2).click();
		flushSync();
		expect(beside(S2, 'Move it up')).not.toBeNull();

		surface.shown.delete(held('1'));
		flushSync();
		surface.shown.add(held('1'));
		flushSync();

		expect(beside(S2, 'Move it up')).toBeNull();
		expect(gripIn(S2).getAttribute('aria-expanded')).toBe('false');
	});

	it('leaves them out of a drag that ended on the handle', () => {
		render({ sections: sections(), interior });
		lay();

		drag(S3, { y: 50 }, 150);
		letGo({ y: 50 });
		gripIn(S3).dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		expect(beside(S3, 'Move it up')).toBeNull();
	});

	// The two drags a row offers stand on one surface and say their words in one
	// place, so a section moved leaves nothing behind for the note written next.
	it('keeps a section drag and a write drag to their own words and their own act', () => {
		render({ writable: true, sections: sections(), interior });
		lay();

		expect(drag(S1, { y: 140 }, 50)).toBe('Put it after A drawing');
		letGo({ y: 140 });
		expect(moves).toEqual([[held('1'), S1, S2]]);
		expect(said()).toBe('');
		expect(written).toEqual([]);

		const write = rows()[0].querySelector<HTMLButtonElement>(
			'[aria-label^="Write a note under"]'
		) as HTMLButtonElement;
		write.dispatchEvent(pull('pointerdown', 200, 10));
		window.dispatchEvent(pull('pointermove', 60, 100));
		flushSync();
		expect(said()).toBe('Write under 1 About 1');

		window.dispatchEvent(pull('pointerup', 60, 100));
		flushSync();
		expect(written).toEqual([held('1')]);
		expect(moves).toHaveLength(1);
		expect(openedNotes).toEqual([]);
	});
});

// PRODUCT.md principle 6: the outline is drawn at phone width first. jsdom lays
// nothing out, so a row's narrowest is added up from its parts rather than
// measured.
describe('a note row on the narrowest phone', () => {
	const PHONE = 360;
	const REM = 16;
	/** One character of a row's small text, allowed for at the widest face
	 *  `data-app-font` puts behind the address. */
	const CHAR = 9;

	/** A run as deep as the outline sets a row in, published and tagged all the
	 *  way down, with one more note under the last so its row carries a count. */
	const DEEP = (() => {
		const marks = { published: true, tags: ['field' as Tag] };
		const out = [note('1', undefined, marks)];
		let address = '1';
		for (let step = 1; step <= 8; step += 1) {
			const child = `${address}${step % 2 === 1 ? 'a' : '1'}`;
			out.push(note(child, address, marks));
			address = child;
		}
		out.push(note(`${address}a`, address));
		return out;
	})();

	const DEEPEST = '1a1a1a1a1';

	const classesOf = (part: Element): string[] => (part.getAttribute('class') ?? '').split(/\s+/);

	/** A spacing class in px, off the part's own classes, or 0 where it has none. */
	function spaceOf(classes: string[], name: string): number {
		const set = classes.find((one) => new RegExp(`^${name}-\\d+(\\.5)?$`).test(one));
		return set ? Number(set.slice(name.length + 1)) * 4 : 0;
	}

	const gapOf = (classes: string[]): number => spaceOf(classes, 'gap');

	/** What a part carries with nothing to spare: words that truncate carry
	 *  nothing, and anything else carries its own parts or its own text. */
	function carriedBy(part: Element, classes: string[]): number {
		if (classes.includes('truncate')) return 0;
		const parts = [...part.children];
		if (parts.length > 0) return acrossOf(parts, gapOf(classes));
		return (part.textContent ?? '').trim().length * CHAR;
	}

	/** The narrowest a part can be drawn, or null where it is not drawn at all:
	 *  a control is its touch target, an icon its size, and anything else is the
	 *  wider of what it carries and the floor it is set. */
	function floorOf(part: Element): number | null {
		const classes = classesOf(part);
		if (classes.includes('sr-only') || classes.includes('hidden')) return null;
		const sized = classes.find((one) => /^size-\d+$/.test(one));
		if (sized) return Number(sized.slice(5)) * 4;
		return Math.max(spaceOf(classes, 'min-w'), carriedBy(part, classes));
	}

	function acrossOf(parts: Element[], gap: number): number {
		const drawn = parts.map(floorOf).filter((one): one is number => one !== null);
		return drawn.reduce((sum, one) => sum + one, 0) + gap * Math.max(0, drawn.length - 1);
	}

	/** Every width the row is drawn against, read off the surface that sets it:
	 *  what the run is held back either side, the stair below `sm` and how many
	 *  of them this row stands on, the gap between its parts, and its own end. */
	function acrossRow(row: HTMLElement): number {
		const run = row.closest('.max-w-4xl') as HTMLElement;
		const step = classesOf(run.parentElement as HTMLElement)
			.map((one) => /^\[--tree-step:([\d.]+)rem\]$/.exec(one))
			.find((one) => one !== null);
		const stairs = /calc\((\d+) \*/.exec(row.style.paddingInlineStart);
		const classes = classesOf(row);
		return (
			spaceOf(classesOf(run), 'px') * 2 +
			Number(stairs?.[1] ?? 0) * Number(step?.[1] ?? 0) * REM +
			acrossOf([...row.children], gapOf(classes)) +
			spaceOf(classes, 'pe')
		);
	}

	const bare: TreeSurfaceProps['sections'] = {
		shown: new SvelteSet<OwnedRef>(),
		of: () => undefined,
		says: () => ({ says: '', again: false }),
		onShow: () => {},
		onMove: () => {}
	};

	/** The widest row a reader can reach: set in as far as the outline sets one,
	 *  published, chosen, and carrying a tag the walk is lit by. */
	function deep(): HTMLElement {
		render({
			groups: [{ key: 'one', title: 'Field notes', notes: DEEP }],
			opened: new Set(DEEP.slice(0, 8).map((one) => one.ref)),
			selection: ['field' as Tag],
			chosen: new Set(DEEP.map((one) => one.ref)),
			writable: true,
			sections: bare
		});
		return labelled(`About ${DEEPEST}`);
	}

	it('fits the widest row the outline can draw', () => {
		const row = deep();
		expect(row.getAttribute('aria-level')).toBe('9');
		expect(row.getAttribute('aria-checked')).toBe('true');
		expect(row.textContent).toContain('Published');
		expect(row.textContent).toContain('1 note under this');

		expect(acrossRow(row)).toBeLessThanOrEqual(PHONE);
	});

	it('gives the row’s room to the title, which is what truncates', () => {
		const row = deep();
		const title = [...row.children].find((one) => classesOf(one).includes('flex-1')) as HTMLElement;

		expect(title.textContent?.trim()).toBe(`About ${DEEPEST}`);
		expect(classesOf(title)).toContain('truncate');
		expect(classesOf(title).filter((one) => /^min-w-/.test(one))).toEqual(['min-w-0']);
	});

	it('keeps every control at the touch target, with nothing set around it', () => {
		const row = deep();
		const controls = [...row.querySelectorAll('button')];

		expect(controls.map((one) => one.getAttribute('aria-label'))).toEqual([
			`Unfold ${DEEPEST}`,
			`Open the page of ${DEEPEST}`,
			`Write a note under ${DEEPEST}`
		]);
		for (const one of controls) {
			expect(classesOf(one)).toContain('size-11');
			expect(classesOf(one).filter((cls) => /^-?m[a-z]?-/.test(cls))).toEqual([]);
		}
	});
});
