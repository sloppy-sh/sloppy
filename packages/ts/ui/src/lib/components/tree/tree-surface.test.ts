// @vitest-environment jsdom
import type { Address, OwnedRef, Tag } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubResizeObserver } from '../dom.test-support.js';
import type { OutlineSections, TreeSection } from './sections.js';
import TreeSurface, { type TreeGroup, type TreeSurfaceProps } from './tree-surface.svelte';
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
			sections: props.sections
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
	besides = [];
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

// AI.md § "The Address Is the Protocol": a drag writes one more note at the end
// of a run, and no note already written moves.
describe('dragging a row’s write control to where the note goes', () => {
	const OPEN = { writable: true, opened: new Set([held('1')]) };

	/** The outline laid out: rows 44 tall, each row's words set in by its depth. */
	function lay(): void {
		for (const [at, row] of rows().entries()) {
			const level = Number(row.getAttribute('aria-level') ?? 1);
			Object.defineProperty(row, 'getBoundingClientRect', {
				configurable: true,
				value: () => ({ top: at * 44, bottom: at * 44 + 44, left: 0, right: 400 })
			});
			const words = row.querySelector('.address');
			if (!words) continue;
			Object.defineProperty(words, 'getBoundingClientRect', {
				configurable: true,
				value: () => ({ top: at * 44, bottom: at * 44 + 44, left: 10 + (level - 1) * 20 })
			});
		}
	}

	const gripOn = (address: string) =>
		labelled(`About ${address}`).querySelector<HTMLButtonElement>(
			'[aria-label^="Write a note under"]'
		) as HTMLButtonElement;

	const pull = (type: string, x: number, y: number, by = 'mouse'): PointerEvent => {
		const event = new Event(type, { bubbles: true, cancelable: true });
		Object.assign(event, { pointerId: 5, pointerType: by, button: 0, clientX: x, clientY: y });
		return event as PointerEvent;
	};

	/** What the surface says the drop will do, as anyone listening hears it. */
	const said = () => target.querySelector('[role="status"]')?.textContent?.trim() ?? '';

	const marked = () =>
		rows()
			.filter((row) => row.className.includes('border-dashed'))
			.map((row) => row.querySelector('.address')?.textContent?.trim());

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
			}
		});
		lay();

		gripOn('1').dispatchEvent(pull('pointerdown', 200, 10));
		window.dispatchEvent(pull('pointermove', 60, 110));
		flushSync();
		expect(said()).toBe('Write under 1a About 1a');
		expect(marked()).toEqual(['1a']);

		window.dispatchEvent(pull('pointerup', 60, 110));
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
describe('a note’s sections under its row in the walk', () => {
	const S1 = held('1/s1');
	const S2 = held('1/s2');
	const S3 = held('1/s3');

	let stack: TreeSection[];
	let shows: [OwnedRef, boolean][];
	let moves: [OwnedRef, OwnedRef, OwnedRef | null][];
	let word: string;
	let again: boolean;

	function sections(
		shown: OwnedRef[] = [held('1')]
	): OutlineSections & { shown: SvelteSet<OwnedRef> } {
		return {
			shown: new SvelteSet(shown),
			of: (note) => (note === held('1') ? stack : undefined),
			says: () => ({ says: word, again }),
			onShow: (note, show) => shows.push([note, show]),
			onMove: (note, section, after) => moves.push([note, section, after])
		};
	}

	const sectionRow = (of: OwnedRef) =>
		target.querySelector<HTMLElement>(`[data-row="section:${of}"]`) as HTMLElement;

	const gripIn = (of: OwnedRef) => sectionRow(of).querySelector('button') as HTMLButtonElement;

	/** Every row 44 tall, in the order they are drawn. */
	function lay(): void {
		for (const [at, row] of rows().entries()) {
			Object.defineProperty(row, 'getBoundingClientRect', {
				configurable: true,
				value: () => ({ top: at * 44, bottom: at * 44 + 44, left: 0, right: 400 })
			});
		}
	}

	const pull = (type: string, x: number, y: number): PointerEvent => {
		const event = new Event(type, { bubbles: true, cancelable: true });
		Object.assign(event, { pointerId: 7, pointerType: 'mouse', button: 0, clientX: x, clientY: y });
		return event as PointerEvent;
	};

	const said = () => target.querySelector('[role="status"]')?.textContent?.trim() ?? '';

	beforeEach(() => {
		stack = [
			{ ref: S1, says: 'The first thing' },
			{ ref: S2, says: 'A drawing' },
			{ ref: S3, says: 'The last thing' }
		];
		shows = [];
		moves = [];
		word = '';
		again = false;
	});

	it('draws each section under the note, by its first line', () => {
		render({ sections: sections() });
		expect(rows().map((row) => row.textContent?.trim())).toEqual([
			expect.stringContaining('About 1'),
			'The first thing',
			'A drawing',
			'The last thing',
			expect.stringContaining('About 2')
		]);
	});

	// The notes at this level are counted as their own set, so the stack is
	// counted on its handles rather than a second time on the rows.
	it('sets the sections one level under the note and counts them on their handles', () => {
		render({ sections: sections() });
		expect(sectionRow(S2).getAttribute('aria-level')).toBe('2');
		expect(sectionRow(S2).getAttribute('aria-posinset')).toBeNull();
		expect(sectionRow(S2).getAttribute('aria-setsize')).toBeNull();
		expect(gripIn(S2).getAttribute('aria-label')).toBe('Move section 2 of 3 in 1');
	});

	it('leaves the walk the notes alone where it was given no sections', () => {
		render();
		expect(rows()).toHaveLength(2);
		expect(target.querySelector('[aria-label^="Show the sections"]')).toBeNull();
	});

	it('asks for a note’s sections from its own control, apart from the branch', () => {
		render({ sections: sections([]) });
		const control = labelled('About 1').querySelector<HTMLButtonElement>(
			'[aria-label^="Show the sections"]'
		) as HTMLButtonElement;
		control.click();
		flushSync();
		expect(shows).toEqual([[held('1'), true]]);
		expect(toggled).toEqual([]);
		expect(openedNotes).toEqual([]);
	});

	it('asks for them and folds them back from the keyboard, apart from the branch', () => {
		render({ sections: sections([]), opened: new Set([held('1')]) });
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
		render({ sections: sections([]) });
		press(labelled('About 1'), 'ArrowRight');
		expect(toggled).toEqual([[held('1'), true]]);
		expect(shows).toEqual([]);
	});

	it('folds them back up from the same control', () => {
		render({ sections: sections() });
		const control = labelled('About 1').querySelector<HTMLButtonElement>(
			'[aria-label^="Hide the sections"]'
		) as HTMLButtonElement;
		control.click();
		flushSync();
		expect(shows).toEqual([[held('1'), false]]);
	});

	it('says what stands under a note that has no sections to draw, and answers no tap', () => {
		stack = [];
		word = 'Nothing is written in this note yet';
		render({ sections: sections() });
		expect(rows().map((row) => row.textContent?.trim())).toEqual([
			expect.stringContaining('About 1'),
			'Nothing is written in this note yet',
			expect.stringContaining('About 2')
		]);

		rows()[1].click();
		flushSync();
		expect(shows).toEqual([]);
		expect(rows()[1].className).not.toContain('cursor-pointer');
	});

	it('asks for the note again from the one word that offers it', () => {
		stack = [];
		word = 'These sections could not be read. Tap to try again.';
		again = true;
		render({ sections: sections() });
		expect(rows()[1].className).toContain('cursor-pointer');

		rows()[1].click();
		flushSync();
		expect(shows).toEqual([[held('1'), true]]);
	});

	it('keeps the row’s own fold what aria-expanded stands for', () => {
		render({ sections: sections() });
		expect(labelled('About 1').getAttribute('aria-expanded')).toBe('false');
		expect(labelled('About 2').getAttribute('aria-expanded')).toBeNull();
		expect(
			labelled('About 1')
				.querySelector('[aria-label^="Hide the sections"]')
				?.getAttribute('aria-expanded')
		).toBe('true');
	});

	it('leaves the sections chord to the tree, not to the run at its head', () => {
		render({
			lead: [{ group: 'one', title: 'Last written', notes: [note('1')] }],
			sections: sections([])
		});
		const head = rows()[0];
		expect(head.getAttribute('aria-keyshortcuts')).toBeNull();

		press(head, 'ArrowRight', { altKey: true });
		expect(shows).toEqual([]);
	});

	it('moves a section with the arrow keys, within its own note', () => {
		render({ sections: sections() });
		press(sectionRow(S3), 'ArrowUp', { altKey: true });
		expect(moves).toEqual([[held('1'), S3, S1]]);

		press(sectionRow(S1), 'ArrowDown', { altKey: true });
		expect(moves).toEqual([
			[held('1'), S3, S1],
			[held('1'), S1, S2]
		]);
	});

	it('leaves the plain arrows walking the rows', () => {
		render({ sections: sections() });
		press(sectionRow(S2), 'ArrowDown');
		expect(moves).toEqual([]);
		expect(document.activeElement).toBe(sectionRow(S3));
	});

	it('moves nothing at either end of the stack', () => {
		render({ sections: sections() });
		press(sectionRow(S1), 'ArrowUp', { altKey: true });
		press(sectionRow(S3), 'ArrowDown', { altKey: true });
		expect(moves).toEqual([]);
	});

	it('puts a dragged section where it is let go, and says so first', () => {
		render({ sections: sections() });
		lay();

		gripIn(S3).dispatchEvent(pull('pointerdown', 30, 150));
		window.dispatchEvent(pull('pointermove', 30, 50));
		flushSync();
		expect(said()).toBe('Put it first in 1');

		window.dispatchEvent(pull('pointerup', 30, 50));
		flushSync();
		expect(moves).toEqual([[held('1'), S3, null]]);
		expect(said()).toBe('');
	});

	it('names the section a drop would follow', () => {
		render({ sections: sections() });
		lay();

		gripIn(S1).dispatchEvent(pull('pointerdown', 30, 50));
		window.dispatchEvent(pull('pointermove', 30, 140));
		flushSync();
		expect(said()).toBe('Put it after A drawing');

		window.dispatchEvent(pull('pointerup', 30, 140));
		flushSync();
		expect(moves).toEqual([[held('1'), S1, S2]]);
	});

	// A section belongs to the note it was written in, and the walk says so
	// rather than letting go of it somewhere it cannot land.
	it('refuses a drop outside the note, in words, and moves nothing', () => {
		render({ sections: sections() });
		lay();

		gripIn(S1).dispatchEvent(pull('pointerdown', 30, 50));
		window.dispatchEvent(pull('pointermove', 30, 200));
		flushSync();
		expect(said()).toBe('A section stays in the note it was written in');

		window.dispatchEvent(pull('pointerup', 30, 200));
		flushSync();
		expect(moves).toEqual([]);
	});

	it('neither moves nor opens the note when Escape calls the drag off', () => {
		render({ sections: sections() });
		lay();

		gripIn(S1).dispatchEvent(pull('pointerdown', 30, 50));
		window.dispatchEvent(pull('pointermove', 30, 140));
		flushSync();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		window.dispatchEvent(pull('pointerup', 30, 140));
		flushSync();

		expect(moves).toEqual([]);
		expect(openedNotes).toEqual([]);
	});

	it('opens the note a section belongs to when its row is tapped', () => {
		render({ sections: sections() });
		sectionRow(S2).click();
		flushSync();
		expect(openedNotes).toEqual([held('1')]);
	});

	// A tap while notes are being chosen adds the note it belongs to, as every
	// other row of the walk does, rather than leaving the choosing for it.
	it('chooses the note a section belongs to while the walk is being chosen on', () => {
		render({ sections: sections(), chosen: new Set<OwnedRef>() });
		sectionRow(S2).click();
		flushSync();
		expect(openedNotes).toEqual([]);
		expect(chose).toEqual([held('1')]);
	});

	// A finger has no hover and no held key, so the handle answers a tap with
	// the same move a drag makes.
	it('offers a place up and a place down from the handle it is dragged by', () => {
		render({ sections: sections() });
		gripIn(S2).click();
		flushSync();

		const up = sectionRow(S2).querySelector<HTMLButtonElement>('[aria-label^="Move it up"]');
		const down = sectionRow(S2).querySelector<HTMLButtonElement>('[aria-label^="Move it down"]');
		up?.click();
		down?.click();
		flushSync();
		expect(moves).toEqual([
			[held('1'), S2, null],
			[held('1'), S2, S3]
		]);
		expect(openedNotes).toEqual([]);
	});

	it('offers neither at the end of the stack it is already at', () => {
		render({ sections: sections() });
		gripIn(S1).click();
		flushSync();
		expect(
			sectionRow(S1).querySelector<HTMLButtonElement>('[aria-label^="Move it up"]')?.disabled
		).toBe(true);
		expect(
			sectionRow(S1).querySelector<HTMLButtonElement>('[aria-label^="Move it down"]')?.disabled
		).toBe(false);
	});

	it('draws them on the one handle that was tapped, and folds them back', () => {
		render({ sections: sections() });
		gripIn(S1).click();
		flushSync();
		expect(sectionRow(S2).querySelector('[aria-label^="Move it up"]')).toBeNull();

		gripIn(S1).click();
		flushSync();
		expect(sectionRow(S1).querySelector('[aria-label^="Move it up"]')).toBeNull();
	});

	it('lets go of the handle it was offering when the note is folded back up', () => {
		const surface = sections();
		render({ sections: surface });
		gripIn(S2).click();
		flushSync();
		expect(sectionRow(S2).querySelector('[aria-label^="Move it up"]')).not.toBeNull();

		surface.shown.delete(held('1'));
		flushSync();
		surface.shown.add(held('1'));
		flushSync();

		expect(sectionRow(S2).querySelector('[aria-label^="Move it up"]')).toBeNull();
		expect(gripIn(S2).getAttribute('aria-expanded')).toBe('false');
	});

	it('leaves them out of a drag that ended on the handle', () => {
		render({ sections: sections() });
		lay();

		gripIn(S3).dispatchEvent(pull('pointerdown', 30, 150));
		window.dispatchEvent(pull('pointermove', 30, 50));
		window.dispatchEvent(pull('pointerup', 30, 50));
		gripIn(S3).dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		expect(sectionRow(S3).querySelector('[aria-label^="Move it up"]')).toBeNull();
	});

	// The two drags a row offers stand on one surface and say their words in one
	// place, so a section moved leaves nothing behind for the note written next.
	it('keeps a section drag and a write drag to their own words and their own act', () => {
		render({ writable: true, sections: sections() });
		lay();

		gripIn(S1).dispatchEvent(pull('pointerdown', 30, 50));
		window.dispatchEvent(pull('pointermove', 30, 140));
		flushSync();
		expect(said()).toBe('Put it after A drawing');

		window.dispatchEvent(pull('pointerup', 30, 140));
		flushSync();
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
			`Show the sections of ${DEEPEST}`,
			`Write a note under ${DEEPEST}`
		]);
		for (const one of controls) {
			expect(classesOf(one)).toContain('size-11');
			expect(classesOf(one).filter((cls) => /^-?m[a-z]?-/.test(cls))).toEqual([]);
		}
	});
});
