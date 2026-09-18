// A graph kept on this device, opened in a browser tab: the app reads and
// writes it where it is, and nothing about it reaches the API —
// docs/ARCHITECTURE.md § "A graph on this device, in the browser".

import type { GraphView } from '@sloppy/types';
import { pack, unpack } from '@sloppy/vault';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api } from './api.js';
import { aGraphFolder, fakeFolder, type Held } from './browser-files.test-support.js';
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
		picksUp(await aGraphFolder());
		expect(await graphHere.openFolder()).toBe(true);

		expect(runtime.mode()).toBe('local');
		expect(session.onDevice).toBe(true);
		expect(graphHere.open).toEqual({ how: 'folder', name: 'garden', ownIdentity: false });
		expect((await api.listGraphs()).map((one) => one.title)).toEqual(['The garden']);
		expect(graphs.all.map((one) => one.title)).toEqual(['The garden']);
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

	it('draws what is in it as it is rather than through the proxy', async () => {
		picksUp(await aGraphFolder());
		const elsewhere = 'https://elsewhere.test/one.png';
		expect(pictureSrc(elsewhere)).toContain('/proxy?url=');
		await graphHere.openFolder();
		expect(pictureSrc(elsewhere)).toBe(elsewhere);
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

	it('refuses a file that is not a graph, in words a person can act on', async () => {
		chooses('holiday.sloppy', new TextEncoder().encode('not a graph at all'));
		await expect(graphHere.openArchive()).rejects.toThrow("isn't a Sloppy graph");
		expect(graphHere.open).toBeNull();
		expect(runtime.mode()).toBe('hosted');
	});
});
