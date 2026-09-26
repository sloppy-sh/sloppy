// Asking for a project's notes from the graph, and reading what comes back —
// docs/ARCHITECTURE.md § "Writing the notes in four steps". Nothing here
// starts a tool: the seam is a stand-in.

import 'fake-indexeddb/auto';
import { MemoryFiles } from '@sloppy/local';
import type {
	BlockDocument,
	BlockView,
	DocumentingPlan,
	DocumentingProgress,
	DocumentingTool,
	NodeView,
	OwnedRef,
	ProposedPlace
} from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initRuntime, type DocumentingAccess } from '../runtime.js';
import { seamSettledAgain } from '../seam.svelte.js';
import { canvasInk } from '../stores/canvas-ink.svelte.js';
import { documenting } from '../stores/documenting.svelte.js';
import { find } from '../stores/find.svelte.js';
import { graphs } from '../stores/graphs.svelte.js';
import { nodes } from '../stores/nodes.svelte.js';
import { offers } from '../stores/offers.svelte.js';
import { outlineSections } from '../stores/outline-sections.svelte.js';
import { peers } from '../stores/peers.svelte.js';
import { publications } from '../stores/publications.svelte.js';
import { session } from '../stores/session.svelte.js';
import { tags } from '../stores/tags.svelte.js';
import {
	AT,
	amending,
	amendment,
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
const SOMEBODY = 'did:syr:z6MkrAnotherPersonWritingHereAAAAAAAAAAAAAAAA';

function segments(of: OwnedRef): string {
	const cut = of.lastIndexOf('/');
	return `${encodeURIComponent(of.slice(0, cut))}/${encodeURIComponent(of.slice(cut + 1))}`;
}
const path = (of: OwnedRef) => `/nodes/${segments(of)}`;

let seeded = 400;
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

class Stub implements DocumentingAccess {
	readonly plans: DocumentingPlan[] = [];
	tool: readonly DocumentingTool[] = ['claude_code'];
	proposes: ProposedPlace[] = [{ path: 'src/parser.ts', reason: 'The whole of the reading' }];
	reports: DocumentingProgress[] = [{ stage: 'done', places: [] }];

	tools(): Promise<DocumentingTool[]> {
		return Promise.resolve([...this.tool]);
	}

	survey(): Promise<ProposedPlace[]> {
		return Promise.resolve(this.proposes);
	}

	run(
		plan: DocumentingPlan,
		watch: (progress: DocumentingProgress) => void
	): Promise<DocumentingProgress> {
		this.plans.push(plan);
		for (const progress of this.reports) watch(progress);
		return Promise.resolve(this.reports[this.reports.length - 1]);
	}

	stop(): Promise<void> {
		return Promise.resolve();
	}
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

const offeredInMenu = (): string[] =>
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

let api: FakeApi;
let files: MemoryFiles;
let serving: MemoryFiles | undefined;
let stub: Stub;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let held: NodeView[];

function installGraph(): void {
	held = [node(1, '1', { title: 'The parser' })];
	api.on('GET /nodes/tags', () => []);
	api.on('GET /nodes', (url) => {
		const origin = url.searchParams.get('origin');
		return held.filter((one) => (origin ? one.origin === origin : one.ref === one.origin));
	});
	api.on('GET /publications', () => []);
	for (const one of held) api.on(`GET ${path(one.ref)}`, () => one);
	api.on(`GET ${path(PARSER)}/blocks`, () => [
		section(PARSER, { type: 'doc', content: [{ type: 'paragraph' }] })
	]);
	amending(
		api,
		{
			[PARSER]: [
				amendment(500, PARSER, SOMEBODY, {
					title: 'The parser',
					message: 'What the reading does, section by section'
				})
			]
		},
		() => held[0]
	);
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
	documenting.clear();
	offers.clear();
	files = new MemoryFiles({ root: PROJECT, store: new Map(), data: '/data' });
	await files.write('src/parser.ts', new TextEncoder().encode('export const one = 1;\n'));
	Element.prototype.scrollIntoView = () => {};
	api = useFakeApi();
	installGraph();
	canvasInk.rubOut(HOME);
	serving = files;
	stub = new Stub();
	initRuntime({
		apiHost: () => 'http://api.test',
		project: async () => serving,
		documenting: stub
	});
	seamSettledAgain();
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	documenting.clear();
	offers.clear();
	session.clear();
	initRuntime({ apiHost: () => '', project: undefined, documenting: undefined });
	seamSettledAgain();
	target.remove();
	document.body.innerHTML = '';
});

describe('where the offer to write the notes stands', () => {
	it('is on a graph that is a project, beside what the code left behind', async () => {
		await open();
		labelled('More').click();
		await settle();

		expect(offeredInMenu()).toContain('Write notes about the code');
	});

	it('is nowhere on a graph that is nobody\u2019s project', async () => {
		serving = undefined;
		await open();
		labelled('More').click();
		await settle();

		expect(offeredInMenu()).not.toContain('Write notes about the code');
	});

	it('is nowhere on a device that cannot reach a tool at all', async () => {
		initRuntime({
			apiHost: () => 'http://api.test',
			project: async () => serving,
			documenting: undefined
		});
		seamSettledAgain();
		await open();
		labelled('More').click();
		await settle();

		expect(offeredInMenu()).not.toContain('Write notes about the code');
	});
});

describe('the whole of the asking', () => {
	async function ask(): Promise<void> {
		await open();
		labelled('More').click();
		await settle();
		menuItem('Write notes about the code').click();
		await settle();
		named('Look over the code')?.click();
		await settle();
	}

	it('shows what was proposed and writes nothing until it is settled', async () => {
		await ask();

		expect(screen()).toContain('The whole of the reading');
		expect(stub.plans).toHaveLength(0);
	});

	it('reads what came back as an offered change on the note', async () => {
		stub.reports = [
			{
				stage: 'done',
				places: [{ path: 'src/parser.ts', note: { ref: PARSER, done: 'offered' } }]
			}
		];
		await ask();
		named('Write these notes')?.click();
		await settle();

		const row = [...document.body.querySelectorAll('button')].find((one) =>
			one.textContent?.includes('A change is offered on it')
		);
		expect(row).toBeDefined();
		row?.click();
		await settle();

		expect(screen()).toContain('Offered changes');
		expect(screen()).toContain('What the reading does, section by section');

		const offer = [...document.body.querySelectorAll('button')].find((one) =>
			one.textContent?.includes('What the reading does, section by section')
		);
		offer?.click();
		await settle();

		expect(screen()).toContain('Take it in');
		expect(screen()).toContain('Turn it down');
	});
});
