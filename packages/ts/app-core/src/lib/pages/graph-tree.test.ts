import type { BlockView, NodeView, NoteDestination, OwnedRef, Tag } from '@sloppy/types';
import { sectionLines } from '@sloppy/ui';
import { flushSync, mount, unmount } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	arranging,
	AT,
	DID,
	type FakeApi,
	finding,
	moving,
	node,
	ref,
	useFakeApi,
	writing
} from '../stores/fake-api.test-support.js';
import { outlineSections } from '../stores/outline-sections.svelte.js';
import { people } from '../stores/people.svelte.js';
import GraphTree from './graph-tree.svelte';

const OTHER = 'did:syr:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH';

/** As much of the editor as a test writing in one touches; the editor itself is
 *  TipTap's, which this package does not depend on. */
interface Writing {
	state: { doc: { textContent: string; content: { size: number } } };
	commands: { insertContentAt: (at: number, text: string) => void };
}

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

/** One tree's rows and the interiors opened between them, in the order they are
 *  drawn; a tree owns its rows by id, so its own element holds nothing. */
const rowsAndInteriors = (tree: Element): HTMLElement[] =>
	([...tree.children] as HTMLElement[]).filter(
		(part) => part.getAttribute('role') === 'treeitem' || part.hasAttribute('data-interior')
	);

const shown = () =>
	rows().map(
		(row) => row.querySelector('.address')?.textContent?.trim() ?? row.textContent?.trim()
	);

/** What the outline says about the last act, as anyone listening hears it —
 *  its own line, apart from anything an open note says about itself. */
const said = () =>
	target.querySelector('[role="status"][aria-live="polite"]')?.textContent?.trim() ?? '';

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
	// Which notes are open in the outline outlives a mount, so a suite has to
	// put it back itself.
	outlineSections.clear();
	read = [];
	unfolded = new SvelteSet<OwnedRef>();
	scrolledTo = [];
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
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

	it('opens the note whose row was tapped where it stands', () => {
		render({ notes: branch, fields: [{ ref: THESIS, title: 'Thesis' }] });
		rows()[1].click();
		flushSync();
		expect(read).toEqual([]);
		expect(target.querySelector(`[data-interior="${ref(4)}"]`)).not.toBeNull();
	});

	it('takes the reader to a note’s own page from the row’s own act', () => {
		render({ notes: branch, fields: [{ ref: THESIS, title: 'Thesis' }] });
		const act = rows()[1].querySelector<HTMLButtonElement>('[aria-label^="Open the page of"]');
		act?.click();
		flushSync();
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
		expect(rows().every((row) => row.querySelector('[aria-label^="Unfold"]') === null)).toBe(true);
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

	it('names nobody, and never the identity they travel under, until their instance answers', () => {
		render({ notes: region, fields: undefined });
		const shown = target.textContent ?? '';
		expect(shown).not.toContain(OTHER);
		expect(shown).not.toContain('z6Mk');
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

		const trees = [...target.querySelectorAll<HTMLElement>('[data-tree]')];
		expect(
			[...trees[0].querySelectorAll('.address')].map((one) => one.textContent?.trim())
		).toEqual(['1a', '2']);
		expect([...target.querySelectorAll('h2')].map((one) => one.textContent?.trim())).toEqual([
			'Last written'
		]);
	});

	it('opens the note whose row was tapped on its own row down the tree', async () => {
		finding(fake, { recent: [branch[1]] });
		render({ notes: branch, fields });
		await settle();

		rows()[0].click();
		await settle();
		expect(read).toEqual([]);
		expect(shown().slice(0, 3)).toEqual(['1a', '1', '1a']);
		expect(target.querySelector(`[data-interior="${ref(51)}"]`)).not.toBeNull();
		expect(said()).toBe('1a is open here');
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

		const trees = [...target.querySelectorAll<HTMLElement>('[data-tree]')];
		expect(trees[0].querySelectorAll('.address')).toHaveLength(8);
	});

	it('leaves out a note this walk is not showing', async () => {
		finding(fake, { recent: [node(70, '1', { graph: GARDEN }), branch[2]] });
		render({ notes: branch, fields });
		await settle();

		const trees = [...target.querySelectorAll<HTMLElement>('[data-tree]')];
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
		const trees = [...target.querySelectorAll<HTMLElement>('[data-tree]')];
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

// AI.md § "A Block Is a Section": the walk shows a note's sections and reorders
// them, and does nothing else to one.
describe('a note’s sections in the walk', () => {
	const NOTE = ref(1);
	const S1 = ref(41);
	const S2 = ref(42);
	const branch = [node(1, '1', { graph: THESIS })];

	const blocksPath = `/nodes/${encodeURIComponent(DID)}/${encodeURIComponent(
		NOTE.split('/')[1]
	)}/blocks`;

	function section(of: OwnedRef, ord: string, line: string) {
		return {
			ref: of,
			created_by: DID,
			created_at: AT,
			updated_at: AT,
			node: NOTE,
			ord,
			content: {
				type: 'doc',
				content: [{ type: 'paragraph', content: [{ type: 'text', text: line }] }]
			}
		};
	}

	const handles = () =>
		[...target.querySelectorAll<HTMLButtonElement>('[data-handle]')].map(
			(one) => one.dataset.handle
		);

	/** Opens the note where it stands, which is what a tap on its row does. */
	async function openInPlace(): Promise<void> {
		rows()[0].click();
		await settle();
	}

	beforeEach(() => {
		fake.on(`GET ${blocksPath}`, () => [
			section(S1, '1', 'The first thing'),
			section(S2, '2', 'The last thing')
		]);
	});

	it('draws what is written in the note under its row once the reader asks', async () => {
		render({ notes: branch, fields: [{ ref: THESIS, title: 'Thesis' }] });
		await openInPlace();

		const held = target.querySelector(`[data-interior="${NOTE}"]`) as HTMLElement;
		expect(held).not.toBeNull();
		expect(held.textContent).toContain('The first thing');
		expect(held.textContent).toContain('The last thing');
		expect(held.querySelector('[contenteditable]')).not.toBeNull();
		expect(handles()).toEqual([S1, S2]);
		expect(read).toEqual([]);
	});

	it('reorders one through the same note, and asks the server to keep it there', async () => {
		let asked: unknown = null;
		const path = `/blocks/${encodeURIComponent(DID)}/${encodeURIComponent(S2.split('/')[1])}`;
		fake.on(`PATCH ${path}`, (_url, init) => {
			asked = JSON.parse(String(init?.body ?? '{}'));
			return section(S2, '0', 'The last thing');
		});

		render({ notes: branch, fields: [{ ref: THESIS, title: 'Thesis' }] });
		await openInPlace();

		const handle = target.querySelector<HTMLButtonElement>(
			`[data-handle="${S2}"]`
		) as HTMLButtonElement;
		handle.focus();
		handle.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'ArrowUp',
				altKey: true,
				bubbles: true,
				cancelable: true
			})
		);
		flushSync();
		expect(handles()).toEqual([S2, S1]);

		await settle();
		expect(asked).toMatchObject({ after: null });
	});

	// A held region is one author's alone: nothing in it is the reader's to read
	// here or to arrange, so the walk of it is the notes and nothing else.
	it('offers nothing to arrange on a branch pulled from somebody else', async () => {
		const root = ref(20, OTHER);
		render({
			notes: [{ ...node(20, '3'), ref: root, created_by: OTHER, origin: root }],
			fields: undefined
		});
		await settle();
		rows()[0].click();
		await settle();
		expect(target.querySelector('[data-interior]')).toBeNull();
		expect(read).toEqual([ref(20, OTHER)]);
	});
});

// AI.md § "A Block Is a Section": a section is carried by its handle, and where
// it lands is another note's stack, a note, or a note of its own in the run it
// was let go in.
describe('carrying a section out of the note it was written in', () => {
	const ONE = ref(1);
	const TWO = ref(2);
	const S1 = ref(41);
	const S2 = ref(42);
	const T1 = ref(43);
	const MADE = ref(50);
	const branch = [node(1, '1', { graph: THESIS }), node(2, '2', { graph: THESIS })];

	function section(of: OwnedRef, note: OwnedRef, ord: string, line: string): BlockView {
		return {
			ref: of,
			created_by: DID,
			created_at: AT,
			updated_at: AT,
			node: note,
			ord,
			content: {
				type: 'doc',
				content: [{ type: 'paragraph', content: [{ type: 'text', text: line }] }]
			}
		};
	}

	let stacks: Map<OwnedRef, BlockView[]>;

	function box(part: Element, top: number, bottom: number): void {
		Object.defineProperty(part, 'getBoundingClientRect', {
			configurable: true,
			value: () => ({ top, bottom, left: 0, right: 400 })
		});
	}

	/** Note rows 44 tall, each open note's interior 60 under its own row. */
	function lay(): void {
		let y = 0;
		for (const tree of target.querySelectorAll('[data-tree]')) {
			for (const part of rowsAndInteriors(tree)) {
				const tall = part.hasAttribute('data-interior') ? 60 : 44;
				box(part, y, y + tall);
				for (const one of part.querySelectorAll<HTMLElement>('[data-handle]')) {
					box(one, y, y + 44);
				}
				y += tall;
			}
		}
	}

	const pull = (type: string, x: number, y: number): PointerEvent => {
		const event = new Event(type, { bubbles: true, cancelable: true });
		Object.assign(event, { pointerId: 9, pointerType: 'mouse', button: 0, clientX: x, clientY: y });
		return event as PointerEvent;
	};

	/** The handles measure nothing in jsdom, so the sections a drop reads are the
	 *  handles standing beside them. */
	function carry(section: OwnedRef, to: { x?: number; y: number }): void {
		const handle = target.querySelector<HTMLButtonElement>(
			`[data-handle="${section}"]`
		) as HTMLButtonElement;
		handle.dispatchEvent(pull('pointerdown', 10, 10));
		window.dispatchEvent(pull('pointermove', to.x ?? 0, to.y));
		flushSync();
		window.dispatchEvent(pull('pointerup', to.x ?? 0, to.y));
		flushSync();
	}

	beforeEach(() => {
		stacks = arranging(fake, {
			[ONE]: [section(S1, ONE, '1', 'The first thing'), section(S2, ONE, '2', 'The last thing')],
			[TWO]: [section(T1, TWO, '1', 'Something else')],
			[MADE]: []
		});
	});

	/** Opens each named note where it stands, and lays the outline out. */
	async function walk(open: OwnedRef[]): Promise<void> {
		render({ notes: branch, fields: [{ ref: THESIS, title: 'Thesis' }] });
		await settle();
		for (const note of open) {
			labelled(note === ONE ? '1' : '2').click();
			await settle();
		}
		lay();
	}

	it('lands it in another open note’s stack, where it was let go', async () => {
		await walk([ONE, TWO]);
		// 1 is 0–44, its interior 44–104 with both handles at 44–88; 2 is 104–148
		// and its interior 148–208, its one handle at 148–192.
		carry(S1, { y: 190 });
		await settle();

		expect(stacks.get(TWO)?.map((one) => one.ref)).toEqual([T1, S1]);
		expect(stacks.get(ONE)?.map((one) => one.ref)).toEqual([S2]);
	});

	it('lands it at the end of a note that is not open, having read that note', async () => {
		await walk([ONE]);
		// 1 is 0–44, its interior 44–104, and 2 is 104–148 with nothing open.
		carry(S1, { y: 126 });
		await settle();

		expect(stacks.get(TWO)?.map((one) => one.ref)).toEqual([T1, S1]);
		expect(stacks.get(ONE)?.map((one) => one.ref)).toEqual([S2]);
	});

	it('writes a note in the run it is let go between, with the section in it', async () => {
		let placed: unknown;
		writing(fake, (request) => {
			placed = request.from;
			return { ...node(50, '2a', { graph: THESIS }), parent: TWO, origin: TWO };
		});
		await walk([ONE]);
		// Past the words of 2, at the edge of its row, which is the run under it.
		carry(S1, { x: 60, y: 144 });
		await settle();

		expect(placed).toEqual({ relation: 'under', note: TWO });
		expect(stacks.get(MADE)?.map((one) => one.ref)).toEqual([S1]);
		expect(stacks.get(ONE)?.map((one) => one.ref)).toEqual([S2]);
	});

	// The stamp the carry left on the section is what the writing there is made
	// against, so it is not refused as writing that happened somewhere else.
	it('writes in a section where it landed, having carried it there', async () => {
		await walk([ONE, TWO]);
		carry(S1, { y: 190 });
		await settle();

		const writing = [...target.querySelectorAll('.sloppy-prose')].pop() as unknown as {
			editor: Writing;
		};
		const { doc } = writing.editor.state;
		expect(doc.textContent).toBe('Something elseThe first thing');
		vi.useFakeTimers();
		writing.editor.commands.insertContentAt(doc.content.size - 2, ' and more');
		await vi.advanceTimersByTimeAsync(3000);
		flushSync();
		vi.useRealTimers();
		await settle();

		expect(stacks.get(TWO)?.map((one) => sectionLines(one.content)[0])).toEqual([
			'Something else',
			'The first thing and more'
		]);
	});

	it('says what a drop would do before the section is let go', async () => {
		await walk([ONE]);
		const handle = target.querySelector<HTMLButtonElement>(
			`[data-handle="${S1}"]`
		) as HTMLButtonElement;
		handle.dispatchEvent(pull('pointerdown', 10, 10));
		window.dispatchEvent(pull('pointermove', 0, 126));
		flushSync();

		expect(said()).toBe('Onto 2, at the end');
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		window.dispatchEvent(pull('pointerup', 0, 126));
		flushSync();
		await settle();
		expect(stacks.get(ONE)?.map((one) => one.ref)).toEqual([S1, S2]);
	});
});

// AI.md § "The Genealogy Is the Protocol": a note carried to another run takes
// the next address there, and the one it leaves keeps leading to it.
describe('carrying a note to another run', () => {
	const branch = [
		node(1, '1', { graph: THESIS }),
		node(2, '1a', { graph: THESIS, parent: ref(1), origin: ref(1) }),
		node(3, '2', { graph: THESIS })
	];

	const gripOf = (address: string) => labelled(address).querySelector('.address') as HTMLElement;

	it('asks the server to carry the focused note under the note above it', async () => {
		let asked: NoteDestination | null = null;
		moving(fake, ref(3), (to) => {
			asked = to;
			return [{ ...node(3, '1b', { graph: THESIS, parent: ref(1), origin: ref(1) }) }];
		});

		render({ notes: branch, fields: [{ ref: THESIS, title: 'Thesis' }] });
		const row = labelled('2');
		row.focus();
		row.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'ArrowRight',
				altKey: true,
				shiftKey: true,
				bubbles: true,
				cancelable: true
			})
		);
		flushSync();
		await settle();

		expect(asked).toEqual({ relation: 'under', note: ref(1) });
	});

	it('says why a note did not go, in the server’s own words', async () => {
		moving(
			fake,
			ref(3),
			() => new Response('{"message":"That note is not there any more."}', { status: 409 }) as never
		);

		render({ notes: branch, fields: [{ ref: THESIS, title: 'Thesis' }] });
		const row = labelled('2');
		row.focus();
		row.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'ArrowRight',
				altKey: true,
				shiftKey: true,
				bubbles: true,
				cancelable: true
			})
		);
		flushSync();
		await settle();

		expect(said()).toBe('That note is not there any more.');
	});

	// A refusal that outlived the act it described would teach the reader to read
	// past the next one.
	it('takes the refusal down again on its own', async () => {
		moving(
			fake,
			ref(3),
			() => new Response('{"message":"That note is not there any more."}', { status: 409 }) as never
		);

		vi.useFakeTimers();
		try {
			render({ notes: branch, fields: [{ ref: THESIS, title: 'Thesis' }] });
			const row = labelled('2');
			row.focus();
			row.dispatchEvent(
				new KeyboardEvent('keydown', {
					key: 'ArrowRight',
					altKey: true,
					shiftKey: true,
					bubbles: true,
					cancelable: true
				})
			);
			for (let turn = 0; turn < 4; turn += 1) {
				await vi.advanceTimersByTimeAsync(0);
				flushSync();
			}
			expect(said()).toBe('That note is not there any more.');

			await vi.advanceTimersByTimeAsync(6000);
			flushSync();
			expect(said()).toBe('');
		} finally {
			vi.useRealTimers();
		}
	});

	// A held region is one author's alone: nothing in it is the reader's to carry.
	it('offers no grip on a branch pulled from somebody else', async () => {
		const root = ref(20, OTHER);
		render({
			notes: [{ ...node(20, '3'), ref: root, created_by: OTHER, origin: root }],
			fields: undefined
		});
		await settle();

		expect(gripOf('3').className).not.toContain('cursor-grab');
	});

	it('offers it on the reader’s own', () => {
		render({ notes: branch, fields: [{ ref: THESIS, title: 'Thesis' }] });

		expect(gripOf('2').className).toContain('cursor-grab');
	});
});
