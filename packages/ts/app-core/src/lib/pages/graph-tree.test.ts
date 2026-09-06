import type { NodeView, OwnedRef, Tag } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FakeApi, finding, node, ref, useFakeApi } from '../stores/fake-api.test-support.js';
import { people } from '../stores/people.svelte.js';
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
let fake: FakeApi;
let read: OwnedRef[];
/** The branches the reader has opened, held the way the graph page holds them. */
let unfolded: SvelteSet<OwnedRef>;
let scrolledTo: HTMLElement[];

function render(props: {
	notes: readonly NodeView[];
	fields?: { ref: OwnedRef; title: string }[];
	reading?: OwnedRef | null;
	selection?: Tag[];
}) {
	mounted = mount(GraphTree, {
		target,
		props: {
			notes: props.notes,
			fields: props.fields,
			reading: props.reading ?? null,
			selection: props.selection ?? [],
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

async function settle(): Promise<void> {
	for (let turn = 0; turn < 4; turn += 1) {
		await new Promise((done) => setTimeout(done, 0));
		flushSync();
	}
}

beforeEach(() => {
	fake = useFakeApi();
	finding(fake);
	people.hold(null);
	read = [];
	unfolded = new SvelteSet<OwnedRef>();
	scrolledTo = [];
	Object.defineProperty(globalThis, 'ResizeObserver', {
		configurable: true,
		writable: true,
		value: class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	});
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
		expect(scrolledTo).toEqual([labelled('1a1')]);
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
	const root = ref(20, OTHER);
	const region = [
		{ ...node(20, '3'), ref: root, created_by: OTHER, origin: root },
		{ ...node(21, '3a'), ref: ref(21, OTHER), created_by: OTHER, parent: root, origin: root }
	];

	function answersFor(did: string, displayName: string): void {
		fake.on(`GET /profile/${encodeURIComponent(did)}`, () => ({
			did,
			username: 'ada',
			display_name: displayName,
			bio: null,
			avatar_src: null,
			banner_src: null
		}));
	}

	// PRODUCT.md § Accessibility: the walk is a first-class way through the
	// graph, so it says whose notes these are before it reads a title.
	it('is one tree of its own, named for whoever wrote it', async () => {
		answersFor(OTHER, 'Ada Lovelace');
		render({ notes: region, fields: undefined });
		await settle();
		expect(shown()).toEqual(['3']);
		expect(target.querySelectorAll('[role="tree"]')).toHaveLength(1);
		expect(target.querySelector('h2')?.textContent?.trim()).toBe('Notes by Ada Lovelace');
		expect(target.querySelector('[role="tree"]')?.getAttribute('aria-label')).toBe(
			'Notes by Ada Lovelace'
		);
	});

	it('names them by the identity they travel under until their instance answers', () => {
		render({ notes: region, fields: undefined });
		expect(target.querySelector('h2')?.textContent?.trim()).toBe(`Notes by ${OTHER}`);
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
	it('gives a graph the host did not name a tree of its own, rather than dropping it', () => {
		render({
			notes: [node(30, '1', { graph: THESIS }), node(31, '1', { graph: GARDEN })],
			fields: [{ ref: THESIS, title: 'Thesis' }]
		});
		expect(rows()).toHaveLength(2);
		expect(target.querySelectorAll('[role="tree"]')).toHaveLength(2);
	});
});

describe('a tag the reader selected', () => {
	it('reaches the notes carrying it inside branches the reader left folded', () => {
		render({
			notes: [
				node(40, '1', { graph: THESIS }),
				node(41, '1a', { graph: THESIS, parent: ref(40), origin: ref(40) }),
				node(42, '1a1', {
					graph: THESIS,
					parent: ref(41),
					origin: ref(40),
					tags: ['question'] as Tag[]
				}),
				node(43, '2', { graph: THESIS })
			],
			fields: [{ ref: THESIS, title: 'Thesis' }],
			selection: ['question'] as Tag[]
		});
		expect(shown()).toEqual(['1', '1a', '1a1', '2']);
	});
});

describe('the notes last written into', () => {
	const branch = [
		node(50, '1', { graph: THESIS }),
		node(51, '1a', { graph: THESIS, parent: ref(50), origin: ref(50) }),
		node(52, '2', { graph: THESIS })
	];
	const fields = [{ ref: THESIS, title: 'Thesis' }];

	it('heads the walk, most recent first, whatever their addresses', async () => {
		finding(fake, { recent: [branch[1], branch[2]] });
		render({ notes: branch, fields });
		await settle();

		const trees = [...target.querySelectorAll<HTMLElement>('[role="tree"]')];
		expect(
			[...trees[0].querySelectorAll('.address')].map((one) => one.textContent?.trim())
		).toEqual(['1a', '2']);
		expect([...target.querySelectorAll('h2')].map((one) => one.textContent?.trim())).toEqual([
			'Last written'
		]);
	});

	it('opens the note whose row was tapped', async () => {
		finding(fake, { recent: [branch[1]] });
		render({ notes: branch, fields });
		await settle();

		rows()[0].click();
		expect(read).toEqual([ref(51)]);
	});

	it('asks for nothing where the branch is somebody else’s', async () => {
		const root = ref(60, OTHER);
		render({
			notes: [{ ...node(60, '3'), ref: root, created_by: OTHER, origin: root }],
			fields: undefined
		});
		await settle();

		expect(fake.countOf('GET /nodes/recent')).toBe(0);
	});

	it('heads the walk with a handful, however many came back', async () => {
		const dozen = Array.from({ length: 12 }, (_, at) =>
			node(80 + at, `${at + 1}`, { graph: THESIS })
		);
		finding(fake, { recent: dozen });
		render({ notes: dozen, fields });
		await settle();

		const trees = [...target.querySelectorAll<HTMLElement>('[role="tree"]')];
		expect(trees[0].querySelectorAll('.address')).toHaveLength(8);
	});

	it('leaves out a note this walk is not showing', async () => {
		finding(fake, { recent: [node(70, '1', { graph: GARDEN }), branch[2]] });
		render({ notes: branch, fields });
		await settle();

		const trees = [...target.querySelectorAll<HTMLElement>('[role="tree"]')];
		expect(
			[...trees[0].querySelectorAll('.address')].map((one) => one.textContent?.trim())
		).toEqual(['2']);
	});

	it('asks each graph on the canvas for its own, and names the one each run is read in', async () => {
		const thesis = node(90, '1', { graph: THESIS });
		const garden = node(91, '1', { graph: GARDEN });
		fake.on('GET /nodes/recent', (url) => [
			url.searchParams.get('graph') === GARDEN ? garden : thesis
		]);
		render({
			notes: [thesis, garden],
			fields: [
				{ ref: THESIS, title: 'Thesis' },
				{ ref: GARDEN, title: 'Garden' }
			]
		});
		await settle();

		expect([...target.querySelectorAll('h2')].map((one) => one.textContent?.trim())).toEqual([
			'Last written in Thesis',
			'Thesis',
			'Last written in Garden',
			'Garden'
		]);
		const trees = [...target.querySelectorAll<HTMLElement>('[role="tree"]')];
		expect(trees).toHaveLength(4);
		expect(
			[trees[0], trees[2]].map((tree) =>
				tree.querySelector('[role="treeitem"]')?.getAttribute('data-row')
			)
		).toEqual([`lead:${thesis.ref}`, `lead:${garden.ref}`]);
	});

	it('heads the walk with nothing when the list will not read', async () => {
		fake.on('GET /nodes/recent', () => new Response('{"message":"Not now."}', { status: 500 }));
		render({ notes: branch, fields });
		await settle();

		expect(target.querySelector('h2')).toBeNull();
		expect(shown()).toEqual(['1', '2']);
	});
});
