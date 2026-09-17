import 'fake-indexeddb/auto';
import type { GraphView, OwnedRef } from '@sloppy/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deviceStore } from '../device-store.js';
import type { Credential, CredentialsAccess } from '@sloppy/local';
import { initRuntime, type VaultAccess } from '../runtime.js';
import { graphs, MOST_ON_CANVAS } from './graphs.svelte.js';
import { nodes } from './nodes.svelte.js';
import { prefs } from './prefs.svelte.js';
import { session } from './session.svelte.js';
import { tags } from './tags.svelte.js';
import {
	archiving,
	AT,
	mergePreview,
	DID,
	node,
	ref,
	useFakeApi,
	VIEWER,
	type FakeApi
} from './fake-api.test-support.js';

const HOME = `${DID}/01ARZ3NDEKTSV4RRFFQ69G5HMM` as OwnedRef;

function graph(seed: number, title: string): GraphView {
	return { ref: ref(seed), created_by: DID, created_at: AT, updated_at: AT, title };
}

const GARDEN = graph(20, 'Garden');
const COMPANY = graph(21, 'Company');
const LISTED: GraphView[] = [
	{ ref: HOME, created_by: DID, created_at: AT, updated_at: AT, title: 'My graph', home: true },
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
	initRuntime({ apiHost: () => 'http://api.test', vault: undefined });
});

describe('the graphs somebody keeps', () => {
	it('is the one the listing flags as the one they started with', async () => {
		// Every home graph's ulid is its own, so which graph a person is in is
		// something the listing says rather than something a ref spells.
		expect(graphs.current).toBe('');
		await graphs.load();
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
		expect(graphs.current).toBe('');
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

	it('says what a new note here carries, keeping the name it already has', async () => {
		await graphs.load();
		let asked: unknown = null;
		api.on(`PATCH /graphs/${encodeURIComponent(DID)}/${GARDEN.ref.split('/')[1]}`, (_url, init) => {
			asked = JSON.parse(String(init?.body ?? '{}'));
			return { ...GARDEN, ownership: 'owned' };
		});

		await graphs.setOwnership(GARDEN.ref, 'owned');

		expect(asked).toEqual({ title: GARDEN.title, ownership: 'owned' });
		expect(graphs.all.find((graph) => graph.ref === GARDEN.ref)?.ownership).toBe('owned');
	});

	// The name travels beside the choice, so a graph this store no longer holds
	// would be renamed by a guess.
	it('refuses the choice on a graph it is not holding', async () => {
		await expect(graphs.setOwnership(GARDEN.ref, 'owned')).rejects.toThrow();
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
				replaces: false,
				replacing: 0,
				merges: false,
				conflicts: []
			}),
			imported: () => GARDEN
		});

		const said = await graphs.previewImport(new Blob([new Uint8Array([1])]));

		expect(said.notes).toBe(4);
		expect(api.calls.filter((one) => one.startsWith('POST /graphs/import'))).toEqual([
			'POST /graphs/import?preview=1'
		]);
	});

	it('says what the two copies of one graph disagree about', async () => {
		const NOTE = ref(60);
		archiving(api, {
			preview: () =>
				mergePreview('01JRZ0000000000000000000AA', [
					{
						kind: 'note',
						ref: NOTE,
						sections: [],
						mine: 'Osmosis, written into this morning',
						theirs: 'Osmosis, as the file has it'
					}
				]),
			imported: () => GARDEN
		});

		const said = await graphs.previewImport(new Blob([new Uint8Array([1])]));

		expect(said.merges).toBe(true);
		expect(said.conflicts.map((one) => [one.kind, one.ref])).toEqual([['note', NOTE]]);
	});

	it('carries what a person settled in with the archive', async () => {
		const NOTE = ref(60);
		let settled: unknown;
		api.on('POST /graphs/import', (url, init) => {
			if (url.searchParams.has('preview')) return mergePreview('01JRZ0000000000000000000AA', []);
			settled = JSON.parse(String((init?.body as FormData).get('settle')));
			return GARDEN;
		});
		await graphs.load();

		const brought = await graphs.importArchive(new Blob([new Uint8Array([1])]), {
			resolutions: [{ kind: 'note', ref: NOTE, keep: 'theirs', sections: [] }]
		});

		expect(settled).toEqual({
			resolutions: [{ kind: 'note', ref: NOTE, keep: 'theirs', sections: [] }]
		});
		expect(brought.ref).toBe(GARDEN.ref);
		expect(graphs.current).toBe(GARDEN.ref);
	});

	it('sends no settlement with an import that had nothing to settle', async () => {
		let form = false;
		api.on('POST /graphs/import', (_url, init) => {
			form = init?.body instanceof FormData;
			return GARDEN;
		});
		await graphs.load();

		await graphs.importArchive(new Blob([new Uint8Array([1])]));

		expect(form).toBe(false);
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

describe('a graph that is a folder on this device', () => {
	const GARDEN_FOLDER = '/Users/me/garden';
	const THESIS_FOLDER = '/Users/me/thesis';
	const IN_FOLDER: Record<string, OwnedRef> = {
		[GARDEN_FOLDER]: GARDEN.ref,
		[THESIS_FOLDER]: COMPANY.ref
	};

	/** A shell serving whichever folder is open, which `open` changes the way a
	 *  person choosing another one does. */
	function keeping(folder: string): VaultAccess {
		let open = folder;
		return {
			folder: () => open,
			graph: async () => IN_FOLDER[open],
			asks: true,
			open: async () => (open = THESIS_FOLDER)
		};
	}

	function serving(vault: VaultAccess): void {
		initRuntime({ apiHost: () => 'http://api.test', vault });
	}

	it('is the one in the folder that is open, not the one the device started with', async () => {
		serving(keeping(GARDEN_FOLDER));

		await graphs.load();
		await graphs.readOpenFolder();

		expect(graphs.current).toBe(GARDEN.ref);
	});

	it('is the one in the folder opened next, wherever the reader had been', async () => {
		const vault = keeping(GARDEN_FOLDER);
		serving(vault);
		await graphs.load();
		await graphs.readOpenFolder();
		graphs.enter(HOME);

		await vault.open();
		await graphs.readOpenFolder(true);

		expect(graphs.current).toBe(COMPANY.ref);
		expect(prefs.current.graph).toBeNull();
	});

	it('is the one in the folder a launch opens, whatever was read last time', async () => {
		prefs.set('graph', HOME);
		serving(keeping(THESIS_FOLDER));

		await graphs.load();
		await graphs.readOpenFolder();

		expect(graphs.current).toBe(COMPANY.ref);
	});

	it('stays where the reader moved to while that folder is the open one', async () => {
		serving(keeping(GARDEN_FOLDER));
		await graphs.load();
		await graphs.readOpenFolder();

		graphs.enter(HOME);
		await graphs.load();
		await graphs.readOpenFolder();

		expect(graphs.current).toBe(HOME);
	});

	// A folder somebody shared is theirs, so its refs carry their identity — and
	// it is still one of the graphs in front of this reader.
	it('counts a folder somebody else owns among the graphs in front of the reader', async () => {
		const keeper = 'did:syr:z6MkjChhrJfLm9WGVUAnyLPnfPGmZDcyDKNsBTsAsn7RkAqB';
		const theirs = `${keeper}/01ARZ3NDEKTSV4RRFFQ69G5HMX` as OwnedRef;
		serving({
			folder: () => GARDEN_FOLDER,
			graph: async () => theirs,
			asks: true,
			open: async () => GARDEN_FOLDER
		});
		await graphs.load();
		await graphs.readOpenFolder();

		expect(graphs.keeps(keeper)).toBe(true);
		expect(graphs.keeps(DID)).toBe(true);
		expect(graphs.keeps('did:syr:z6MkuStrangerStrangerStrangerSt')).toBe(false);
	});

	it('is the one the device started with where no folder is open yet', async () => {
		serving({
			folder: () => undefined,
			graph: async () => undefined,
			asks: true,
			open: async () => undefined
		});

		await graphs.load();
		await graphs.readOpenFolder();

		expect(graphs.current).toBe(HOME);
	});
});

describe('the folders this device keeps its graphs in', () => {
	const GARDEN_FOLDER = '/Users/me/garden';
	const THESIS_FOLDER = '/Users/me/thesis';
	const GONE_FOLDER = '/Users/me/gone';

	/** A shell whose graphs are the folders it knows, with what each act it is
	 *  asked for was asked about. */
	function keeping(): VaultAccess & {
		opened: string[];
		forgotten: string[];
		cloned: { url: string; credential?: Credential }[];
		started: number;
	} {
		let open = GARDEN_FOLDER;
		const known = [
			{
				root: GARDEN_FOLDER,
				graph: { ref: GARDEN.ref, name: 'Garden', owner: DID },
				reachable: true
			},
			{
				root: THESIS_FOLDER,
				graph: { ref: COMPANY.ref, name: 'Company', owner: DID },
				reachable: true
			},
			{ root: GONE_FOLDER, reachable: false }
		];
		return {
			opened: [],
			forgotten: [],
			cloned: [],
			started: 0,
			folder: () => open,
			graph: async () => (open === GARDEN_FOLDER ? GARDEN.ref : COMPANY.ref),
			asks: true,
			open: async () => open,
			known: async () => known.filter((one) => one.root !== undefined),
			async openKnown(root: string) {
				this.opened.push(root);
				open = root;
			},
			async forget(root: string) {
				this.forgotten.push(root);
				const at = known.findIndex((one) => one.root === root);
				if (at >= 0) known.splice(at, 1);
			},
			async start() {
				this.started += 1;
				open = THESIS_FOLDER;
				return open;
			},
			async clone(url: string, credential?: Credential) {
				this.cloned.push({ url, ...(credential ? { credential } : {}) });
				open = THESIS_FOLDER;
				return open;
			}
		};
	}

	function serving(vault: VaultAccess, credentials?: CredentialsAccess): void {
		initRuntime({ apiHost: () => 'http://api.test', vault, credentials });
	}

	it('are read as one graph each, the one that is gone among them', async () => {
		serving(keeping());

		await graphs.load();
		await graphs.readFolders();

		expect(graphs.folders.map((one) => one.root)).toEqual([
			GARDEN_FOLDER,
			THESIS_FOLDER,
			GONE_FOLDER
		]);
		expect(graphs.folders[2].reachable).toBe(false);
		expect(graphs.folders[0].graph?.name).toBe('Garden');
	});

	it('are nothing at all where a graph is not a folder on the device', async () => {
		initRuntime({ apiHost: () => 'http://api.test', vault: undefined });

		await graphs.load();
		await graphs.readFolders();

		expect(graphs.folders).toEqual([]);
	});

	it('serve the graph in the one opened, which is the one in front of the reader', async () => {
		const vault = keeping();
		serving(vault);
		await graphs.load();
		await graphs.readOpenFolder();
		expect(graphs.current).toBe(GARDEN.ref);

		await graphs.enterFolder(THESIS_FOLDER);

		expect(vault.opened).toEqual([THESIS_FOLDER]);
		expect(graphs.current).toBe(COMPANY.ref);
	});

	it('say which folder is open by its root, which two of them holding one graph share', async () => {
		const vault = keeping();
		serving(vault);
		await graphs.load();
		await graphs.readOpenFolder();

		expect(graphs.openFolder).toBe(GARDEN_FOLDER);

		await graphs.enterFolder(THESIS_FOLDER);

		expect(graphs.openFolder).toBe(THESIS_FOLDER);
	});

	it('lose one that is forgotten, and nothing else about it', async () => {
		const vault = keeping();
		serving(vault);
		await graphs.load();
		await graphs.readFolders();

		await graphs.forgetFolder(GONE_FOLDER);

		expect(vault.forgotten).toEqual([GONE_FOLDER]);
		expect(graphs.folders.map((one) => one.root)).toEqual([GARDEN_FOLDER, THESIS_FOLDER]);
	});

	it('gain the one somebody starts, which is then the graph in front of them', async () => {
		const vault = keeping();
		serving(vault);
		await graphs.load();
		await graphs.readOpenFolder();

		expect(await graphs.startFolder()).toBe(true);

		expect(vault.started).toBe(1);
		expect(graphs.current).toBe(COMPANY.ref);
	});

	it('bring one from an address with what this device holds for that host', async () => {
		const vault = keeping();
		const token: Credential = { kind: 'token', token: 'a-token' };
		serving(vault, {
			list: async () => [],
			forUrl: async (url) => (url.includes('somewhere.test') ? token : undefined),
			hold: async () => {},
			forget: async () => {}
		});
		await graphs.load();
		await graphs.readOpenFolder();

		expect(await graphs.cloneFolder('https://somewhere.test/ada/garden.git')).toBe(true);

		expect(vault.cloned).toEqual([
			{ url: 'https://somewhere.test/ada/garden.git', credential: token }
		]);
		expect(graphs.current).toBe(COMPANY.ref);
	});

	it('are let go of with everything else the last person read', async () => {
		serving(keeping());
		await graphs.load();
		await graphs.readFolders();

		graphs.clear();

		expect(graphs.folders).toEqual([]);
	});
});

describe('two folders holding one graph', () => {
	const ONE = '/Users/me/garden';
	const COPY = '/Users/me/garden-copy';

	/** A shell keeping one graph in two folders — a copy of it beside the
	 *  original — where only the root tells the two apart. */
	function bothAt(): VaultAccess & { opened(): string } {
		let open = ONE;
		const held = { ref: GARDEN.ref, name: 'Garden', owner: DID };
		return {
			folder: () => open,
			graph: async () => GARDEN.ref,
			asks: true,
			open: async () => open,
			opened: () => open,
			async openKnown(root: string) {
				open = root;
			},
			known: async () => [
				{ root: ONE, graph: held, reachable: true },
				{ root: COPY, graph: held, reachable: true }
			]
		};
	}

	beforeEach(() => {
		nodes.clear();
		tags.clear();
	});

	it('draw the notes in the folder now open, not the ones read out of the last', async () => {
		const vault = bothAt();
		initRuntime({ apiHost: () => 'http://api.test', vault });
		const inCopy = [node(1, '1', { graph: GARDEN.ref }), node(2, '2', { graph: GARDEN.ref })];
		api.on('GET /nodes', () => (vault.opened() === ONE ? inCopy.slice(0, 1) : inCopy));
		api.on('GET /nodes/tags', () => [{ tag: 'seed', notes: vault.opened() === ONE ? 1 : 2 }]);
		await graphs.load();
		await graphs.readOpenFolder();
		await nodes.load({ graph: GARDEN.ref });
		await tags.load(GARDEN.ref);
		expect(nodes.region({ graph: GARDEN.ref })).toHaveLength(1);

		await graphs.enterFolder(COPY);

		expect(nodes.region({ graph: GARDEN.ref })).toHaveLength(2);
		expect(tags.of(GARDEN.ref)).toEqual([{ tag: 'seed', notes: 2 }]);

		await graphs.enterFolder(ONE);

		expect(nodes.region({ graph: GARDEN.ref })).toHaveLength(1);
		expect(tags.of(GARDEN.ref)).toEqual([{ tag: 'seed', notes: 1 }]);
	});
});
