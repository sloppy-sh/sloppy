import 'fake-indexeddb/auto';
import type { OwnedRef, Tag, TagCount } from '@sloppy/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deviceStore } from '../device-store.js';
import { prefs } from './prefs.svelte.js';
import { session } from './session.svelte.js';
import { tags } from './tags.svelte.js';
import { DID, ref, useFakeApi, VIEWER, type FakeApi } from './fake-api.test-support.js';

const READ: TagCount[] = [
	{ tag: 'biology' as Tag, notes: 431 },
	{ tag: 'seed' as Tag, notes: 208 }
];

const GARDEN: TagCount[] = [
	{ tag: 'seed' as Tag, notes: 12 },
	{ tag: 'compost' as Tag, notes: 3 }
];

const HOME = `${DID}/00000000000000000000000000` as OwnedRef;
const OTHER = ref(9);

let api: FakeApi;

/** What the device holds for `graph`, once whatever is on its way has landed. */
async function keptTags(graph: OwnedRef): Promise<TagCount[]> {
	const area = deviceStore.area(DID, 'tags');
	for (let turn = 0; turn < 20; turn += 1) {
		const held = await area.get<TagCount[]>(graph);
		if (held?.length) return held;
		await new Promise((done) => setTimeout(done, 0));
	}
	return [];
}

beforeEach(() => {
	localStorage.clear();
	prefs.init();
	tags.clear();
	api = useFakeApi();
	api.on('GET /nodes/tags', (url) => (url.searchParams.get('graph') === OTHER ? GARDEN : READ));
});

afterEach(() => {
	localStorage.clear();
});

describe('reading the tags in a graph', () => {
	it('answers most-used first, the way the read ordered them', async () => {
		await tags.load(HOME);
		expect(tags.of(HOME)).toEqual(READ);
		expect(tags.status(HOME).loaded).toBe(true);
	});

	it('asks once however many surfaces call it', async () => {
		await Promise.all([tags.load(HOME), tags.load(HOME)]);
		await tags.load(HOME);
		expect(api.countOf('GET /nodes/tags')).toBe(1);
	});

	it('asks again when a surface says the counts have moved', async () => {
		await tags.load(HOME);
		await tags.reload(HOME);
		expect(api.countOf('GET /nodes/tags')).toBe(2);
	});

	it("keeps what it had, and the server's own words, when the read fails", async () => {
		await tags.load(HOME);
		api.on('GET /nodes/tags', () => new Response('{"message":"Not right now."}', { status: 503 }));
		await expect(tags.reload(HOME)).rejects.toThrow();
		expect(tags.of(HOME)).toEqual(READ);
		expect(tags.status(HOME).failed).toBe(true);
		expect(tags.status(HOME).error).toBe('Not right now.');
	});
});

// A tag is a word on a note, and a note is in one graph — so the same word in
// two graphs is two sets, and the rail beside a canvas showing both counts both.
describe('the tags of more than one graph', () => {
	it('counts each graph on its own', async () => {
		await Promise.all([tags.load(HOME), tags.load(OTHER)]);
		expect(tags.of(HOME)).toEqual(READ);
		expect(tags.of(OTHER)).toEqual(GARDEN);
	});

	it('adds up a word both of them carry, and keeps most-used first', async () => {
		await Promise.all([tags.load(HOME), tags.load(OTHER)]);
		expect(tags.across([HOME, OTHER])).toEqual([
			{ tag: 'biology', notes: 431 },
			{ tag: 'seed', notes: 220 },
			{ tag: 'compost', notes: 3 }
		]);
	});

	it('is the graph itself where only one is up', async () => {
		await tags.load(OTHER);
		expect(tags.across([OTHER])).toEqual(GARDEN);
	});
});

describe('the selection', () => {
	it('survives the app being closed and opened', () => {
		tags.select(['seed', 'biology'] as Tag[]);
		prefs.init();
		expect(tags.selected).toEqual(['seed', 'biology']);
	});

	// DESIGN.md § Hue reads the slots off the selection order, so it is stored in
	// that order and never sorted.
	it('holds the order it was made in', () => {
		tags.select(['seed', 'biology'] as Tag[]);
		expect(tags.selected).toEqual(['seed', 'biology']);
		tags.select(['biology', 'seed'] as Tag[]);
		expect(tags.selected).toEqual(['biology', 'seed']);
	});

	it('goes with the graph on a sign-out', async () => {
		await tags.load(HOME);
		tags.select(['seed'] as Tag[]);
		tags.clear();
		expect(tags.selected).toEqual([]);
		expect(tags.of(HOME)).toEqual([]);
		expect(tags.status(HOME).loaded).toBe(false);
	});

	// Nothing the previous person's graph returns belongs to the next one.
	it('drops an answer that lands after a sign-out', async () => {
		let answer: (list: TagCount[]) => void = () => {};
		api.on('GET /nodes/tags', () => new Promise((resolve) => (answer = resolve)));
		const asked = tags.load(HOME);
		tags.clear();
		answer(READ);
		await asked;
		expect(tags.of(HOME)).toEqual([]);
	});
});

describe('the counts this device kept', () => {
	beforeEach(() => {
		// The counts are one identity's, so the store has to know whose these are.
		session.adopt(VIEWER, 'a-session');
	});

	afterEach(() => {
		session.clear();
	});

	it('is a legend for the canvas with nothing to ask', async () => {
		await tags.load(HOME);
		await keptTags(HOME);
		tags.clear();

		api.on('GET /nodes/tags', () => {
			throw new Error('nothing is listening');
		});
		await tags.restore(HOME);

		expect(tags.of(HOME)).toEqual(READ);
	});

	it('shows the counts the server answers with, never the ones it kept', async () => {
		await tags.load(HOME);
		await keptTags(HOME);
		tags.clear();

		api.on('GET /nodes/tags', () => GARDEN);
		await tags.load(HOME);
		await tags.restore(HOME);

		expect(tags.of(HOME)).toEqual(GARDEN);
	});
});
