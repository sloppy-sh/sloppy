import 'fake-indexeddb/auto';
import type { GraphView, NodeView, OwnedRef } from '@sloppy/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api } from './api.js';
import { carries, movedFrom, reachEveryGraph } from './note-find.js';
import {
	AT,
	DID,
	finding,
	hit,
	node,
	ref,
	useFakeApi,
	VIEWER,
	type FakeApi
} from './stores/fake-api.test-support.js';
import { graphs } from './stores/graphs.svelte.js';
import { prefs } from './stores/prefs.svelte.js';
import { nodes } from './stores/nodes.svelte.js';
import { session } from './stores/session.svelte.js';

const GARDEN = ref(20);
const COMPANY = ref(21);

function graph(self: OwnedRef, title: string): GraphView {
	return { ref: self, created_by: DID, created_at: AT, updated_at: AT, title };
}

const KEPT: GraphView[] = [graph(GARDEN, 'Garden'), graph(COMPANY, 'Company')];

const SEED = node(1, '1', { graph: GARDEN, title: 'A seed of a thought' });
const UNDER = node(2, '1a', {
	graph: GARDEN,
	title: 'Mushrooms',
	origin: SEED.ref,
	parent: SEED.ref
});
const ELSEWHERE = node(3, '1', { graph: COMPANY, title: 'A quarter' });
const CARRIED = node(4, '2c', {
	graph: GARDEN,
	title: 'Spores',
	aliases: ['1c'],
	origin: SEED.ref
});

/** The graph a listing of branches is being asked for. */
function asked(url: URL): string | null {
	return url.searchParams.get('graph');
}

let fake: FakeApi;

beforeEach(async () => {
	localStorage.clear();
	prefs.init();
	graphs.clear();
	nodes.clear();
	fake = useFakeApi();
	fake.on('GET /auth/me', () => VIEWER);
	fake.on('GET /graphs', () => KEPT);
	await session.refresh();
});

afterEach(() => {
	localStorage.clear();
	session.clear();
	graphs.clear();
	nodes.clear();
});

describe('what a person types to reach a note', () => {
	it('reaches it by the address they cite', () => {
		expect(carries(UNDER, '1a')).toBe(true);
		expect(carries(UNDER, '1b')).toBe(false);
	});

	it('reaches it by words in the title, wherever they sit in it', () => {
		expect(carries(SEED, 'thought')).toBe(true);
		expect(carries(SEED, 'nothing here')).toBe(false);
	});

	it('is not fooled by how the title was capitalised', () => {
		expect(carries(UNDER, 'mushroom')).toBe(true);
	});

	it('reaches it by an address it has been carried away from', () => {
		expect(carries(CARRIED, '1c')).toBe(true);
		expect(carries(CARRIED, '2c')).toBe(true);
		expect(carries(CARRIED, '1d')).toBe(false);
	});

	it('says which old address was cited, and stays quiet about the one it is at', () => {
		expect(movedFrom(CARRIED, '1c')).toBe('1c');
		expect(movedFrom(CARRIED, '2c')).toBeUndefined();
		expect(movedFrom(CARRIED, 'spores')).toBeUndefined();
		expect(movedFrom(UNDER, '1a')).toBeUndefined();
	});
});

describe('reaching every graph before a match is made', () => {
	function serving(trees: Record<string, NodeView[]>): void {
		fake.on('GET /nodes', (url) => {
			const graph = asked(url);
			if (graph) return trees[graph]?.filter((one) => one.depth === 1) ?? [];
			const origin = url.searchParams.get('origin');
			return Object.values(trees)
				.flat()
				.filter((one) => one.origin === origin);
		});
	}

	it('holds every graph the person keeps, and says so', async () => {
		serving({ [GARDEN]: [SEED, UNDER], [COMPANY]: [ELSEWHERE] });

		expect(await reachEveryGraph()).toBe('whole');
		expect(nodes.get(UNDER.ref)).toBeDefined();
		expect(nodes.get(ELSEWHERE.ref)).toBeDefined();
	});

	it('keeps the graphs that answered when one of them will not', async () => {
		fake.on('GET /nodes', (url) => {
			const graph = asked(url);
			if (graph === COMPANY) {
				return new Response('{"message":"Sloppy could not read that."}', { status: 500 });
			}
			return graph ? [SEED] : [SEED, UNDER];
		});

		expect(await reachEveryGraph()).toBe('short');
		expect(nodes.get(UNDER.ref)).toBeDefined();
	});

	it('is short when the graphs themselves will not read', async () => {
		graphs.clear();
		fake.on('GET /graphs', () => new Response('{"message":"Not now."}', { status: 500 }));

		expect(await reachEveryGraph()).toBe('short');
	});
});

describe('the stand-in server for a find surface', () => {
	it('answers what carries a word, and what was written into last', async () => {
		finding(fake, { hits: [hit(UNDER, { snippet: 'seeds and mushrooms' })], recent: [SEED] });

		expect(await api.searchNotes('mushroom')).toEqual([
			{
				note: UNDER.ref,
				address: '1a',
				graph: GARDEN,
				title: 'Mushrooms',
				snippet: 'seeds and mushrooms',
				held: false
			}
		]);
		expect((await api.recentNotes({ limit: 5 })).map((one) => one.ref)).toEqual([SEED.ref]);
	});
});
