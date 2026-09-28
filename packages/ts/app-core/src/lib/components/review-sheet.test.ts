// The sheet that lists what the code left behind — DESIGN.md § "What the code
// left behind": one signal at a time, the act beside each note, and no count.

import 'fake-indexeddb/auto';
import { MemoryFiles, MemoryHistory } from '@sloppy/local';
import {
	type BlockDocument,
	type BlockView,
	compassNode,
	type CreateBlockRequest,
	DECISION_WHY_HEADING,
	type NodeView,
	type OwnedRef,
	type UpdateNodeRequest
} from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initRuntime } from '../runtime.js';
import { nodes } from '../stores/nodes.svelte.js';
import { review } from '../stores/review.svelte.js';
import { session } from '../stores/session.svelte.js';
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
import { digestOf } from '@sloppy/vault';
import ReviewSheet from './review-sheet.svelte';

const HOME = homeOf(DID);
const PROJECT = '/home/ada/garden';
const PARSER = ref(1);
const DECISION = ref(2);

function refPath(of: OwnedRef): string {
	const cut = of.lastIndexOf('/');
	return `/${encodeURIComponent(of.slice(0, cut))}/${encodeURIComponent(of.slice(cut + 1))}`;
}
const path = (of: OwnedRef) => `/nodes${refPath(of)}`;

let seeded = 200;
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

function anchored(of: OwnedRef, at: string): BlockView {
	return section(of, {
		type: 'doc',
		content: [
			{
				type: 'paragraph',
				content: [
					{ type: 'text', marks: [{ type: 'link', attrs: { href: `code:${at}` } }], text: at }
				]
			}
		]
	});
}

function stubViewport(width: number): void {
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: (query: string) => ({
			matches: /max-width:\s*(\d+)px/.test(query)
				? width <= Number(/max-width:\s*(\d+)px/.exec(query)?.[1])
				: false,
			addEventListener: () => {},
			removeEventListener: () => {}
		})
	});
}

async function settle(): Promise<void> {
	for (let turn = 0; turn < 20; turn += 1) {
		await new Promise((wake) => setTimeout(wake));
		flushSync();
	}
}

const screen = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

const named = (words: string): HTMLButtonElement | undefined =>
	[...document.body.querySelectorAll('button')].find((one) => one.textContent?.trim() === words);

let api: FakeApi;
let files: MemoryFiles;
let kept: MemoryHistory;
let store: Map<string, Uint8Array>;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let opened: OwnedRef[];
let justWrote: OwnedRef[];
let written: UpdateNodeRequest[];
let blocks: CreateBlockRequest[];

const said = (text: string) => new TextEncoder().encode(text);

async function keepFile(at: string, text: string): Promise<string> {
	await files.write(at, said(text));
	await kept.commit(`Wrote ${at}`);
	return (await kept.currentCommit()) as string;
}

/** The fixture graph: a note anchored at code that has moved since it was read,
 *  and a decision with three empty slots. */
async function askAbout(notes: NodeView[], stacks: Record<OwnedRef, BlockView[]>): Promise<void> {
	api.on('GET /nodes', () => notes.filter((one) => one.ref === one.origin));
	for (const [note, stack] of Object.entries(stacks)) {
		api.on(`GET ${path(note as OwnedRef)}/blocks`, () => stack);
	}
	await nodes.load({ graph: HOME });
	await review.ask(HOME, notes, files);
}

function show(): void {
	mounted = mount(ReviewSheet, {
		target,
		props: {
			open: true,
			onOpen: (note: OwnedRef) => opened.push(note),
			onWrote: (note: OwnedRef) => justWrote.push(note)
		}
	});
	flushSync();
}

beforeEach(async () => {
	nodes.clear();
	review.clear();
	opened = [];
	justWrote = [];
	written = [];
	blocks = [];
	store = new Map();
	files = new MemoryFiles({ root: PROJECT, store, data: '/data' });
	kept = new MemoryHistory(new MemoryFiles({ root: PROJECT, store, data: '/data' }), {
		author: 'Ada'
	});
	api = useFakeApi();
	session.adopt(VIEWER, 'a-session');
	initRuntime({
		apiHost: () => 'http://api.test',
		project: async () => files,
		history: () => kept
	});
	stubViewport(390);
	Element.prototype.hasPointerCapture = () => false;
	Element.prototype.setPointerCapture = () => {};
	Element.prototype.releasePointerCapture = () => {};
	Element.prototype.scrollIntoView = () => {};
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	review.clear();
	nodes.clear();
	session.clear();
	initRuntime({ apiHost: () => '', project: undefined, history: () => undefined });
	target.remove();
	document.body.innerHTML = '';
});

describe('a project with something left behind', () => {
	beforeEach(async () => {
		const at = await keepFile('src/parser.ts', 'export const one = 1;\n');
		await keepFile('docs/guide.md', '# Guide\n');
		await keepFile('src/parser.ts', 'export const one = 2;\n');
		const notes = [
			node(1, '1', { title: 'The parser', checked: at }),
			node(2, '1a', { title: 'Two ways round it', origin: PARSER, parent: PARSER })
		];
		api.on(`PATCH ${path(PARSER)}`, (_url, init) => {
			const request = JSON.parse(String(init?.body)) as UpdateNodeRequest;
			written.push(request);
			return { ...notes[0], ...request };
		});
		await askAbout(notes, {
			[PARSER]: [anchored(PARSER, 'src/parser.ts')],
			[DECISION]: [
				section(DECISION, {
					type: 'doc',
					content: [compassNode({ north: [PARSER], south: [], east: [], west: [] })]
				})
			]
		});
	});

	it('offers each question once and asks the first of them', async () => {
		show();
		await settle();

		expect(screen()).toContain('What the code left behind');
		expect(named('The code moved')?.getAttribute('aria-pressed')).toBe('true');
		expect(named('Nothing written here')).toBeDefined();
		expect(named('An empty slot')).toBeDefined();
		// Nothing of a kind nothing was found of.
		expect(named('No why written')).toBeUndefined();
		// No count, no badge, no score.
		expect(screen()).not.toMatch(/\b\d+\s*(left|to fix|behind)\b/);
	});

	it('lists the note the code moved under, by its own number and title', async () => {
		show();
		await settle();

		expect(screen()).toContain('1 The parser');
		expect(screen()).toContain('src/parser.ts');
		expect(named('Still true')).toBeDefined();
		const shown = [...document.body.querySelectorAll('span')].find(
			(span) => span.textContent === '1'
		);
		expect(shown?.classList.contains('address')).toBe(true);
	});

	it('records the reading and takes the row away', async () => {
		show();
		await settle();

		named('Still true')?.click();
		await settle();

		expect(written).toEqual([
			{
				read_against: [
					{ path: 'src/parser.ts', digest: await digestOf(said('export const one = 2;\n')) }
				],
				checked: await kept.currentCommit()
			}
		]);
		expect(named('Still true')).toBeUndefined();
	});

	it('shows another question’s notes when that one is chosen', async () => {
		show();
		await settle();

		named('An empty slot')?.click();
		await settle();

		expect(review.chosen).toBe('compass-gap');
		expect(screen()).toContain('What is this made of?');
		expect(screen()).toContain('What was chosen instead?');
		expect(named('Still true')).toBeUndefined();
	});

	it('opens the note a slot belongs to, and puts the sheet away', async () => {
		show();
		await settle();
		named('An empty slot')?.click();
		await settle();

		named('What is this made of?')?.click();
		await settle();

		expect(opened).toEqual([DECISION]);
		expect(screen()).not.toContain('What the code left behind');
	});

	it('starts a note about code nothing has been written about', async () => {
		const fresh = node(7, '1b', { title: 'docs' });
		api.on('POST /nodes', () => fresh);
		api.on('POST /blocks', (_url, init) => {
			const request = JSON.parse(String(init?.body)) as CreateBlockRequest;
			blocks.push(request);
			return section(fresh.ref, (request.content ?? { type: 'doc', content: [] }) as BlockDocument);
		});
		show();
		await settle();

		named('Nothing written here')?.click();
		await settle();
		expect(screen()).toContain('docs');

		named('Write a note')?.click();
		await settle();

		expect(JSON.stringify(blocks[0]?.content)).toContain('code:docs');
		expect(justWrote).toEqual([fresh.ref]);
		expect(opened).toEqual([]);
	});
});

describe('a project with all four questions to ask', () => {
	it('wraps the questions rather than putting one past the edge', async () => {
		const at = await keepFile('src/parser.ts', 'export const one = 1;\n');
		await keepFile('docs/guide.md', '# Guide\n');
		await keepFile('src/parser.ts', 'export const one = 2;\n');
		const notes = [
			node(1, '1', { title: 'The parser', checked: at }),
			node(2, '1a', { title: 'Two ways round it', origin: PARSER, parent: PARSER })
		];
		await askAbout(notes, {
			[PARSER]: [anchored(PARSER, 'src/parser.ts')],
			[DECISION]: [
				section(DECISION, {
					type: 'doc',
					content: [compassNode({ north: [PARSER], south: [], east: [], west: [] })]
				}),
				section(DECISION, {
					type: 'doc',
					content: [
						{
							type: 'heading',
							attrs: { level: 2 },
							content: [{ type: 'text', text: DECISION_WHY_HEADING }]
						},
						{ type: 'paragraph' }
					]
				})
			]
		});
		show();
		await settle();

		const row = document.body.querySelector('[aria-label="What to look at"]') as HTMLElement;
		expect([...row.querySelectorAll('button')].map((one) => one.textContent?.trim())).toEqual([
			'The code moved',
			'Nothing written here',
			'An empty slot',
			'No why written'
		]);
		expect(row.className).toContain('flex-wrap');
		expect(row.className).not.toMatch(/overflow-x-(auto|scroll)/);
	});
});

describe('a project somebody is keeping up with', () => {
	it('says so in one line and offers nothing to do', async () => {
		await keepFile('src/parser.ts', 'export const one = 1;\n');
		const notes = [node(1, '1', { title: 'The parser' })];
		await askAbout(notes, { [PARSER]: [anchored(PARSER, 'src/parser.ts')] });
		show();
		await settle();

		expect(screen()).toContain('Nothing the code has left behind.');
		expect(screen()).not.toContain('Choose one to see it on the graph.');
		expect(named('Still true')).toBeUndefined();
		expect(named('Write a note')).toBeUndefined();
	});
});
