import type { Tag, TagCount } from '@sloppy/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prefs } from './prefs.svelte.js';
import { tags } from './tags.svelte.js';
import { useFakeApi, type FakeApi } from './fake-api.test-support.js';

const READ: TagCount[] = [
	{ tag: 'biology' as Tag, notes: 431 },
	{ tag: 'seed' as Tag, notes: 208 }
];

let api: FakeApi;

beforeEach(() => {
	localStorage.clear();
	prefs.init();
	tags.clear();
	api = useFakeApi();
	api.on('GET /nodes/tags', () => READ);
});

afterEach(() => {
	localStorage.clear();
});

describe('reading the tags in a graph', () => {
	it('answers most-used first, the way the read ordered them', async () => {
		await tags.load();
		expect(tags.all).toEqual(READ);
		expect(tags.loaded).toBe(true);
	});

	it('asks once however many surfaces call it', async () => {
		await Promise.all([tags.load(), tags.load()]);
		await tags.load();
		expect(api.countOf('GET /nodes/tags')).toBe(1);
	});

	it('asks again when a surface says the counts have moved', async () => {
		await tags.load();
		await tags.reload();
		expect(api.countOf('GET /nodes/tags')).toBe(2);
	});

	it("keeps what it had, and the server's own words, when the read fails", async () => {
		await tags.load();
		api.on('GET /nodes/tags', () => new Response('{"message":"Not right now."}', { status: 503 }));
		await expect(tags.reload()).rejects.toThrow();
		expect(tags.all).toEqual(READ);
		expect(tags.failed).toBe(true);
		expect(tags.error).toBe('Not right now.');
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
		await tags.load();
		tags.select(['seed'] as Tag[]);
		tags.clear();
		expect(tags.selected).toEqual([]);
		expect(tags.all).toEqual([]);
		expect(tags.loaded).toBe(false);
	});

	// Nothing the previous person's graph returns belongs to the next one.
	it('drops an answer that lands after a sign-out', async () => {
		let answer: (list: TagCount[]) => void = () => {};
		api.on('GET /nodes/tags', () => new Promise((resolve) => (answer = resolve)));
		const asked = tags.load();
		tags.clear();
		answer(READ);
		await asked;
		expect(tags.all).toEqual([]);
	});
});
