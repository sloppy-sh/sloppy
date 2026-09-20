// A graph kept on this device, opened in a browser tab: the app reads and
// writes it where it is, and nothing about it reaches the API —
// docs/ARCHITECTURE.md § "A graph on this device, beside the one a Sloppy serves".

import { MemoryFiles } from '@sloppy/local';
import type { GraphView } from '@sloppy/types';
import { pack, unpack } from '@sloppy/vault';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api } from './api.js';
import { type FolderHandle, rememberFolder } from './browser-files.js';
import { aGraphFolder, fakeFolder, type Held } from './browser-files.test-support.js';
import type { FolderHere, FoldersHere } from './folders-here.js';
import { graphHere } from './graph-here.svelte.js';
import { initRuntime, runtime } from './runtime.js';
import { pictureSrc } from './asset-src.js';
import {
	AT,
	DID,
	type FakeApi,
	homeListing,
	ref,
	useFakeApi,
	VIEWER
} from './stores/fake-api.test-support.js';
import { graphs } from './stores/graphs.svelte.js';
import { prefs } from './stores/prefs.svelte.js';
import { session } from './stores/session.svelte.js';

let fake: FakeApi;
let handed: string[];

function picksUp(held: Held, named = 'garden'): void {
	Object.defineProperty(globalThis, 'showDirectoryPicker', {
		configurable: true,
		writable: true,
		value: async () => fakeFolder(held, '', named)
	});
}

function picksUpNothing(): void {
	Reflect.deleteProperty(globalThis, 'showDirectoryPicker');
}

/** A folder a browser will hand over again only on a press, which is what it
 *  does with one it kept across visits. */
function asksAgain(folder: FolderHandle, answer: PermissionState): FolderHandle {
	return Object.assign(folder, {
		queryPermission: async (): Promise<PermissionState> => 'prompt',
		requestPermission: async (): Promise<PermissionState> => answer
	});
}

/** Whether the browser would ask before leaving the page. */
function leavingAsks(): boolean {
	const leaving = new Event('beforeunload', { cancelable: true });
	window.dispatchEvent(leaving);
	return leaving.defaultPrevented;
}

beforeEach(async () => {
	handed = [];
	URL.createObjectURL = (blob: Blob) => {
		const at = `blob:held-${handed.length}-${blob.size}`;
		handed.push(at);
		return at;
	};
	URL.revokeObjectURL = () => {};
	fake = useFakeApi();
	fake.on('GET /auth/me', () => VIEWER);
	graphHere.offerHere();
	await session.refresh();
});

afterEach(async () => {
	if (graphHere.open) await graphHere.close();
	graphHere.notNow();
	await rememberFolder(null);
	picksUpNothing();
	session.clear();
});

// A tab reloaded on a note kept here must not ask the Sloppy this app is served
// from about it, so the graph a page reads is settled before any page mounts.
describe('the boot', () => {
	it('leaves the graph this app is served from in front of a browser told no folder', async () => {
		await graphHere.boot();

		expect(graphHere.ready).toBe(true);
		expect(graphHere.waiting).toBeNull();
		expect(runtime.mode()).toBe('hosted');
		expect((await api.listGraphs()).map((one) => one.title)).toEqual(['My graph']);
	});

	it('is unsettled until the folder this browser was told to open again is served', async () => {
		await rememberFolder(fakeFolder(await aGraphFolder(), '', 'garden'));

		const booting = graphHere.boot();
		expect(graphHere.ready).toBe(false);
		await booting;

		expect(graphHere.ready).toBe(true);
		expect(graphHere.open).toEqual({ how: 'folder', name: 'garden', ownIdentity: false });
		expect(runtime.mode()).toBe('local');
	});

	it('reads a note kept here out of the folder and asks the API nothing about it', async () => {
		await rememberFolder(fakeFolder(await aGraphFolder(), '', 'garden'));
		await graphHere.boot();
		const asked = fake.calls.length;

		const [graph] = await api.listGraphs();
		const [note] = await api.listNodes({ graph: graph.ref });
		expect((await api.getNode(note.ref))?.title).toBe('One');
		expect(await api.listBlocks(note.ref)).toEqual([]);

		expect(fake.calls.slice(asked)).toEqual([]);
	});

	it('waits at the door for a folder this browser must be asked about again', async () => {
		await rememberFolder(asksAgain(fakeFolder(await aGraphFolder(), '', 'garden'), 'granted'));
		const asked = fake.calls.length;

		await graphHere.boot();

		expect(graphHere.waiting).toBe('garden');
		expect(graphHere.open).toBeNull();
		expect(fake.calls.slice(asked)).toEqual([]);
	});

	it('opens the folder that is waiting on a press', async () => {
		await rememberFolder(asksAgain(fakeFolder(await aGraphFolder(), '', 'garden'), 'granted'));
		await graphHere.boot();

		expect(await graphHere.openAgain()).toBe(true);

		expect(graphHere.waiting).toBeNull();
		expect(runtime.mode()).toBe('local');
		expect((await api.listGraphs()).map((one) => one.title)).toEqual(['The garden']);
	});

	it('says what a folder it is refused needs, and leaves the hosted graph in front of somebody', async () => {
		await rememberFolder(asksAgain(fakeFolder(await aGraphFolder(), '', 'garden'), 'denied'));
		await graphHere.boot();

		await expect(graphHere.openAgain()).rejects.toThrow('needs your go-ahead');

		expect(runtime.mode()).toBe('hosted');
	});

	it('reads the graph this app is served from where somebody leaves the folder shut', async () => {
		await rememberFolder(asksAgain(fakeFolder(await aGraphFolder(), '', 'garden'), 'granted'));
		await graphHere.boot();

		graphHere.notNow();

		expect(graphHere.waiting).toBeNull();
		expect(runtime.mode()).toBe('hosted');
		expect((await api.listGraphs()).map((one) => one.title)).toEqual(['My graph']);
	});

	it('leaves the graph this app is served from in front of somebody when the folder will not read', async () => {
		const folder = fakeFolder(await aGraphFolder(), '', 'garden');
		await rememberFolder({
			...folder,
			getFileHandle: () => Promise.reject(new Error('That folder is not there any more.'))
		});

		await graphHere.boot();

		expect(graphHere.ready).toBe(true);
		expect(graphHere.open).toBeNull();
		expect(runtime.mode()).toBe('hosted');
	});
});

describe('the folder door', () => {
	it('is offered only where this browser can hand a folder over', () => {
		picksUp(new Map());
		expect(graphHere.opensAFolder).toBe(true);
		picksUpNothing();
		expect(graphHere.opensAFolder).toBe(false);
	});

	it('serves the graph in the folder, and says the graph is on this device', async () => {
		picksUp(await aGraphFolder());
		expect(await graphHere.openFolder()).toBe(true);

		expect(runtime.mode()).toBe('local');
		expect(session.onDevice).toBe(true);
		expect(graphHere.open).toEqual({ how: 'folder', name: 'garden', ownIdentity: false });
		expect((await api.listGraphs()).map((one) => one.title)).toEqual(['The garden']);
		expect(graphs.all.map((one) => one.title)).toEqual(['The garden']);
	});

	// A tab can put no new graph anywhere, so a folder holding none is the wrong
	// folder rather than a graph waiting to be started in it.
	it('refuses a folder with no graph in it, and writes nothing into it', async () => {
		const holiday = new Map([['holiday.txt', new TextEncoder().encode('off the coast')]]);
		picksUp(holiday);

		await expect(graphHere.openFolder()).rejects.toThrow('That folder holds no graph');

		expect([...holiday.keys()]).toEqual(['holiday.txt']);
		expect(graphHere.open).toBeNull();
		expect(runtime.mode()).toBe('hosted');
	});

	it('leaves the graph this app is served from in front of somebody when the folder will not read', async () => {
		const folder = fakeFolder(await aGraphFolder(), '', 'garden');
		Object.defineProperty(globalThis, 'showDirectoryPicker', {
			configurable: true,
			writable: true,
			value: async () => ({
				...folder,
				getFileHandle: () => Promise.reject(new Error('That folder is not there any more.'))
			})
		});

		await expect(graphHere.openFolder()).rejects.toThrow('not there any more');

		expect(graphHere.open).toBeNull();
		expect(runtime.mode()).toBe('hosted');
		expect((await api.listGraphs()).map((one) => one.title)).toEqual(['My graph']);
	});

	it('writes into the folder itself, and sends nothing to the API', async () => {
		const held = await aGraphFolder();
		const notesBefore = [...held.keys()].filter((path) => path.startsWith('notes/')).length;
		picksUp(held);
		await graphHere.openFolder();
		const asked = fake.calls.length;

		await api.createNode({ title: 'Another thought' });

		const notes = [...held.keys()].filter((path) => path.startsWith('notes/'));
		expect(notes).toHaveLength(notesBefore + 1);
		expect(fake.calls).toHaveLength(asked);
	});

	// A folder holds what is written into it as it is written, so a reload
	// throws nothing away and nobody is stopped on the way out.
	it('lets a reload go ahead', async () => {
		picksUp(await aGraphFolder());
		await graphHere.openFolder();
		await api.createNode({ title: 'Another thought' });

		expect(leavingAsks()).toBe(false);
	});

	it('draws what is in it as it is rather than through the proxy', async () => {
		picksUp(await aGraphFolder());
		const elsewhere = 'https://elsewhere.test/one.png';
		expect(pictureSrc(elsewhere)).toContain('/proxy?url=');
		await graphHere.openFolder();
		expect(pictureSrc(elsewhere)).toBe(elsewhere);
	});

	// A tab has no way to name a second folder, so a graph it cannot put
	// anywhere is one it never offers to start.
	it('leaves starting a graph and bringing one in to the app it was served from', async () => {
		picksUp(await aGraphFolder());
		expect(graphs.startsGraphs).toBe(true);

		await graphHere.openFolder();
		expect(graphs.startsGraphs).toBe(false);

		await graphHere.close();
		expect(graphs.startsGraphs).toBe(true);
	});

	it('puts the graph this app is served from back when it is closed', async () => {
		picksUp(await aGraphFolder());
		await graphHere.openFolder();
		await graphHere.close();

		expect(runtime.mode()).toBe('hosted');
		expect(graphHere.open).toBeNull();
		expect(runtime.vault()).toBeUndefined();
		expect((await api.listGraphs()).map((one) => one.title)).toEqual(['My graph']);
		expect(pictureSrc('https://elsewhere.test/one.png')).toContain('/proxy?url=');
	});

	it('puts back whatever was serving the app rather than the hosted one', async () => {
		fake = useFakeApi('self_hosted');
		fake.on('GET /auth/me', () => VIEWER);
		await session.refresh();
		picksUp(await aGraphFolder());
		await graphHere.openFolder();
		expect(runtime.mode()).toBe('local');

		await graphHere.close();
		expect(runtime.mode()).toBe('self_hosted');
	});

	// Opening one is a door a person walks back out of, so what they had up on
	// the canvas of the graph they were reading is still there when they do.
	it('leaves the graph a person was in and the ones beside it as they were', async () => {
		const beside: GraphView = {
			ref: ref(20),
			created_by: DID,
			created_at: AT,
			updated_at: AT,
			title: 'The garden shed'
		};
		fake.on('GET /graphs', () => [...homeListing(), beside]);
		await graphs.load();
		graphs.enter(beside.ref);
		graphs.toggleOnCanvas(graphs.home);
		const canvas = graphs.onCanvas;

		picksUp(await aGraphFolder());
		await graphHere.openFolder();
		// What a tab reads on a fresh load, which is where a remembered folder is
		// opened again: the choice has to outlast the door, not just the closing.
		prefs.init();
		expect(prefs.current.graph).toBe(beside.ref);

		await graphHere.close();

		expect(prefs.current.graph).toBe(beside.ref);
		expect(graphs.onCanvas).toEqual(canvas);
	});

	it('is written under the account somebody is signed in with', async () => {
		picksUp(await aGraphFolder());
		await session.load();
		expect(session.signedIn).toBe(true);
		await graphHere.openFolder();

		expect(graphHere.open?.ownIdentity).toBe(false);
		expect((await api.me())?.did).toBe(VIEWER.did);
	});

	it('is written under an identity this browser made where nobody is signed in', async () => {
		session.clear();
		picksUp(await aGraphFolder());
		await graphHere.openFolder();

		expect(graphHere.open?.ownIdentity).toBe(true);
		const writing = (await api.me())?.did;
		expect(writing).toMatch(/^did:syr:/);
		expect(writing).not.toBe(VIEWER.did);
	});
});

describe('the archive door', () => {
	function chooses(name: string, bytes: Uint8Array): void {
		initRuntime({
			apiHost: () => 'http://api.test',
			openFile: async () => new File([bytes.slice().buffer as ArrayBuffer], name)
		});
	}

	async function anArchive(): Promise<Uint8Array> {
		const held = await aGraphFolder('The thesis');
		return pack(new Map(held));
	}

	it('serves the graph the file holds', async () => {
		chooses('thesis.sloppy', await anArchive());
		expect(await graphHere.openArchive()).toBe(true);

		expect(runtime.mode()).toBe('local');
		expect(graphHere.open).toEqual({
			how: 'archive',
			name: 'thesis.sloppy',
			ownIdentity: false
		});
		expect((await api.listGraphs()).map((one) => one.title)).toEqual(['The thesis']);
	});

	it('hands back everything written since it was opened', async () => {
		chooses('thesis.sloppy', await anArchive());
		await graphHere.openArchive();
		await api.createNode({ title: 'Written in this tab' });

		let saved: { name: string; body: Blob } | null = null;
		initRuntime({
			apiHost: () => 'http://api.test',
			saveFile: async (name, body) => {
				saved = { name, body };
			}
		});
		await graphHere.saveCopy();

		const copy = unpack(new Uint8Array(await saved!.body.arrayBuffer()));
		const written = [...copy]
			.filter(([path]) => path.startsWith('notes/'))
			.map(([, bytes]) => new TextDecoder().decode(bytes));
		expect(written.some((note) => note.includes('Written in this tab'))).toBe(true);
	});

	// An archive's writing is in this tab and nowhere else, and a reload is a way
	// out of it like any other.
	it('has the browser ask before a reload throws away what is only in this tab', async () => {
		chooses('thesis.sloppy', await anArchive());
		await graphHere.openArchive();
		expect(leavingAsks()).toBe(false);

		await api.createNode({ title: 'Written in this tab' });
		expect(leavingAsks()).toBe(true);

		await graphHere.close();
		expect(leavingAsks()).toBe(false);
	});

	it('lets a reload go ahead once a copy has been saved', async () => {
		chooses('thesis.sloppy', await anArchive());
		await graphHere.openArchive();
		await api.createNode({ title: 'Written in this tab' });
		initRuntime({ apiHost: () => 'http://api.test', saveFile: async () => {} });

		await graphHere.saveCopy();

		expect(leavingAsks()).toBe(false);
	});

	it('refuses a file that is not a graph, in words a person can act on', async () => {
		chooses('holiday.sloppy', new TextEncoder().encode('not a graph at all'));
		await expect(graphHere.openArchive()).rejects.toThrow("isn't a Sloppy graph");
		expect(graphHere.open).toBeNull();
		expect(runtime.mode()).toBe('hosted');
	});
});

// A shell that is not a browser tab hands its own way of reaching a folder to
// `offerHere`, and everything after that is this one store.
describe('a shell that reaches a folder its own way', () => {
	const ROOT = '/Users/me/garden';

	/** The device as a shell outside a browser reaches it: a folder is a path it
	 *  names, nothing is ever asked twice, and a folder holding no graph has one
	 *  started in it. */
	function aDevice(store: Map<string, Uint8Array>): FoldersHere & { written: string | null } {
		const device = new MemoryFiles({ store, folder: ROOT, data: '/device-data' });
		const one = (root: string): FolderHere => ({
			name: root,
			allowed: async () => true,
			open: async () => device.at(root),
			remember: async () => {
				folders.written = root;
			},
			release: () => {}
		});
		const folders = {
			written: null as string | null,
			opens: true,
			starts: true,
			ask: async () => one(ROOT),
			remembered: async () => (folders.written === null ? undefined : one(folders.written)),
			forget: async () => {
				folders.written = null;
			}
		};
		return folders;
	}

	it('says a folder with nothing in it becomes a graph, where a tab says it does not', () => {
		expect(graphHere.startsAGraph).toBe(false);

		graphHere.offerHere(aDevice(new Map()));

		expect(graphHere.startsAGraph).toBe(true);
	});

	it('starts a graph in the folder somebody names and puts them in it', async () => {
		const store = new Map<string, Uint8Array>();
		graphHere.offerHere(aDevice(store));

		expect(await graphHere.openFolder()).toBe(true);

		expect(runtime.mode()).toBe('local');
		expect(graphHere.open).toEqual({ how: 'folder', name: ROOT, ownIdentity: false });
		expect(await api.listGraphs()).toHaveLength(1);
		expect([...store.keys()].some((path) => path.startsWith(`${ROOT}/`))).toBe(true);
	});

	it('serves the folder it was told to open again before any page reads the api', async () => {
		const store = new Map<string, Uint8Array>();
		const folders = aDevice(store);
		graphHere.offerHere(folders);
		await graphHere.openFolder();
		const title = (await api.listGraphs())[0].title;
		await graphHere.close();
		expect(runtime.mode()).toBe('hosted');

		folders.written = ROOT;
		const booting = graphHere.boot();
		expect(graphHere.ready).toBe(false);
		await booting;

		expect(graphHere.open).toEqual({ how: 'folder', name: ROOT, ownIdentity: false });
		const asked = fake.calls.length;
		expect((await api.listGraphs()).map((one) => one.title)).toEqual([title]);
		expect(fake.calls.slice(asked)).toEqual([]);
	});

	it('puts the graph this app is served from back when the folder is closed', async () => {
		graphHere.offerHere(aDevice(new Map()));
		await graphHere.openFolder();

		await graphHere.close();

		expect(graphHere.open).toBeNull();
		expect(runtime.mode()).toBe('hosted');
		expect((await api.listGraphs()).map((one) => one.title)).toEqual(['My graph']);
	});
});
