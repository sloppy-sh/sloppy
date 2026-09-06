import {
	homeGraphRef,
	type CreateBlockRequest,
	type CreateNodeRequest,
	type GraphView,
	type OwnedRef
} from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	AT,
	DID,
	node,
	ref,
	useFakeApi,
	VIEWER,
	type FakeApi
} from '../stores/fake-api.test-support.js';
import { graphs } from '../stores/graphs.svelte.js';
import { nodes } from '../stores/nodes.svelte.js';
import { prefs } from '../stores/prefs.svelte.js';
import { session } from '../stores/session.svelte.js';
import { at, back, pushed, replaced, startAt } from './page.test-support.svelte.js';
import { newHref, nodeHref } from './routes.js';

vi.mock('$app/state', () => ({
	page: {
		get url() {
			return new URL(at.path, 'http://app.test');
		},
		get state() {
			return {};
		}
	}
}));

vi.mock('$app/navigation', () => ({
	goto: (path: string, opts?: { replaceState?: boolean }) => {
		(opts?.replaceState ? replaced : pushed)(path, null);
		return Promise.resolve();
	}
}));

const New = (await import('./new.svelte')).default;

const HOME = homeGraphRef(VIEWER.did);
const GARDEN = ref(40);
const WRITTEN = ref(90);

function graph(self: OwnedRef, title: string): GraphView {
	return { ref: self, created_by: DID, created_at: AT, updated_at: AT, title };
}

let api: FakeApi;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
/** Every note the page asked the server to write, in order. */
let wrote: CreateNodeRequest[];
/** Every section it asked for, in order. */
let sections: CreateBlockRequest[];
/** How many more section writes the server refuses before it starts answering. */
let refusals: number;

async function settle(): Promise<void> {
	for (let turn = 0; turn < 8; turn += 1) {
		await new Promise((done) => setTimeout(done, 0));
		flushSync();
	}
}

async function arriveAt(href: string): Promise<void> {
	startAt(href);
	session.adopt(VIEWER, 'a-session');
	mounted = mount(New, { target });
	flushSync();
	await settle();
}

function button(labelled: string): HTMLButtonElement {
	const found = [...target.querySelectorAll('button')].find(
		(one) => one.textContent?.trim() === labelled
	);
	if (!found) throw new Error(`No "${labelled}" button on screen`);
	return found;
}

beforeEach(() => {
	api = useFakeApi();
	target = document.createElement('div');
	document.body.append(target);
	localStorage.clear();
	prefs.init();
	nodes.clear();
	graphs.clear();
	wrote = [];
	sections = [];
	refusals = 0;
	api.on('GET /graphs', () => [graph(HOME, 'My graph'), graph(GARDEN, 'Garden')]);
	api.on('POST /nodes', (_url, init) => {
		wrote.push(JSON.parse(String(init?.body)) as CreateNodeRequest);
		return node(90, '9');
	});
	api.on('POST /blocks', (_url, init) => {
		if (refusals > 0) {
			refusals -= 1;
			return new Response(JSON.stringify({ message: 'Try again in a moment.' }), {
				status: 503,
				headers: { 'content-type': 'application/json' }
			});
		}
		const request = JSON.parse(String(init?.body)) as CreateBlockRequest;
		sections.push(request);
		return {
			ref: ref(91),
			created_by: DID,
			created_at: AT,
			updated_at: AT,
			node: request.node,
			ord: 'a0',
			content: request.content
		};
	});
});

afterEach(() => {
	if (mounted) unmount(mounted);
	mounted = undefined;
	target.remove();
	session.clear();
});

// A thought that arrives outside Sloppy is put down without its author first
// finding the graph — PRODUCT.md § Purpose.
describe('putting a thought down from outside', () => {
	it('opens a branch in the graph the reader is in, and takes them to it', async () => {
		prefs.set('graph', GARDEN);

		await arriveAt(newHref());

		expect(wrote).toEqual([{ from: { relation: 'branch', graph: GARDEN } }]);
		expect(at.path).toBe(nodeHref(WRITTEN));
	});

	it('refuses rather than filing the thought in a graph the reader is not in', async () => {
		prefs.set('graph', GARDEN);
		api.on(
			'GET /graphs',
			() =>
				new Response(JSON.stringify({ message: 'Try again in a moment.' }), {
					status: 503,
					headers: { 'content-type': 'application/json' }
				})
		);

		await arriveAt(newHref({ text: 'Keep this' }));

		expect(wrote).toEqual([]);
		expect(target.textContent).toContain('Try again in a moment.');
		expect(at.path).toBe(newHref({ text: 'Keep this' }));
	});

	it('waits on no listing for a reader who has only ever had the one graph', async () => {
		api.on('GET /graphs', () => new Response('', { status: 503 }));

		await arriveAt(newHref({ text: 'Keep this' }));

		expect(wrote).toEqual([{ from: { relation: 'branch', graph: HOME } }]);
		expect(at.path).toBe(nodeHref(WRITTEN));
	});

	it('leaves nothing behind to come back to, so Back writes no second note', async () => {
		startAt('/');
		pushed(newHref({ text: 'Compost heats up' }), null);
		session.adopt(VIEWER, 'a-session');
		mounted = mount(New, { target });
		flushSync();
		await settle();
		expect(at.path).toBe(nodeHref(WRITTEN));

		back();

		expect(at.path).toBe('/');
		expect(wrote).toHaveLength(1);
	});

	it('asks nothing about the graphs when it is continuing a note, which is in one already', async () => {
		prefs.set('graph', GARDEN);

		await arriveAt(newHref({ under: ref(7) }));

		expect(api.calls).not.toContain('GET /graphs');
	});

	it('seeds the text somebody arrived with into the first section, a paragraph to a line', async () => {
		await arriveAt(newHref({ text: 'Compost heats up\n\nwhy?' }));

		expect(sections).toEqual([
			{
				node: WRITTEN,
				content: {
					type: 'doc',
					content: [
						{ type: 'paragraph', content: [{ type: 'text', text: 'Compost heats up' }] },
						{ type: 'paragraph', content: [{ type: 'text', text: 'why?' }] }
					]
				}
			}
		]);
	});

	it('writes no section for a thought that arrived with no words', async () => {
		await arriveAt(newHref({ text: '   ' }));

		expect(sections).toEqual([]);
		expect(at.path).toBe(nodeHref(WRITTEN));
	});

	it('continues the note it is given rather than opening a branch', async () => {
		const parent = ref(7);

		await arriveAt(newHref({ under: parent, text: 'And yet' }));

		expect(wrote).toEqual([{ from: { relation: 'under', note: parent } }]);
		expect(sections[0].node).toBe(WRITTEN);
	});

	it('opens a branch when it is handed a note nobody can continue', async () => {
		await arriveAt('/new?under=not-a-note');

		expect(wrote).toEqual([{ from: { relation: 'branch', graph: HOME } }]);
	});

	it('says a refusal in the server’s own words, and a second try writes no second note', async () => {
		refusals = 1;

		await arriveAt(newHref({ text: 'Keep this' }));
		expect(target.textContent).toContain('Try again in a moment.');
		expect(at.path).toBe(newHref({ text: 'Keep this' }));

		button('Try again').click();
		await settle();

		expect(wrote).toHaveLength(1);
		expect(sections).toHaveLength(1);
		expect(at.path).toBe(nodeHref(WRITTEN));
	});
});
