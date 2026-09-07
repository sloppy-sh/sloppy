import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodes } from './nodes.svelte.js';
import { homeGraphRef, type NodeView, type OwnedRef } from '@sloppy/types';
import { deviceStore } from '../device-store.js';
import { session } from './session.svelte.js';
import {
	DID,
	moving,
	node,
	ref,
	useFakeApi,
	VIEWER,
	type FakeApi
} from './fake-api.test-support.js';

const ROOT = ref(1);
const OTHER_ROOT = ref(4);
const SOMEONE_ELSE = 'did:syr:z6MkBramBramBramBramBramBramBram';

/** The two path segments `@sloppy/client` binds a reference as. */
function path(of: OwnedRef): string {
	const cut = of.lastIndexOf('/');
	return `/nodes/${encodeURIComponent(of.slice(0, cut))}/${encodeURIComponent(of.slice(cut + 1))}`;
}

/** One tree under ROOT — `1`, `1a`, `1a1` — plus a second root beside it. */
const TREE = [
	node(1, '1'),
	node(2, '1a', { origin: ROOT, parent: ROOT }),
	node(3, '1a1', { origin: ROOT, parent: ref(2) }),
	node(4, '2')
];

let api: FakeApi;

/** What the device holds of `graph`, once it holds what `until` is waiting for —
 *  the cache waits out the answers before it writes. */
async function keptNotes(
	graph: OwnedRef,
	until: (held: NodeView[]) => boolean = (held) => held.length > 0
): Promise<NodeView[]> {
	const area = deviceStore.area(DID, 'notes');
	let held: NodeView[] = [];
	for (let turn = 0; turn < 40; turn += 1) {
		held = (await area.get<NodeView[]>(graph)) ?? [];
		if (until(held)) return held;
		await new Promise((done) => setTimeout(done, 25));
	}
	return held;
}

beforeEach(() => {
	nodes.clear();
	api = useFakeApi();
	// The cache is one identity's, so the store has to know whose these are.
	session.adopt(VIEWER, 'a-session');
	api.on('GET /nodes', (url) => {
		const origin = url.searchParams.get('origin');
		const maxDepth = url.searchParams.get('max_depth');
		return TREE.filter(
			(n) =>
				(origin === null ? n.ref === n.origin : n.origin === origin) &&
				(maxDepth === null || n.depth <= Number(maxDepth))
		);
	});
});

afterEach(() => {
	session.clear();
});

describe('the node cache', () => {
	it('answers a region with no origin with the roots, not with everything', async () => {
		await nodes.load();
		expect(nodes.region().map((n) => n.address)).toEqual(['1', '2']);
	});

	it('answers a region under an origin in address order, bounded by depth', async () => {
		await nodes.load({ origin: ROOT });
		expect(nodes.region({ origin: ROOT }).map((n) => n.address)).toEqual(['1', '1a', '1a1']);
		expect(nodes.region({ origin: ROOT, maxDepth: 2 }).map((n) => n.address)).toEqual(['1', '1a']);
	});

	it('issues one request when two surfaces ask for the same region at once', async () => {
		await Promise.all([nodes.load({ origin: ROOT }), nodes.load({ origin: ROOT })]);
		expect(api.countOf('GET /nodes')).toBe(1);
	});

	it('issues none at all once a region is loaded', async () => {
		await nodes.load({ origin: ROOT });
		await nodes.load({ origin: ROOT });
		expect(api.countOf('GET /nodes')).toBe(1);
	});

	it('treats regions with different bounds as different regions', async () => {
		await nodes.load({ origin: ROOT });
		await nodes.load({ origin: ROOT, maxDepth: 2 });
		expect(api.countOf('GET /nodes')).toBe(2);
	});

	it('reports a failed region without claiming it loaded', async () => {
		api.on('GET /nodes', () => {
			throw new Error('unreachable');
		});
		nodes.clear();
		await expect(nodes.load({ origin: OTHER_ROOT })).rejects.toThrow();
		const status = nodes.status({ origin: OTHER_ROOT });
		expect(status).toMatchObject({ loading: false, loaded: false, failed: true });
	});

	it('is not repopulated by an answer that lands after it was cleared', async () => {
		let answer!: () => void;
		const held = new Promise<void>((resolve) => (answer = resolve));
		api.on('GET /nodes', async () => {
			await held;
			return TREE;
		});
		const asking = nodes.load({ origin: ROOT });
		nodes.clear();
		answer();
		await asking;
		expect(nodes.region({ origin: ROOT })).toEqual([]);
	});

	it('is not repopulated by a node whose creation lands after it was cleared', async () => {
		let answer!: () => void;
		const held = new Promise<void>((resolve) => (answer = resolve));
		api.on('POST /nodes', async () => {
			await held;
			return node(9, '3');
		});
		const creating = nodes.create({ title: 'a thought' });
		nodes.clear();
		answer();
		await creating;
		expect(nodes.region()).toEqual([]);
	});

	it('lists children in address order', async () => {
		await nodes.load({ origin: ROOT });
		expect(nodes.children(ROOT).map((n) => n.address)).toEqual(['1a']);
		expect(nodes.children(ref(2)).map((n) => n.address)).toEqual(['1a1']);
	});

	it('drops a forgotten node and everything under it', async () => {
		await nodes.load({ origin: ROOT });
		nodes.forget(ref(2));
		expect(nodes.get(ref(2))).toBeUndefined();
		expect(nodes.get(ref(3))).toBeUndefined();
		expect(nodes.get(ROOT)).toBeDefined();
	});

	it('is not repopulated by a node created just before it was cleared', async () => {
		let answer!: () => void;
		const held = new Promise<void>((resolve) => (answer = resolve));
		api.on('POST /nodes', async () => {
			await held;
			return node(9, '3');
		});
		const creating = nodes.create({ title: 'a thought' });
		nodes.clear();
		answer();
		await creating;
		expect(nodes.get(ref(9))).toBeUndefined();
	});

	it('issues one request when two surfaces ask for the same node at once', async () => {
		api.on(`GET ${path(ROOT)}`, () => node(1, '1'));
		await Promise.all([nodes.fetch(ROOT), nodes.fetch(ROOT)]);
		expect(api.countOf(`GET ${path(ROOT)}`)).toBe(1);
	});

	// A note's row moves under a surface that has already asked for it — what its
	// writing names is derived server-side, so a block write changes the row
	// without anybody touching it. The answer in the air was read before that.
	it('asks again for a node where the ask in flight was read before the change', async () => {
		let answer!: () => void;
		const held = new Promise<void>((resolve) => (answer = resolve));
		let asks = 0;
		api.on(`GET ${path(ROOT)}`, async () => {
			asks += 1;
			if (asks === 1) await held;
			return node(1, '1', { title: asks === 1 ? 'as it was' : 'as it now is' });
		});

		const asking = nodes.fetch(ROOT);
		const again = nodes.refetch(ROOT);
		answer();
		await asking;
		await again;

		expect(asks).toBe(2);
		expect(nodes.get(ROOT)?.title).toBe('as it now is');
	});

	it('keeps a sibling whose address merely starts with the same characters', async () => {
		nodes.clear();
		api.on('GET /nodes', () => [
			node(1, '1'),
			node(2, '1a', { origin: ROOT, parent: ROOT }),
			node(5, '1ab', { origin: ROOT, parent: ROOT })
		]);
		await nodes.load({ origin: ROOT });
		nodes.forget(ref(2));
		expect(nodes.get(ref(5))).toBeDefined();
	});
});

describe('a note asked for', () => {
	const WRITTEN = ref(9);

	it('answers with the trip, and caches the note once the address is assigned', async () => {
		let give: (value: NodeView) => void = () => {};
		api.on('POST /nodes', () => new Promise<NodeView>((settle) => (give = settle)));

		const writing = nodes.write({});
		expect(nodes.get(WRITTEN)).toBeUndefined();

		give(node(9, '3'));
		expect((await writing.note).ref).toBe(WRITTEN);
		expect(nodes.get(WRITTEN)?.address).toBe('3');
	});

	it('asks for the same note again, and only once more', async () => {
		const asked: unknown[] = [];
		api.on('POST /nodes', (_url, init) => {
			asked.push(JSON.parse(String(init?.body)));
			if (asked.length === 1) {
				return new Response('{"message":"That note would not go."}', {
					status: 400,
					headers: { 'content-type': 'application/json' }
				});
			}
			return node(9, '3');
		});

		const writing = nodes.write({ title: 'Membranes' });
		await expect(writing.note).rejects.toThrow();

		const again = writing.again();
		expect((await again.note).address).toBe('3');
		expect(asked).toEqual([{ title: 'Membranes' }, { title: 'Membranes' }]);
	});
});

describe('the graph this device kept', () => {
	const HOME = homeGraphRef(DID);

	it('draws again with nothing to ask', async () => {
		await nodes.load();
		await nodes.load({ origin: ROOT });
		await keptNotes(HOME);

		nodes.clear();
		api.on('GET /nodes', () => {
			throw new Error('nothing is listening');
		});
		await nodes.restore();

		expect(nodes.region().map((n) => n.address)).toEqual(['1', '2']);
		expect(nodes.region({ origin: ROOT }).map((n) => n.address)).toEqual(['1', '1a', '1a1']);
	});

	it('keeps nothing for anybody but the person signed in', async () => {
		await nodes.load();
		await keptNotes(HOME);

		await expect(deviceStore.area(SOMEONE_ELSE, 'notes').keys()).resolves.toEqual([]);
	});

	it('shows the note the server answers with, never the one it kept', async () => {
		await nodes.load();
		await keptNotes(HOME);
		nodes.clear();

		api.on('GET /nodes', () => [node(1, '1', { title: 'as it now is' }), node(4, '2')]);
		await nodes.load();
		await nodes.restore();

		expect(nodes.get(ROOT)?.title).toBe('as it now is');
	});

	// A note deleted from another device is gone, and the copy this one kept is
	// the only thing that would say otherwise.
	it('lets go of a note the graph came back without', async () => {
		await nodes.load();
		await keptNotes(HOME);
		nodes.clear();

		api.on('GET /nodes', (url) => (url.searchParams.get('origin') ? [] : [node(1, '1')]));
		await nodes.restore();
		expect(nodes.region().map((n) => n.address)).toEqual(['1', '2']);

		await nodes.load();
		expect(nodes.region().map((n) => n.address)).toEqual(['1']);
		expect(nodes.get(OTHER_ROOT)).toBeUndefined();
	});

	it('keeps a note it went on to write, and lets go of one it deleted', async () => {
		api.on('POST /nodes', () => node(9, '3'));
		await nodes.load();
		await nodes.create({ title: 'a thought' });
		expect((await keptNotes(HOME)).map((n) => n.address)).toContain('3');

		api.on(`DELETE ${path(ref(9))}`, () => undefined);
		await nodes.remove(ref(9));
		const after = await keptNotes(HOME, (held) => held.every((n) => n.address !== '3'));
		expect(after.map((n) => n.address)).not.toContain('3');
	});

	// The kept copy is the older one either way round, so which of the two lands
	// first must not decide whether a deleted note comes back.
	it('lets go of a note the graph came back without, whichever answered first', async () => {
		await nodes.load();
		await keptNotes(HOME);
		nodes.clear();

		api.on('GET /nodes', (url) => (url.searchParams.get('origin') ? [] : [node(1, '1')]));
		await nodes.reload();
		await nodes.restore();

		expect(nodes.region().map((n) => n.address)).toEqual(['1']);
		expect(nodes.get(OTHER_ROOT)).toBeUndefined();
	});
});

describe('a note carried somewhere else', () => {
	it('reads the subtree at the addresses the move gave it, out of the tree it left', async () => {
		await nodes.load({ origin: ROOT });
		moving(api, ref(2), () => [
			node(2, '2a', { origin: OTHER_ROOT, parent: OTHER_ROOT, aliases: ['1a'] }),
			node(3, '2a1', { origin: OTHER_ROOT, parent: ref(2), aliases: ['1a1'] })
		]);

		const moved = await nodes.move(ref(2), { relation: 'under', note: OTHER_ROOT });

		expect(moved.map((n) => n.address)).toEqual(['2a', '2a1']);
		expect(nodes.get(ref(2))?.address).toBe('2a');
		expect(nodes.get(ref(3))?.address).toBe('2a1');
		// The run it left is the two notes still under ROOT's tree, and neither of
		// them is where the moved one was.
		expect(nodes.region({ origin: ROOT }).map((n) => n.address)).toEqual(['1']);
		expect(nodes.children(OTHER_ROOT).map((n) => n.address)).toEqual(['2a']);
	});

	it('says the addresses the note is still answered by', async () => {
		await nodes.load({ origin: ROOT });
		moving(api, ref(2), () => [
			node(2, '2a', { origin: OTHER_ROOT, parent: OTHER_ROOT, aliases: ['1a'] })
		]);

		await nodes.move(ref(2), { relation: 'after', note: ref(4) });

		expect(nodes.get(ref(2))?.aliases).toEqual(['1a']);
		expect(nodes.get(ROOT)?.aliases).toBeUndefined();
	});

	it('carries what the move was asked for to the route', async () => {
		let asked: unknown;
		moving(api, ref(2), (to) => {
			asked = to;
			return [node(2, '2a', { origin: OTHER_ROOT, parent: OTHER_ROOT })];
		});

		await nodes.move(ref(2), { relation: 'after', note: ref(4) });

		expect(asked).toEqual({ relation: 'after', note: ref(4) });
	});

	it('is not taken into a cache the next person is already using', async () => {
		await nodes.load({ origin: ROOT });
		let answer!: () => void;
		const held = new Promise<void>((resolve) => (answer = resolve));
		api.on(`POST ${path(ref(2))}/move`, async () => {
			await held;
			return [node(2, '2a', { origin: OTHER_ROOT, parent: OTHER_ROOT })];
		});
		const carrying = nodes.move(ref(2), { relation: 'under', note: OTHER_ROOT });
		nodes.clear();
		answer();
		await carrying;
		expect(nodes.get(ref(2))).toBeUndefined();
	});
});
