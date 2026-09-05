import type { NodeView, OwnedRef } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { node, ref } from '../stores/fake-api.test-support.js';
import GraphTree from './graph-tree.svelte';

const OTHER = 'did:syr:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH';

const THESIS = ref(900);
const GARDEN = ref(901);

/** `1` → `a`, `27` → `aa`, the way a letter segment counts. */
function letters(ordinal: number): string {
	let out = '';
	let left = ordinal;
	while (left > 0) {
		out = String.fromCharCode(97 + ((left - 1) % 26)) + out;
		left = Math.floor((left - 1) / 26);
	}
	return out;
}

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let read: OwnedRef[];
/** The branches the reader has opened, held the way the graph page holds them. */
let unfolded: SvelteSet<OwnedRef>;

function render(props: {
	notes: readonly NodeView[];
	fields?: { ref: OwnedRef; title: string }[];
	reading?: OwnedRef | null;
}) {
	mounted = mount(GraphTree, {
		target,
		props: {
			notes: props.notes,
			fields: props.fields,
			reading: props.reading ?? null,
			opened: unfolded,
			inset: { top: '0px', bottom: '0px' },
			onToggle: (of: OwnedRef, open: boolean) => (open ? unfolded.add(of) : unfolded.delete(of)),
			onOpen: (of: OwnedRef) => read.push(of)
		}
	});
	flushSync();
}

const rows = () => [...target.querySelectorAll<HTMLElement>('[role="treeitem"]')];

const shown = () =>
	rows().map(
		(row) => row.querySelector('.address')?.textContent?.trim() ?? row.textContent?.trim()
	);

const labelled = (address: string) =>
	rows().find(
		(row) => row.querySelector('.address')?.textContent?.trim() === address
	) as HTMLElement;

beforeEach(() => {
	read = [];
	unfolded = new SvelteSet<OwnedRef>();
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
});

describe('the graph walked as a tree', () => {
	const branch = [
		node(1, '1', { graph: THESIS }),
		node(2, '1a', { graph: THESIS, parent: ref(1), origin: ref(1) }),
		node(3, '1a1', { graph: THESIS, parent: ref(2), origin: ref(1) }),
		node(4, '2', { graph: THESIS })
	];

	it('starts folded, at the notes with nothing above them', () => {
		render({ notes: branch, fields: [{ ref: THESIS, title: 'Thesis' }] });
		expect(shown()).toEqual(['1', '2']);
	});

	it('goes down into a branch and back out again', () => {
		render({ notes: branch, fields: [{ ref: THESIS, title: 'Thesis' }] });
		(rows()[0].querySelector('button') as HTMLButtonElement).click();
		flushSync();
		expect(shown()).toEqual(['1', '1a', '2']);
		(rows()[0].querySelector('button') as HTMLButtonElement).click();
		flushSync();
		expect(shown()).toEqual(['1', '2']);
	});

	it('opens the note whose row was tapped', () => {
		render({ notes: branch, fields: [{ ref: THESIS, title: 'Thesis' }] });
		rows()[1].click();
		expect(read).toEqual([ref(4)]);
	});

	it('goes to the note being read, wherever down the tree it sits', () => {
		render({
			notes: branch,
			fields: [{ ref: THESIS, title: 'Thesis' }],
			reading: ref(3)
		});
		expect(shown()).toEqual(['1', '1a', '1a1', '2']);
		expect(labelled('1a1').getAttribute('aria-selected')).toBe('true');
	});

	it('never branches on the notes a note names', () => {
		const cited = node(5, '9', { graph: THESIS });
		const citing = {
			...node(6, '8', { graph: THESIS }),
			references: [cited.ref],
			links: [cited.ref]
		};
		render({ notes: [citing, cited], fields: [{ ref: THESIS, title: 'Thesis' }] });
		expect(shown()).toEqual(['8', '9']);
		expect(rows().every((row) => row.querySelector('button') === null)).toBe(true);
	});
});

describe('several graphs on the canvas', () => {
	const notes = [
		node(10, '1', { graph: THESIS }),
		node(11, '2', { graph: THESIS }),
		node(12, '1', { graph: GARDEN })
	];
	const fields = [
		{ ref: THESIS, title: 'Thesis' },
		{ ref: GARDEN, title: 'Garden' }
	];

	it('gives each graph its own tree, in the order the fields sit in', () => {
		render({ notes, fields });
		expect([...target.querySelectorAll('h2')].map((head) => head.textContent?.trim())).toEqual([
			'Thesis',
			'Garden'
		]);
		expect(target.querySelectorAll('[role="tree"]')).toHaveLength(2);
	});

	it('names no graph where the canvas holds one', () => {
		render({ notes: notes.slice(2), fields: [fields[1]] });
		expect(target.querySelector('h2')).toBeNull();
	});
});

describe('a branch pulled from somebody else', () => {
	it('is one tree of its own, with nobody named over it', () => {
		const root = ref(20, OTHER);
		render({
			notes: [
				{ ...node(20, '3'), ref: root, created_by: OTHER, origin: root },
				{ ...node(21, '3a'), ref: ref(21, OTHER), created_by: OTHER, parent: root, origin: root }
			],
			fields: undefined
		});
		expect(shown()).toEqual(['3']);
		expect(target.querySelector('h2')).toBeNull();
		expect(target.querySelectorAll('[role="tree"]')).toHaveLength(1);
	});
});

describe('a graph of a few thousand notes', () => {
	const notes = Array.from({ length: 40 }, (_, root) => root + 1).flatMap((root) => [
		node(root, `${root}`, { graph: THESIS }),
		...Array.from({ length: 80 }, (_, at) =>
			node(1_000 + root * 100 + at, `${root}${letters(at + 1)}`, {
				graph: THESIS,
				parent: ref(root),
				origin: ref(root)
			})
		)
	]);

	it('draws the branches and nothing beneath them', () => {
		expect(notes.length).toBeGreaterThan(3_000);
		render({ notes, fields: [{ ref: THESIS, title: 'Thesis' }] });
		expect(rows()).toHaveLength(40);
	});

	it('draws one branch when one branch is opened', () => {
		render({ notes, fields: [{ ref: THESIS, title: 'Thesis' }] });
		(rows()[0].querySelector('button') as HTMLButtonElement).click();
		flushSync();
		expect(rows()).toHaveLength(40 + 80);
	});
});

describe('the tree and the canvas show the same graphs', () => {
	it('leaves out a note whose graph is not one of the fields', () => {
		render({
			notes: [node(30, '1', { graph: THESIS }), node(31, '1', { graph: GARDEN })],
			fields: [{ ref: THESIS, title: 'Thesis' }]
		});
		expect(rows()).toHaveLength(1);
	});
});
