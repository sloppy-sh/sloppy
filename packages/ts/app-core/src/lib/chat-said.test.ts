import { DELETED_KEPT_FOR_DAYS, type NodeView } from '@sloppy/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { askedOf, readCall } from './chat-said.js';
import { node, ref, useFakeApi, type FakeApi } from './stores/fake-api.test-support.js';
import { nodes } from './stores/nodes.svelte.js';

const ROOT = ref(1);

async function loaded(...tree: NodeView[]): Promise<void> {
	api.on('GET /nodes', () => tree);
	await nodes.load({ origin: tree[0].ref });
}

const branch = (over: Partial<NodeView> = {}): NodeView => ({ ...node(1, '1'), ...over });
const under = (over: Partial<NodeView> = {}): NodeView => ({
	...node(2, '1a'),
	origin: ROOT,
	parent: ROOT,
	...over
});

const asked = (note = ROOT) => readCall('c1', 'delete_note', { note });

let api: FakeApi;

beforeEach(() => {
	nodes.clear();
	api = useFakeApi();
});

afterEach(() => {
	nodes.clear();
});

describe('the question standing in front of a delete an agent asks for', () => {
	it('tells the person what the note page tells them', async () => {
		await loaded(branch({ published: true }), under());

		expect(askedOf(asked(), () => '1 “Seeds”')).toBe(
			`It wants to put 1 “Seeds” in the bin. It goes, and so does the one note that grew out of it. It is published — whoever already has it keeps their copy. You can put it back from Your graphs for ${DELETED_KEPT_FOR_DAYS} days.`
		);
	});

	it('names no number for a branch the surface has not read', () => {
		expect(askedOf(asked(), () => undefined)).toBe(
			`It wants to put a note in the bin. It goes, and so does everything written under it. You can put it back from Your graphs for ${DELETED_KEPT_FOR_DAYS} days.`
		);
	});
});
