// A graph kept on this device, opened in a browser tab: the app reads and
// writes it where it is, and nothing about it reaches the API —
// docs/ARCHITECTURE.md § "A graph on this device, in the browser".

import { LocalApi, MemoryFiles } from '@sloppy/local';
import { pack, unpack } from '@sloppy/vault';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api } from './api.js';
import { fakeFolder, type Held } from './browser-files.test-support.js';
import { graphHere } from './graph-here.svelte.js';
import { initRuntime, runtime } from './runtime.js';
import { pictureSrc } from './asset-src.js';
import { type FakeApi, useFakeApi, VIEWER } from './stores/fake-api.test-support.js';
import { graphs } from './stores/graphs.svelte.js';
import { session } from './stores/session.svelte.js';

/** A folder holding a graph with one note in it, as a map of path to bytes. A
 *  real `LocalApi` writes it, so the files are the ones the app reads back. */
async function aFolderWithAGraph(title = 'The garden'): Promise<Held> {
	const store = new Map<string, Uint8Array>();
	const at = '/the-folder';
	const writing = new LocalApi(new MemoryFiles({ store, folder: at, data: '/elsewhere' }));
	const graph = await writing.createGraph({ title });
	await writing.createNode({ title: 'One' });
	expect(graph.title).toBe(title);
	return new Map(
		[...store]
			.filter(([path]) => path.startsWith(`${at}/`))
			.map(([path, bytes]) => [path.slice(at.length + 1), bytes])
	);
}

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
	picksUpNothing();
	session.clear();
});

describe('the folder door', () => {
	it('is offered only where this browser can hand a folder over', () => {
		picksUp(new Map());
		expect(graphHere.opensAFolder).toBe(true);
		picksUpNothing();
		expect(graphHere.opensAFolder).toBe(false);
	});

	it('serves the graph in the folder, and says the graph is on this device', async () => {
		picksUp(await aFolderWithAGraph());
		expect(await graphHere.openFolder()).toBe(true);

		expect(runtime.mode()).toBe('local');
		expect(session.onDevice).toBe(true);
		expect(graphHere.open).toEqual({ how: 'folder', name: 'garden', ownIdentity: false });
		expect((await api.listGraphs()).map((one) => one.title)).toEqual(['The garden']);
		expect(graphs.all.map((one) => one.title)).toEqual(['The garden']);
	});

	it('writes into the folder itself, and sends nothing to the API', async () => {
		const held = await aFolderWithAGraph();
		const notesBefore = [...held.keys()].filter((path) => path.startsWith('notes/')).length;
		picksUp(held);
		await graphHere.openFolder();
		const asked = fake.calls.length;

		await api.createNode({ title: 'Another thought' });

		const notes = [...held.keys()].filter((path) => path.startsWith('notes/'));
		expect(notes).toHaveLength(notesBefore + 1);
		expect(fake.calls).toHaveLength(asked);
	});

	it('draws what is in it as it is rather than through the proxy', async () => {
		picksUp(await aFolderWithAGraph());
		const elsewhere = 'https://elsewhere.test/one.png';
		expect(pictureSrc(elsewhere)).toContain('/proxy?url=');
		await graphHere.openFolder();
		expect(pictureSrc(elsewhere)).toBe(elsewhere);
	});

	it('puts the graph this app is served from back when it is closed', async () => {
		picksUp(await aFolderWithAGraph());
		await graphHere.openFolder();
		await graphHere.close();

		expect(runtime.mode()).toBe('hosted');
		expect(graphHere.open).toBeNull();
		expect(runtime.vault()).toBeUndefined();
		expect((await api.listGraphs()).map((one) => one.title)).toEqual(['My graph']);
		expect(pictureSrc('https://elsewhere.test/one.png')).toContain('/proxy?url=');
	});

	it('is written under the account somebody is signed in with', async () => {
		picksUp(await aFolderWithAGraph());
		await session.load();
		expect(session.signedIn).toBe(true);
		await graphHere.openFolder();

		expect(graphHere.open?.ownIdentity).toBe(false);
		expect((await api.me())?.did).toBe(VIEWER.did);
	});

	it('is written under an identity this browser made where nobody is signed in', async () => {
		session.clear();
		picksUp(await aFolderWithAGraph());
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
		const held = await aFolderWithAGraph('The thesis');
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

	it('refuses a file that is not a graph, in words a person can act on', async () => {
		chooses('holiday.sloppy', new TextEncoder().encode('not a graph at all'));
		await expect(graphHere.openArchive()).rejects.toThrow("isn't a Sloppy graph");
		expect(graphHere.open).toBeNull();
		expect(runtime.mode()).toBe('hosted');
	});
});
