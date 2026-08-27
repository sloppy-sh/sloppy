import { beforeEach, describe, expect, it } from 'vitest';
import { nodes } from './nodes.svelte.js';
import { node, ref, useFakeApi, type FakeApi } from './fake-api.test-support.js';

const ROOT = ref(1);
const OTHER_ROOT = ref(4);

/** One tree under ROOT — `1`, `1a`, `1a1` — plus a second root beside it. */
const TREE = [
	node(1, '1'),
	node(2, '1a', { origin: ROOT, parent: ROOT }),
	node(3, '1a1', { origin: ROOT, parent: ref(2) }),
	node(4, '2')
];

let api: FakeApi;

beforeEach(() => {
	nodes.clear();
	api = useFakeApi();
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
