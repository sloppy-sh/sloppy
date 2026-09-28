// The dot a mark carries where the code has moved under the note — DESIGN.md
// § "An anchor into code".

import 'fake-indexeddb/auto';
import { MemoryFiles, MemoryHistory } from '@sloppy/local';
import type { BlockDocument, BlockView, NodeView, OwnedRef } from '@sloppy/types';
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

/** The notes the canvas is marking as the code having moved under, by
 *  address. */
const markedMoved = (): string[] =>
	[...document.body.querySelectorAll<HTMLElement>('[data-code-moved="yes"]')].map(
		(mark) => mark.textContent?.trim().split(/\s+/)[0] ?? ''
	);

let api: FakeApi;
let files: MemoryFiles;
/** The project this device is serving right now, which opening a folder
 *  changes the way the shell does. */
let serving: MemoryFiles | undefined;
let kept: MemoryHistory;
let store: Map<string, Uint8Array>;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

async function keepFile(at: string, said: string): Promise<void> {
	await files.write(at, new TextEncoder().encode(said));
	await kept.commit(`Wrote ${at}`);
}

/** The notes the graph holds, which something else may add to while the page
 *  stands on it. */
let held: NodeView[];
/** One note anchored at code, and one under it that is not. */
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
	api.on(`GET ${path(DECISION)}/blocks`, () => []);
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
	codeDrift.clear();
	store = new Map();
	files = new MemoryFiles({ root: PROJECT, store, data: '/data' });
	kept = new MemoryHistory(new MemoryFiles({ root: PROJECT, store, data: '/data' }), {
		author: 'Ada'
	});
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
