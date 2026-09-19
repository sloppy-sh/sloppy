// A look on a line, in a graph a browser tab opened off this device: the folder
// and the archive draw the looks their notes carry, take the ones a reader
// writes, and reach nothing — docs/ARCHITECTURE.md § "A graph on this device,
// in the browser" and § "A look a person set on a line".

import 'fake-indexeddb/auto';
import { applyLod, buildModel, buildPalette, drawnNodes } from '@sloppy/graph';
import { holdDeviceIdentity, LocalApi, makeLocalIdentity, MemoryFiles } from '@sloppy/local';
import type { DidSyr, NodeView, OwnedRef } from '@sloppy/types';
import { pack, unpack } from '@sloppy/vault';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeFolder, type Held } from './browser-files.test-support.js';
import { lineBetween, looksOnCanvas } from './edge-look.js';
import { graphHere } from './graph-here.svelte.js';
import { initRuntime } from './runtime.js';
import { type FakeApi, useFakeApi, VIEWER } from './stores/fake-api.test-support.js';
import { nodes } from './stores/nodes.svelte.js';
import { offers } from './stores/offers.svelte.js';
import { session } from './stores/session.svelte.js';

const ROOT = '/the-folder';
const ELSEWHERE = '/elsewhere';

const palette = buildPalette({
	ink: 'oklch(0.21 0.01 60)',
	paper: 'oklch(0.98 0.006 85)',
	hues: Array.from({ length: 8 }, (_, at) => `oklch(0.61 0.13 ${25 + at * 45})`)
});

interface Written {
	held: Held;
	sprang: OwnedRef;
	under: OwnedRef;
	/** Whoever wrote the folder, which is not whoever opens it in a tab. */
	wrote: DidSyr;
}

/** A folder holding two notes on one line, written by a `LocalApi` so the files
 *  are the ones a tab reads back. `look` is set before it is closed up. */
async function aFolderOnALine(look: boolean): Promise<Written> {
	const store = new Map<string, Uint8Array>();
	const writing = new LocalApi(new MemoryFiles({ store, folder: ROOT, data: ELSEWHERE }));
	await writing.createGraph({ title: 'The thesis' });
	const wrote = (await writing.me())!.did;
	const sprang = await writing.createNode({ title: 'The opening' });
	const under = await writing.createNode({
		title: 'The argument',
		from: { relation: 'under', note: sprang.ref }
	});
	if (look) {
		await writing.updateNode(sprang.ref, {
			edges: [{ to: under.ref, label: 'objects to', direction: 'to', stroke: 'dashed' }]
		});
	}
	return {
		held: new Map(
			[...store]
				.filter(([path]) => path.startsWith(`${ROOT}/`))
				.map(([path, bytes]) => [path.slice(ROOT.length + 1), bytes])
		),
		sprang: sprang.ref,
		under: under.ref,
		wrote
	};
}

function picksUp(held: Held, named = 'thesis'): void {
	Object.defineProperty(globalThis, 'showDirectoryPicker', {
		configurable: true,
		writable: true,
		value: async () => fakeFolder(held, '', named)
	});
}

function chooses(name: string, bytes: Uint8Array): void {
	initRuntime({
		apiHost: () => 'http://api.test',
		openFile: async () => new File([bytes.slice().buffer as ArrayBuffer], name)
	});
}

/** The folder as somebody else reads it afterwards, which is what says a write
 *  landed in the folder rather than in a store in front of it. */
function readAgain(held: Held): LocalApi {
	const store = new Map([...held].map(([path, bytes]) => [`${ROOT}/${path}`, bytes]));
	return new LocalApi(new MemoryFiles({ store, root: ROOT, data: ELSEWHERE }));
}

async function noteIn(reading: LocalApi, ref: OwnedRef): Promise<NodeView> {
	const note = await reading.getNode(ref);
	if (!note) throw new Error('That note is not in the folder');
	return note;
}

/** Every note of the open graph, read the way the home surface reads one: the
 *  branches, and then what springs from each of them. */
async function onTheCanvas(): Promise<NodeView[]> {
	nodes.clear();
	const canvas = new Map<OwnedRef, NodeView>();
	for (const branch of await nodes.load()) {
		for (const note of await nodes.load({ origin: branch.ref })) canvas.set(note.ref, note);
	}
	return [...canvas.values()];
}

let fake: FakeApi;

beforeEach(async () => {
	URL.createObjectURL = () => 'blob:held';
	URL.revokeObjectURL = () => {};
	fake = useFakeApi();
	fake.on('GET /auth/me', () => VIEWER);
	graphHere.offerHere();
	await session.refresh();
});

afterEach(async () => {
	if (graphHere.open) await graphHere.close();
	Reflect.deleteProperty(globalThis, 'showDirectoryPicker');
	nodes.clear();
	offers.clear();
	session.clear();
});

describe('a folder opened in a browser tab', () => {
	it('draws the looks its notes already carry, without asking the API for any of it', async () => {
		const folder = await aFolderOnALine(true);
		picksUp(folder.held);
		await graphHere.openFolder();
		const asked = fake.calls.length;

		const canvas = await onTheCanvas();
		const looks = looksOnCanvas(canvas);
		expect(looks).toEqual([
			{
				from: folder.sprang,
				to: folder.under,
				label: 'objects to',
				direction: 'to',
				stroke: 'dashed'
			}
		]);

		const drawn = drawnNodes(canvas, applyLod(canvas, new Set<OwnedRef>(), undefined).collapsed);
		const model = buildModel(drawn, {
			selection: [],
			palette,
			viewer: folder.wrote,
			edgeLooks: looks
		});
		const line = model.graph.edge(folder.sprang, folder.under);
		expect(line).toBeDefined();
		expect(model.graph.getEdgeAttribute(line!, 'look')).toEqual(looks[0]);
		expect(fake.calls).toHaveLength(asked);
	});

	it('takes a look written on a line into the folder itself, and sends none of it away', async () => {
		const folder = await aFolderOnALine(false);
		picksUp(folder.held);
		await graphHere.openFolder();
		const asked = fake.calls.length;

		const canvas = await onTheCanvas();
		const sprang = canvas.find((one) => one.ref === folder.sprang)!;
		const under = canvas.find((one) => one.ref === folder.under)!;
		const line = lineBetween(sprang, under, session.viewer!.did);
		await nodes.setLook(line.on.ref, {
			to: line.other.ref,
			label: 'answers',
			direction: 'both'
		});

		const reading = readAgain(folder.held);
		const stored = await noteIn(reading, line.on.ref);
		expect(stored.edges).toEqual([{ to: line.other.ref, label: 'answers', direction: 'both' }]);
		expect(looksOnCanvas([stored, await noteIn(reading, line.other.ref)])).toEqual([
			{ from: line.on.ref, to: line.other.ref, label: 'answers', direction: 'both' }
		]);
		expect(fake.calls).toHaveLength(asked);
	});
});

describe('an archive opened in a browser tab', () => {
	it('comes out of the tab carrying the look a reader wrote in it', async () => {
		const folder = await aFolderOnALine(false);
		chooses('thesis.sloppy', pack(new Map(folder.held)));
		await graphHere.openArchive();
		const asked = fake.calls.length;

		const canvas = await onTheCanvas();
		const sprang = canvas.find((one) => one.ref === folder.sprang)!;
		const under = canvas.find((one) => one.ref === folder.under)!;
		const line = lineBetween(sprang, under, session.viewer!.did);
		await nodes.setLook(line.on.ref, { to: line.other.ref, label: 'springs from' });

		const saved: Blob[] = [];
		initRuntime({
			apiHost: () => 'http://api.test',
			saveFile: async (_name, body) => {
				saved.push(body);
			}
		});
		await graphHere.saveCopy();

		const copy = unpack(new Uint8Array(await saved[0].arrayBuffer()));
		const reading = readAgain(new Map(copy));
		expect((await noteIn(reading, line.on.ref)).edges).toEqual([
			{ to: line.other.ref, label: 'springs from' }
		]);
		expect(fake.calls).toHaveLength(asked);
	});

	it('takes in an offer carrying a look, and draws the line under it afterwards', async () => {
		const store = new Map<string, Uint8Array>();
		const owner = new LocalApi(new MemoryFiles({ store, folder: ROOT, data: ELSEWHERE }));
		await owner.createGraph({ title: 'The thesis' });
		const wrote = (await owner.me())!.did;
		const sprang = await owner.createNode({ title: 'The opening' });
		const gated = await owner.createNode({
			title: 'The argument',
			from: { relation: 'under', note: sprang.ref }
		});
		await owner.updateNode(gated.ref, { owner: wrote });
		const other = await holdDeviceIdentity(
			new MemoryFiles({ store, folder: ROOT, data: ELSEWHERE }),
			makeLocalIdentity(),
			{ writing: false }
		);
		const helper = new LocalApi(new MemoryFiles({ store, folder: ROOT, data: ELSEWHERE }), {
			writer: other.did
		});
		await helper.proposeAmendment({
			note: gated.ref,
			title: 'The argument',
			tags: [],
			edges: [{ to: sprang.ref, label: 'answers', direction: 'to' }],
			blocks: []
		});

		const held: Held = new Map(
			[...store]
				.filter(([path]) => path.startsWith(`${ROOT}/`))
				.map(([path, bytes]) => [path.slice(ROOT.length + 1), bytes])
		);
		// Whoever wrote the folder is who opens it here, so the offer is theirs
		// to take in.
		session.clear();
		fake.on('GET /auth/me', () => ({ ...VIEWER, did: wrote }));
		await session.refresh();
		chooses('thesis.sloppy', pack(held));
		await graphHere.openArchive();
		const asked = fake.calls.length;

		await offers.read(gated.ref);
		const standing = offers.on(gated.ref)[0];
		expect(standing.edges).toEqual([{ to: sprang.ref, label: 'answers', direction: 'to' }]);
		await offers.approve(standing);

		const canvas = await onTheCanvas();
		expect(looksOnCanvas(canvas)).toEqual([
			{ from: gated.ref, to: sprang.ref, label: 'answers', direction: 'to' }
		]);
		expect(fake.calls).toHaveLength(asked);
	});
});
