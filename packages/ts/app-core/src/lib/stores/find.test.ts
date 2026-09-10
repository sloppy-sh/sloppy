import { graphOf, type NodeView, type SearchHit } from '@sloppy/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { find } from './find.svelte.js';
import { hit, node, ref, useFakeApi, VIEWER, type FakeApi } from './fake-api.test-support.js';
import { graphs } from './graphs.svelte.js';
import { nodes } from './nodes.svelte.js';
import { session } from './session.svelte.js';

const ROOT = node(1, '1', { title: 'Origins' });
const UNDER = node(2, '1a', { title: 'Cells divide', origin: ROOT.ref, parent: ROOT.ref });
const DEEPER = node(3, '1a3', { title: 'Mushrooms', origin: ROOT.ref, parent: UNDER.ref });
const OTHER = node(4, '2', { title: 'Method', aliases: ['1b'] });

const GRAPH = graphOf(ROOT);
const ELSEWHERE = ref(90);

let api: FakeApi;
let hits: SearchHit[];

/** Past the pause the writing inside notes is asked for after. */
async function pause(): Promise<void> {
	await new Promise((done) => setTimeout(done, 260));
}

const addresses = (): (string | undefined)[] => find.found.map((row) => row.address);

beforeEach(async () => {
	nodes.clear();
	find.clear();
	api = useFakeApi();
	hits = [];
	api.on('GET /auth/me', () => VIEWER);
	api.on('GET /nodes', (url) => {
		const origin = url.searchParams.get('origin');
		const all: NodeView[] = [ROOT, UNDER, DEEPER, OTHER];
		return origin
			? all.filter((one) => one.origin === origin)
			: all.filter((one) => one.ref === one.origin);
	});
	api.on('GET /nodes/search', () => hits);
	await session.refresh();
	// Which graph the reader is in is the listing's to say, so it is read before
	// anything is asked about that graph.
	await graphs.load();
	await nodes.load({ graph: GRAPH });
	await nodes.load({ origin: ROOT.ref });
});

afterEach(() => {
	find.clear();
	nodes.clear();
	graphs.clear();
	session.clear();
});

describe('finding a note from the graph', () => {
	it('reaches what is already in hand by address, before anything is asked for', () => {
		find.type('1a');

		expect(addresses()).toEqual(['1a', '1a3']);
		expect(api.countOf('GET /nodes/search')).toBe(0);
	});

	it('reaches it by title too, however it was typed', () => {
		find.type('CELLS');

		expect(addresses()).toEqual(['1a']);
	});

	it('says nothing has been reached until the words are answered for', async () => {
		find.type('mushroom');
		expect(find.looking).toBe(true);
		expect(find.settled).toBe(false);

		await pause();

		expect(find.looking).toBe(false);
		expect(find.settled).toBe(true);
	});

	it('brings the writing inside notes in once the typing stops', async () => {
		hits = [hit(OTHER, { snippet: 'the mushrooms under the bench' })];
		find.type('bench');
		expect(find.found).toEqual([]);

		await pause();

		expect(addresses()).toEqual(['2']);
		expect(find.found[0]?.snippet).toBe('the mushrooms under the bench');
	});

	it('shows a note matched by both its title and its writing once', async () => {
		hits = [hit(DEEPER, { snippet: 'mushrooms grow from what fell' })];
		find.type('mushroom');
		await pause();

		expect(addresses()).toEqual(['1a3']);
		expect(find.found[0]?.snippet).toBe('mushrooms grow from what fell');
	});

	it('leaves out a note in a graph that is not on the canvas, and keeps a held one', async () => {
		hits = [
			hit(OTHER, { graph: ELSEWHERE, snippet: 'away' }),
			hit(ROOT, { graph: ELSEWHERE, held: true, snippet: 'somebody else wrote this' })
		];
		find.type('away');
		await pause();

		expect(find.found.map((row) => row.held)).toEqual([true]);
	});

	it('resolves a whole address typed inside the graph the reader is in', () => {
		find.type('1a3');

		expect(find.exact).toBe(DEEPER.ref);
	});

	it('reaches a note by a number it has been carried away from, and says which', () => {
		find.type('1b');

		expect(addresses()).toEqual(['2']);
		expect(find.found[0].wasAt).toBe('1b');
	});

	it('resolves a whole old number straight to the note that was at it', () => {
		find.type('1b');

		expect(find.exact).toBe(OTHER.ref);
	});

	it('says nothing about an old number where the one typed still leads there', () => {
		find.type('2');

		expect(find.found[0].wasAt).toBeUndefined();
	});

	it('resolves nothing from words that are not an address', () => {
		find.type('cells');

		expect(addresses()).toEqual(['1a']);
		expect(find.exact).toBeNull();
	});

	it('says what to do when the writing inside notes cannot be read', async () => {
		api.on(
			'GET /nodes/search',
			() => new Response('{"message":"Not right now."}', { status: 503 })
		);
		find.type('mushroom');
		await pause();

		expect(find.unreadable).toBe('Not right now.');
		expect(find.settled).toBe(false);
		expect(addresses()).toEqual(['1a3']);
	});

	it('asks inside each graph on the canvas as well as across them all', async () => {
		find.type('bench');
		await pause();

		const asked = api.calls.filter((one) => one.startsWith('GET /nodes/search'));
		expect(asked.length).toBe(2);
		expect(asked.some((one) => one.includes(`graph=${encodeURIComponent(GRAPH)}`))).toBe(true);
	});

	it('drops an answer for words nobody is typing any more', async () => {
		hits = [hit(OTHER, { snippet: 'the bench' })];
		find.type('bench');
		await pause();
		expect(addresses()).toEqual(['2']);

		find.type('origins');

		expect(addresses()).toEqual(['1']);
		expect(find.settled).toBe(false);
	});

	it('keeps nothing once it is done with', async () => {
		hits = [hit(OTHER, { snippet: 'the bench' })];
		find.type('bench');
		await pause();

		find.clear();

		expect(find.query).toBe('');
		expect(find.found).toEqual([]);
		expect(find.exact).toBeNull();
		expect(find.looking).toBe(false);
	});
});
