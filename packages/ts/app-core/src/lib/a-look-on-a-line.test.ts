// A look set on a line, from the sheet that writes it to the canvas that draws
// it, over the graph that actually serves it: a folder on this device —
// docs/ARCHITECTURE.md § "A look a person set on a line".

import 'fake-indexeddb/auto';
import { applyLod, buildModel, buildPalette, drawnNodes } from '@sloppy/graph';
import { holdDeviceIdentity, LocalApi, makeLocalIdentity, MemoryFiles } from '@sloppy/local';
import type { DidSyr, NodeView, OwnedRef } from '@sloppy/types';
import { afterEach, describe, expect, it } from 'vitest';
import { resetApi } from './api.js';
import { looksApart, lookInWords, type WritingSide } from './components/offer-difference.js';
import { lineBetween, looksOnCanvas } from './edge-look.js';
import { initRuntime } from './runtime.js';
import { nodes } from './stores/nodes.svelte.js';
import { offers } from './stores/offers.svelte.js';
import { session } from './stores/session.svelte.js';

const FOLDER = '/graphs/thesis';

const palette = buildPalette({
	ink: 'oklch(0.21 0.01 60)',
	paper: 'oklch(0.98 0.006 85)',
	hues: Array.from({ length: 8 }, (_, at) => `oklch(0.61 0.13 ${25 + at * 45})`)
});

/** The folder as one identity reaches it. Every client here reads and writes the
 *  same files and holds nothing of another's index, so what a test asserts is
 *  what the folder says rather than what a write told it. */
function client(store: Map<string, Uint8Array>, writer?: DidSyr): LocalApi {
	const files = new MemoryFiles({ store, folder: FOLDER });
	return new LocalApi(files, writer === undefined ? {} : { writer });
}

/** Serve the app off this client, as the shell of a device with a folder open
 *  does, with nothing of the last reader held. */
async function servedBy(api: LocalApi): Promise<void> {
	initRuntime({
		apiHost: () => '',
		mode: () => 'local',
		createApi: () => api,
		vault: {
			folder: () => FOLDER,
			graph: () => api.graphHere(),
			open: async () => FOLDER,
			asks: false
		}
	});
	resetApi();
	nodes.clear();
	offers.clear();
	session.clear();
	await session.refresh();
}

async function noteIn(api: LocalApi, ref: OwnedRef): Promise<NodeView> {
	const note = await api.getNode(ref);
	if (!note) throw new Error('That note is not in the folder');
	return note;
}

afterEach(() => {
	nodes.clear();
	offers.clear();
	session.clear();
	initRuntime({ apiHost: () => 'http://api.test', createApi: undefined, vault: undefined });
	resetApi();
});

describe('a look set on a line in a folder on this device', () => {
	it('is what the folder reads back and what the model draws the line under', async () => {
		const store = new Map<string, Uint8Array>();
		const owner = client(store);
		await owner.createGraph({ title: 'Thesis' });
		const writer = (await owner.me())!.did;
		const sprang = await owner.createNode({ title: 'The opening' });
		const under = await owner.createNode({
			title: 'The argument',
			from: { relation: 'under', note: sprang.ref }
		});

		await servedBy(client(store));
		const line = lineBetween(sprang, under, writer);
		await nodes.setLook(line.on.ref, {
			to: line.other.ref,
			label: 'objects to',
			direction: 'to',
			stroke: 'dashed'
		});

		const read = client(store);
		const canvas = [await noteIn(read, sprang.ref), await noteIn(read, under.ref)];
		const looks = looksOnCanvas(canvas);
		expect(looks).toEqual([
			{
				from: line.on.ref,
				to: line.other.ref,
				label: 'objects to',
				direction: 'to',
				stroke: 'dashed'
			}
		]);

		const drawn = drawnNodes(canvas, applyLod(canvas, new Set<OwnedRef>(), undefined).collapsed);
		const model = buildModel(drawn, { selection: [], palette, viewer: writer, edgeLooks: looks });
		const drawnLine = model.graph.edge(sprang.ref, under.ref);
		expect(drawnLine).toBeDefined();
		expect(model.graph.getEdgeAttribute(drawnLine!, 'look')).toEqual(looks[0]);
	});

	it('is taken off the note the sheet wrote it on, and off the canvas with it', async () => {
		const store = new Map<string, Uint8Array>();
		const owner = client(store);
		await owner.createGraph({ title: 'Thesis' });
		const writer = (await owner.me())!.did;
		const sprang = await owner.createNode({ title: 'The opening' });
		const under = await owner.createNode({
			title: 'The argument',
			from: { relation: 'under', note: sprang.ref }
		});

		await servedBy(client(store));
		const line = lineBetween(sprang, under, writer);
		await nodes.setLook(line.on.ref, { to: line.other.ref, label: 'objects to' });
		await nodes.setLook(line.on.ref, { to: line.other.ref });

		const read = client(store);
		const canvas = [await noteIn(read, sprang.ref), await noteIn(read, under.ref)];
		expect(canvas.flatMap((note) => note.edges ?? [])).toEqual([]);
		expect(looksOnCanvas(canvas)).toEqual([]);
	});
});

describe('a look somebody offers on a note they do not write', () => {
	it('is still on the offer after they open it again and offer it again', async () => {
		const store = new Map<string, Uint8Array>();
		const owner = client(store);
		await owner.createGraph({ title: 'Thesis' });
		const did = (await owner.me())!.did;
		const sprang = await owner.createNode({ title: 'The opening' });
		const gated = await owner.createNode({
			title: 'The argument',
			from: { relation: 'under', note: sprang.ref }
		});
		await owner.updateNode(gated.ref, { owner: did });
		const second = await holdDeviceIdentity(
			new MemoryFiles({ store, folder: FOLDER }),
			makeLocalIdentity(),
			{ writing: false }
		);
		const helper = client(store, second.did);
		await helper.proposeAmendment({
			note: gated.ref,
			title: 'The argument',
			tags: [],
			edges: [{ to: sprang.ref, label: 'answers', direction: 'to' }],
			blocks: []
		});

		await servedBy(helper);
		await offers.read(gated.ref);
		await offers.hold(gated.ref, { title: 'The argument', tags: [], blocks: [] });
		offers.retitle(gated.ref, 'The argument, clearer');
		await offers.propose(gated.ref, '');

		const standing = (await client(store).listAmendments(gated.ref))[0];
		expect(standing.title).toBe('The argument, clearer');
		expect(standing.edges).toEqual([{ to: sprang.ref, label: 'answers', direction: 'to' }]);

		// And the sheet whoever writes the note reads it on has a row to draw.
		const note = await noteIn(client(store), gated.ref);
		const now: WritingSide = { title: note.title, tags: note.tags, sections: [] };
		const offered: WritingSide = {
			title: standing.title,
			tags: standing.tags,
			edges: standing.edges,
			sections: []
		};
		const apart = looksApart(now, offered);
		expect(apart.map((one) => one.to)).toEqual([sprang.ref]);
		expect(lookInWords(apart[0].look)).toBe('“answers”, →');
	});
});
