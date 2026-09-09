import 'fake-indexeddb/auto';
import type { GraphView, OwnedRef } from '@sloppy/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deviceStore } from '../device-store.js';
import { graphs, MOST_ON_CANVAS } from './graphs.svelte.js';
import { prefs } from './prefs.svelte.js';
import { session } from './session.svelte.js';
import {
	archiving,
	AT,
	DID,
	ref,
	useFakeApi,
	VIEWER,
	type FakeApi
} from './fake-api.test-support.js';

const HOME = `${DID}/00000000000000000000000000` as OwnedRef;

function graph(seed: number, title: string): GraphView {
	return { ref: ref(seed), created_by: DID, created_at: AT, updated_at: AT, title };
}

const GARDEN = graph(20, 'Garden');
const COMPANY = graph(21, 'Company');
const LISTED: GraphView[] = [
	{ ref: HOME, created_by: DID, created_at: AT, updated_at: AT, title: 'My graph' },
	GARDEN,
	COMPANY
];

let api: FakeApi;

/** The listing the device holds, once whatever is on its way has landed. */
async function keptGraphs(): Promise<GraphView[]> {
	const area = deviceStore.area(DID, 'graphs');
	for (let turn = 0; turn < 20; turn += 1) {
		const held = await area.get<GraphView[]>('listing');
		if (held?.length) return held;
		await new Promise((done) => setTimeout(done, 0));
	}
	return [];
}

beforeEach(async () => {
	localStorage.clear();
	prefs.init();
	graphs.clear();
	api = useFakeApi();
	api.on('GET /auth/me', () => VIEWER);
	api.on('GET /graphs', () => LISTED);
	await session.refresh();
});

afterEach(() => {
	localStorage.clear();
	session.clear();
});

describe('the graphs somebody keeps', () => {
	it('is the one they started with before anything has been read', () => {
		expect(graphs.current).toBe(HOME);
		expect(graphs.onCanvas).toEqual([HOME]);
	});

	it('answers the listing, and asks once however many surfaces call it', async () => {
		await Promise.all([graphs.load(), graphs.load()]);
		expect(graphs.all).toEqual(LISTED);
		expect(api.countOf('GET /graphs')).toBe(1);
		expect(graphs.several).toBe(true);
	});

	it('names each of them', async () => {
		await graphs.load();
		expect(graphs.titleOf(GARDEN.ref)).toBe('Garden');
	});

	it("keeps the server's own words when the listing fails", async () => {
		api.on('GET /graphs', () => new Response('{"message":"Not right now."}', { status: 503 }));
		await expect(graphs.load()).rejects.toThrow();
		expect(graphs.state.error).toBe('Not right now.');
		expect(graphs.current).toBe(HOME);
	});
});

describe('moving between them', () => {
	beforeEach(async () => {
		await graphs.load();
	});

	it('puts a new note where the reader is, and remembers it', () => {
		graphs.enter(GARDEN.ref);
		expect(graphs.current).toBe(GARDEN.ref);
		prefs.init();
		expect(graphs.current).toBe(GARDEN.ref);
	});

	it('opens a new graph and moves the reader into it', async () => {
		const made = graph(30, 'Thesis');
		api.on('POST /graphs', () => made);
		await graphs.open({ title: 'Thesis' });
		expect(graphs.current).toBe(made.ref);
		expect(graphs.all).toContainEqual(made);
	});

	it('renames one in place', async () => {
		const named = { ...GARDEN, title: 'Allotment' };
		api.on(`PATCH /graphs/${encodeURIComponent(DID)}/${GARDEN.ref.split('/')[1]}`, () => named);
		await graphs.rename(GARDEN.ref, { title: 'Allotment' });
		expect(graphs.titleOf(GARDEN.ref)).toBe('Allotment');
	});

	it('closes one, and takes it off the canvas the reader had it on', async () => {
		await graphs.load();
		graphs.enter(GARDEN.ref);
		graphs.toggleOnCanvas(COMPANY.ref);
		api.on(
			`DELETE /graphs/${encodeURIComponent(DID)}/${GARDEN.ref.split('/')[1]}`,
			() => undefined
		);

		await graphs.close(GARDEN.ref);

		expect(graphs.all).not.toContainEqual(GARDEN);
		expect(graphs.current).toBe(HOME);
		expect(graphs.onCanvas).toEqual([HOME, COMPANY.ref]);
		expect(await keptGraphs()).not.toContainEqual(GARDEN);
	});

	it('takes one it was standing beside off the canvas too', async () => {
		await graphs.load();
		graphs.toggleOnCanvas(GARDEN.ref);
		api.on(
			`DELETE /graphs/${encodeURIComponent(DID)}/${GARDEN.ref.split('/')[1]}`,
			() => undefined
		);

		await graphs.close(GARDEN.ref);

		expect(graphs.onCanvas).toEqual([HOME]);
		expect(prefs.current.alsoOnCanvas).not.toContain(GARDEN.ref);
	});

	it('keeps it where the server refuses to close it', async () => {
		await graphs.load();
		api.on(
			`DELETE /graphs/${encodeURIComponent(DID)}/${GARDEN.ref.split('/')[1]}`,
			() =>
				new Response(JSON.stringify({ message: 'That graph is not here.' }), {
					status: 400,
					headers: { 'content-type': 'application/json' }
				})
		);

		await expect(graphs.close(GARDEN.ref)).rejects.toThrow();
		expect(graphs.all).toContainEqual(GARDEN);
	});

	// A choice saved on this device outlives the person who made it, and a graph
	// belongs to one identity.
	it('falls back to the one they started with for a graph they do not keep', () => {
		prefs.set('graph', ref(99));
		expect(graphs.current).toBe(HOME);
	});
});

describe('the graphs on the canvas', () => {
	beforeEach(async () => {
		await graphs.load();
	});

	it('is the one being read until another is put up beside it', () => {
		expect(graphs.onCanvas).toEqual([HOME]);
		graphs.toggleOnCanvas(GARDEN.ref);
		expect(graphs.onCanvas).toEqual([HOME, GARDEN.ref]);
	});

	it('takes one back down', () => {
		graphs.toggleOnCanvas(GARDEN.ref);
		graphs.toggleOnCanvas(GARDEN.ref);
		expect(graphs.onCanvas).toEqual([HOME]);
	});

	// Moving into a graph already up beside the one being read is a switch, not a
	// second field of the same notebook.
	it('never holds the same graph twice', () => {
		graphs.toggleOnCanvas(GARDEN.ref);
		graphs.enter(GARDEN.ref);
		expect(graphs.onCanvas).toEqual([GARDEN.ref]);
	});

	it('leaves the others up when the reader moves', () => {
		graphs.toggleOnCanvas(GARDEN.ref);
		graphs.enter(COMPANY.ref);
		expect(graphs.onCanvas).toEqual([COMPANY.ref, GARDEN.ref]);
	});

	it('names every field for the renderer', () => {
		graphs.toggleOnCanvas(GARDEN.ref);
		expect(graphs.fields).toEqual([
			{ ref: HOME, title: 'My graph' },
			{ ref: GARDEN.ref, title: 'Garden' }
		]);
	});

	it('drops a graph the reader no longer keeps', () => {
		prefs.set('alsoOnCanvas', [ref(99)]);
		expect(graphs.onCanvas).toEqual([HOME]);
	});

	// A graph ref names the identity that keeps it, so it is one of theirs and
	// must not still be on the device for whoever signs in next.
	it('keeps nothing of the arrangement after a sign-out', () => {
		graphs.toggleOnCanvas(GARDEN.ref);
		graphs.enter(COMPANY.ref);
		graphs.clear();

		expect(prefs.current.graph).toBeNull();
		expect(prefs.current.alsoOnCanvas).toEqual([]);
		expect(localStorage.getItem('sloppy_prefs') ?? '').not.toContain(DID);
	});

	it('holds no more than a canvas can carry', async () => {
		const many = [
			...LISTED,
			...Array.from({ length: MOST_ON_CANVAS + 2 }, (_, at) => graph(200 + at, `Notebook ${at}`))
		];
		api.on('GET /graphs', () => many);
		await graphs.reload();
		for (const one of many) graphs.toggleOnCanvas(one.ref);
		expect(graphs.onCanvas.length).toBe(MOST_ON_CANVAS);
		expect(graphs.canvasFull).toBe(true);
	});
});

describe('the graphs this device kept', () => {
	// A saved arrangement names graphs by ref, and a ref is only one of this
	// person's if the listing says so — so with no listing there is no canvas.
	it('stands the arrangement back up with nothing to ask', async () => {
		await graphs.load();
		graphs.toggleOnCanvas(GARDEN.ref);
		await keptGraphs();

		graphs.clear();
		prefs.set('alsoOnCanvas', [GARDEN.ref]);
		api.on('GET /graphs', () => {
			throw new Error('nothing is listening');
		});
		await graphs.restore();

		expect(graphs.titleOf(GARDEN.ref)).toBe('Garden');
		expect(graphs.onCanvas).toEqual([HOME, GARDEN.ref]);
	});

	// The sheet lists these graphs off the same store, and a listing that is
	// standing has nothing to apologise for.
	it('says nothing went wrong while the kept listing stands', async () => {
		await graphs.load();
		await keptGraphs();
		graphs.clear();

		api.on('GET /graphs', () => {
			throw new Error('nothing is listening');
		});
		await graphs.restore();
		await graphs.load().catch(() => {});

		expect(graphs.all.map((one) => one.title)).toContain('Garden');
		expect(graphs.state.failed).toBe(false);
		expect(graphs.state.error).toBeUndefined();
	});

	// Offline an ask fails fast and a cold store is slower, so which of the two
	// lands first must not decide whether the sheet reports a failure.
	it('says nothing went wrong where the ask fails before the device answers', async () => {
		await graphs.load();
		await keptGraphs();
		graphs.clear();

		api.on('GET /graphs', () => {
			throw new Error('nothing is listening');
		});
		await graphs.load().catch(() => {});

		expect(graphs.all.map((one) => one.title)).toContain('Garden');
		expect(graphs.state.failed).toBe(false);
	});

	it('says so where it kept no listing to stand', async () => {
		graphs.clear();
		await deviceStore.area(DID, 'graphs').clear();
		api.on('GET /graphs', () => {
			throw new Error('nothing is listening');
		});

		await graphs.load().catch(() => {});

		expect(graphs.state.failed).toBe(true);
	});

	it('shows the listing the server answers with, never the one it kept', async () => {
		await graphs.load();
		await keptGraphs();
		graphs.clear();

		api.on('GET /graphs', () => [{ ...GARDEN, title: 'Allotment' }]);
		await graphs.load();
		await graphs.restore();

		expect(graphs.all.map((one) => one.title)).toEqual(['Allotment']);
	});
});

// docs/ARCHITECTURE.md § "A graph on disk": a re-import is a replace rather
// than a second copy, so the listing gains one graph either way.
describe('a graph brought in from a file', () => {
	it('joins the listing, and is the one they are in', async () => {
		const BROUGHT = graph(30, 'Osmosis');
		archiving(api, { imported: () => BROUGHT });
		await graphs.load();

		const back = await graphs.importArchive(new Blob([new Uint8Array([1])]));

		expect(back).toEqual(BROUGHT);
		expect(graphs.all.map((one) => one.title)).toEqual([
			'My graph',
			'Garden',
			'Company',
			'Osmosis'
		]);
		expect(graphs.current).toBe(BROUGHT.ref);
	});

	it('takes the place of the graph it replaced rather than standing beside it', async () => {
		archiving(api, { imported: () => ({ ...GARDEN, title: 'Garden, as it was' }) });
		await graphs.load();

		await graphs.importArchive(new Blob([new Uint8Array([1])]));

		expect(graphs.all.map((one) => one.title)).toEqual([
			'My graph',
			'Garden, as it was',
			'Company'
		]);
		expect(graphs.current).toBe(GARDEN.ref);
	});

	it('asks what the file holds without writing any of it', async () => {
		archiving(api, {
			preview: () => ({
				format: 1,
				graph: '01JRZ0000000000000000000AA',
				name: 'Osmosis',
				owner: DID,
				notes: 4,
				pictures: 0,
				missing_emoji: [],
				collisions: [],
				replaces: false
			}),
			imported: () => GARDEN
		});

		const said = await graphs.previewImport(new Blob([new Uint8Array([1])]));

		expect(said.notes).toBe(4);
		expect(api.calls.filter((one) => one.startsWith('POST /graphs/import'))).toEqual([
			'POST /graphs/import?preview=1'
		]);
	});

	it('asks for the graph a person is keeping as a file, and hands back what to call it', async () => {
		archiving(api, {
			exported: {
				[GARDEN.ref]: () => ({ body: 'a graph', filename: 'Garden 2026-03-05.sloppy' })
			}
		});

		const file = await graphs.exportArchive(GARDEN.ref);

		expect(new TextDecoder().decode(file.bytes)).toBe('a graph');
		expect(file.filename).toBe('Garden 2026-03-05.sloppy');
	});
});
