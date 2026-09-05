// @vitest-environment jsdom
import type { Address, OwnedRef, Tag } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubResizeObserver } from '../dom.test-support.js';
import TreeSurface, { type TreeGroup } from './tree-surface.svelte';
import { RUN_PAGE, type TreeNote } from './walk.js';

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
let scrolledTo: HTMLElement[];

function render(
	props: {
		groups?: TreeGroup[];
		opened?: Set<OwnedRef>;
		selection?: Tag[];
		reading?: OwnedRef | null;
	} = {}
) {
	mounted = mount(TreeSurface, {
		target,
		props: {
			groups: props.groups ?? [{ key: 'one', title: 'Field notes', notes: BRANCH }],
			opened: props.opened ?? new Set<OwnedRef>(),
			selection: props.selection,
			reading: props.reading ?? null,
			onOpen: (ref: OwnedRef) => openedNotes.push(ref),
			onToggle: (ref: OwnedRef, open: boolean) => toggled.push([ref, open])
		}
	});
	flushSync();
}

const rows = () => [...target.querySelectorAll<HTMLElement>('[role="treeitem"]')];

const labelled = (address: string) =>
	rows().find((row) => row.textContent?.includes(address)) as HTMLElement;

const press = (row: HTMLElement, key: string) => {
	row.focus();
	row.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
	flushSync();
};

beforeEach(() => {
	openedNotes = [];
	toggled = [];
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
});
