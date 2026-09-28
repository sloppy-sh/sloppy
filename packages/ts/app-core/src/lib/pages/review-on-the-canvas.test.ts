// Asking the graph what the code left behind, and the canvas answering —
// DESIGN.md § "What the code left behind".

import 'fake-indexeddb/auto';
import { MemoryFiles, MemoryHistory } from '@sloppy/local';
import {
	type BlockDocument,
	type BlockView,
	compassNode,
	DECISION_WHY_HEADING,
	type NodeView,
	type OwnedRef
} from '@sloppy/types';
import { digestOf } from '@sloppy/vault';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initRuntime } from '../runtime.js';
import { canvasInk } from '../stores/canvas-ink.svelte.js';
import { codeDrift } from '../stores/code-drift.svelte.js';
import { find } from '../stores/find.svelte.js';
import { graphs } from '../stores/graphs.svelte.js';
import { nodes } from '../stores/nodes.svelte.js';
import { outlineSections } from '../stores/outline-sections.svelte.js';
import { peers } from '../stores/peers.svelte.js';
import { publications } from '../stores/publications.svelte.js';
import { review } from '../stores/review.svelte.js';
import { session } from '../stores/session.svelte.js';
import { tags } from '../stores/tags.svelte.js';
import {
	AT,
	DID,
	homeOf,
	node,
	ref,
	useFakeApi,
	VIEWER,
	type FakeApi
} from '../stores/fake-api.test-support.js';
import { at, pushed, replaced, startAt } from './page.test-support.svelte.js';

vi.mock('$app/state', () => ({
	page: {
		get url() {
			return new URL(at.path, 'http://app.test');
		},
		get state() {
			if (!at.note) return {};
			return { note: at.note, notes: at.notes, ...(at.landing ? { at: at.landing } : {}) };
		}
	}
}));

vi.mock('$app/navigation', () => ({
	pushState: (path: string, state: App.PageState) =>
		pushed(path, state.note ?? null, [...(state.notes ?? [])], state.at ?? null),
	replaceState: (path: string, state: App.PageState) =>
		replaced(path, state.note ?? null, [...(state.notes ?? [])], state.at ?? null),
	afterNavigate: () => {}
}));

vi.mock('@sloppy/ui', async (original) => ({
	...((await original()) as object),
	GraphSurface: (await import('./graph-surface.test-support.svelte')).default
}));

const Graph = (await import('./graph.svelte')).default;

const HOME = homeOf(DID);
const PROJECT = '/home/ada/garden';
const PARSER = ref(1);
const DECISION = ref(2);

function segments(of: OwnedRef): string {
	const cut = of.lastIndexOf('/');
	return `${encodeURIComponent(of.slice(0, cut))}/${encodeURIComponent(of.slice(cut + 1))}`;
}
const path = (of: OwnedRef) => `/nodes/${segments(of)}`;

let seeded = 300;
function section(of: OwnedRef, content: BlockDocument): BlockView {
	seeded += 1;
	return {
		ref: ref(seeded),
		node: of,
		created_by: DID,
		created_at: AT,
		updated_at: AT,
		ord: 'a0',
		content
	} as unknown as BlockView;
}

function stubViewport(): void {
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
}

async function settle(): Promise<void> {
	for (let turn = 0; turn < 10; turn += 1) {
		await new Promise((done) => setTimeout(done, 0));
		flushSync();
	}
	for (let frame = 0; frame < 3; frame += 1) await new Promise(requestAnimationFrame);
	flushSync();
}

const screen = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

function labelled(label: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('button')].find(
		(one) => one.getAttribute('aria-label') === label
	);
	if (!found) throw new Error(`Nothing on screen is labelled "${label}"`);
	return found as HTMLButtonElement;
}

function named(words: string): HTMLButtonElement | undefined {
	return [...document.body.querySelectorAll('button')].find(
		(one) => one.textContent?.trim() === words
	);
}

const offered = (): string[] =>
	[...document.body.querySelectorAll('[role="menuitem"]')].map(
		(row) => row.textContent?.trim() ?? ''
	);

function menuItem(label: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
		(row) => row.textContent?.trim() === label
	);
	if (!found) throw new Error(`The menu does not offer "${label}"`);
	return found;
}

/** The notes the canvas is marking as the code having moved under, by
 *  address. */
const markedMoved = (): string[] =>
	[...document.body.querySelectorAll<HTMLElement>('[data-code-moved="yes"]')].map(
		(mark) => mark.textContent?.trim().split(/\s+/)[0] ?? ''
	);

/** Whether each drawn note is held in ink or dimmed, by its address. */
function litOnCanvas(): Record<string, string | undefined> {
	const marks = [...document.body.querySelectorAll<HTMLElement>('[data-lit]')];
	const held: Record<string, string | undefined> = {};
	for (const mark of marks) {
		const address = mark.textContent?.trim().split(/\s+/)[0] ?? '';
		held[address] = mark.dataset.lit;
	}
	return held;
}

let api: FakeApi;
let files: MemoryFiles;
/** The project this device is serving right now, which opening a folder
 *  changes the way the shell does. */
let serving: MemoryFiles | undefined;
let kept: MemoryHistory;
let store: Map<string, Uint8Array>;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
/** The sections the reading surface has brought into view, in order. */
let brought: string[];

async function keepFile(at: string, said: string): Promise<void> {
	await files.write(at, new TextEncoder().encode(said));
	await kept.commit(`Wrote ${at}`);
}

/** The notes the graph holds, which something else may add to while the page
 *  stands on it. */
let held: NodeView[];
/** The decision's two sections, which the acts about it land on. */
let compassCard: BlockView;
let whySection: BlockView;

/** Two notes: one anchored at code, one holding a compass with empty slots. */
function installGraph(): void {
	held = [
		node(1, '1', { title: 'The parser' }),
		node(2, '1a', { title: 'Two ways round it', origin: PARSER, parent: PARSER })
	];
	api.on('GET /nodes/tags', () => []);
	api.on('GET /nodes', (url) => {
		const origin = url.searchParams.get('origin');
		return held.filter((one) => (origin ? one.origin === origin : one.ref === one.origin));
	});
	api.on('GET /publications', () => []);
	for (const one of held) api.on(`GET ${path(one.ref)}`, () => one);
	api.on(`GET ${path(PARSER)}/blocks`, () => [
		section(PARSER, {
			type: 'doc',
			content: [
				{
					type: 'paragraph',
					content: [
						{
							type: 'text',
							marks: [{ type: 'link', attrs: { href: 'code:src/parser.ts' } }],
							text: 'src/parser.ts'
						}
					]
				}
			]
		})
	]);
	// A decision: its compass card, and the Why nobody has written yet.
	compassCard = section(DECISION, {
		type: 'doc',
		content: [compassNode({ north: [PARSER], south: [], east: [], west: [] })]
	});
	whySection = section(DECISION, {
		type: 'doc',
		content: [
			{
				type: 'heading',
				attrs: { level: 2 },
				content: [{ type: 'text', text: DECISION_WHY_HEADING }]
			},
			{ type: 'paragraph' }
		]
	});
	api.on(`GET ${path(DECISION)}/blocks`, () => [compassCard, whySection]);
}

async function open(): Promise<void> {
	if (mounted) unmount(mounted, { outro: false });
	session.adopt(VIEWER, 'a-session');
	mounted = mount(Graph, { target });
	flushSync();
	await settle();
}

beforeEach(async () => {
	startAt('/');
	stubViewport();
	nodes.clear();
	outlineSections.clear();
	peers.clear();
	tags.clear();
	publications.clear();
	find.clear();
	graphs.clear();
	review.clear();
	codeDrift.clear();
	store = new Map();
	files = new MemoryFiles({ root: PROJECT, store, data: '/data' });
	kept = new MemoryHistory(new MemoryFiles({ root: PROJECT, store, data: '/data' }), {
		author: 'Ada'
	});
	brought = [];
	Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
		const section = this.getAttribute('data-block-ref');
		if (section) brought.push(section);
	};
	api = useFakeApi();
	installGraph();
	canvasInk.rubOut(HOME);
	await keepFile('src/parser.ts', 'export const one = 1;\n');
	await keepFile('docs/guide.md', '# Guide\n');
	serving = files;
	initRuntime({
		apiHost: () => 'http://api.test',
		project: async () => serving,
		history: () => kept
	});
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	review.clear();
	codeDrift.clear();
	session.clear();
	initRuntime({
		apiHost: () => '',
		project: undefined,
		history: () => undefined,
		vault: undefined
	});
	target.remove();
	document.body.innerHTML = '';
});

// The one thing a mark says on its own — DESIGN.md § "What the code left
// behind". Nobody has to ask for this one.
describe('the mark a note carries where the code has moved', () => {
	async function readAgainst(said: string): Promise<void> {
		held[0] = {
			...held[0],
			read_against: [
				{ path: 'src/parser.ts', digest: await digestOf(new TextEncoder().encode(said)) }
			]
		};
	}

	it('marks the note whose file says something else now, without anybody asking', async () => {
		await readAgainst('export const one = 1;\n');
		await keepFile('src/parser.ts', 'export const one = 2;\n');

		await open();

		expect(markedMoved()).toEqual(['1']);
		expect(screen()).not.toContain('What the code left behind');
	});

	it('marks nothing where the file still says what it said', async () => {
		await readAgainst('export const one = 1;\n');

		await open();

		expect(markedMoved()).toEqual([]);
	});

	// Unread is not stale.
	it('marks nothing on a note nobody has read against the code', async () => {
		await keepFile('src/parser.ts', 'export const one = 2;\n');

		await open();

		expect(markedMoved()).toEqual([]);
	});

	it('works nothing out where the graph is nobody’s project', async () => {
		await readAgainst('export const one = 1;\n');
		await keepFile('src/parser.ts', 'export const one = 2;\n');
		serving = undefined;

		await open();

		expect(markedMoved()).toEqual([]);
	});
});

describe('asking what the code left behind', () => {
	it('is offered on a graph that is a project, and nowhere else', async () => {
		await open();
		labelled('More').click();
		await settle();
		expect(offered()).toContain('What the code left behind');

		initRuntime({ apiHost: () => 'http://api.test', project: undefined });
		await open();
		labelled('More').click();
		await settle();

		expect(offered()).not.toContain('What the code left behind');
	});

	it('holds the notes a chosen signal names in ink and dims the rest', async () => {
		await open();
		labelled('More').click();
		await settle();

		menuItem('What the code left behind').click();
		await settle();
		expect(screen()).toContain('What the code left behind');

		named('An empty slot')?.click();
		await settle();

		expect(litOnCanvas()).toEqual({ '1': 'no', '1a': 'yes' });
	});

	// A field missing notes is a field missing the anchors that say the code was
	// written about, so there is no answer to offer about it.
	it('is not offered about a field that could not be read whole', async () => {
		const held: NodeView[] = [node(1, '1', { title: 'The parser' })];
		api.on('GET /nodes', (url) => {
			const origin = url.searchParams.get('origin');
			if (origin && !url.searchParams.get('max_depth')) {
				return new Response('{"message":"That branch could not be read."}', { status: 500 });
			}
			return held.filter((one) => (origin ? one.origin === origin : one.ref === one.origin));
		});

		await open();
		labelled('More').click();
		await settle();

		expect(screen()).toContain('Some notes could not be read');
		expect(offered()).not.toContain('What the code left behind');
	});

	it('leaves the canvas alone until one is chosen', async () => {
		await open();

		expect(litOnCanvas()).toEqual({ '1': undefined, '1a': undefined });
	});
});

// An act lands on the thing it named — DESIGN.md § "What the code left behind" —
// rather than at the top of a note somebody then hunts through.
describe('an act that opens a note', () => {
	async function ask(question: string): Promise<void> {
		await open();
		labelled('More').click();
		await settle();
		menuItem('What the code left behind').click();
		await settle();
		named(question)?.click();
		await settle();
	}

	it('opens the note at its compass card for an empty slot', async () => {
		await ask('An empty slot');

		named('What is this made of?')?.click();
		await settle();

		expect(screen()).toContain('Two ways round it');
		expect(brought).toContain(compassCard.ref);
	});

	it('opens the note with its Why in view for a decision with none written', async () => {
		await ask('No why written');

		named('Say why')?.click();
		await settle();

		expect(screen()).toContain('Two ways round it');
		expect(brought).toContain(whySection.ref);
	});
});

// A folder is opened while the page stands, so what the question is about is
// asked again for it rather than left over from the folder that was.
describe('another folder in front of somebody', () => {
	/** A shell whose folders can be opened, where opening a project serves one
	 *  and starting a folder serves none. */
	let root = PROJECT;

	function keepsFolders(): void {
		root = serving === undefined ? '/home/ada/notes' : PROJECT;
		initRuntime({
			apiHost: () => 'http://api.test',
			project: async () => serving,
			history: () => kept,
			vault: {
				folder: () => root,
				graph: async () => HOME,
				open: async () => PROJECT,
				asks: true,
				known: async () => [],
				openKnown: async () => {},
				forget: async () => {},
				start: async () => {
					serving = undefined;
					root = '/home/ada/notes';
					return root;
				},
				openProject: async () => {
					serving = files;
					root = PROJECT;
					return root;
				}
			}
		});
	}

	async function choose(words: string): Promise<void> {
		labelled('Your graphs').click();
		await settle();
		const button = named(words);
		if (!button) throw new Error(`Nothing on screen says "${words}"`);
		button.click();
		await settle();
	}

	async function moreOffers(): Promise<string[]> {
		labelled('More').click();
		await settle();
		const offers = offered();
		document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await settle();
		return offers;
	}

	it('offers the question once a project is the folder being served', async () => {
		serving = undefined;
		keepsFolders();
		await open();
		expect(await moreOffers()).not.toContain('What the code left behind');

		await choose('Choose a project');

		expect(await moreOffers()).toContain('What the code left behind');
	});

	it('takes the question away with the project it was about', async () => {
		serving = files;
		keepsFolders();
		await open();
		expect(await moreOffers()).toContain('What the code left behind');

		await choose('Choose a folder');

		expect(await moreOffers()).not.toContain('What the code left behind');
	});

	// The terminal writes into the same folder while the app stands on it, and
	// nothing tells the app when.
	it('asks about a note that arrived in the folder while the page stood', async () => {
		serving = files;
		keepsFolders();
		await open();
		expect(litOnCanvas()).toEqual({ '1': undefined, '1a': undefined });

		const arrived = ref(3);
		held.push(node(3, '1b', { title: 'The lexer' }));
		api.on(`GET ${path(arrived)}`, () => held[2]);
		api.on(`GET ${path(arrived)}/blocks`, () => [
			section(arrived, {
				type: 'doc',
				content: [compassNode({ north: [], south: [], east: [], west: [] })]
			})
		]);

		labelled('More').click();
		await settle();
		menuItem('What the code left behind').click();
		await settle();
		named('An empty slot')?.click();
		await settle();

		expect(screen()).toContain('1b The lexer');
	});

	it('closes an answer that was about the folder that was', async () => {
		serving = files;
		keepsFolders();
		await open();
		labelled('More').click();
		await settle();
		menuItem('What the code left behind').click();
		await settle();
		expect(screen()).toContain('Choose one to see it on the graph.');

		await choose('Choose a folder');

		expect(screen()).not.toContain('Choose one to see it on the graph.');
	});
});
