import { DELETED_KEPT_FOR_DAYS, type NodeView, type OwnedRef } from '@sloppy/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deletionCost, timeToPutBack } from './deletion.js';
import { node, ref, useFakeApi, type FakeApi } from './stores/fake-api.test-support.js';
import { nodes } from './stores/nodes.svelte.js';

const ROOT = ref(1);
const UNDER = ref(2);

/** A tree the store has actually read, which is what lets a count be named. */
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

let api: FakeApi;

beforeEach(() => {
	nodes.clear();
	api = useFakeApi();
});

afterEach(() => {
	nodes.clear();
});

describe('what a person is told before deleting', () => {
	it('names how many notes go with the one they chose, and what they can do next', async () => {
		await loaded(branch(), under());

		expect(deletionCost([ROOT])).toBe(
			`It goes, and so does the one note that grew out of it. You can put it back from What you deleted for ${DELETED_KEPT_FOR_DAYS} days.`
		);
	});

	it('names no number for a branch nothing has counted yet', () => {
		expect(deletionCost([ROOT])).toBe(
			`It goes, and so does everything written under it. You can put it back from What you deleted for ${DELETED_KEPT_FOR_DAYS} days.`
		);
	});

	it('says what a published branch cannot take back', async () => {
		await loaded(branch({ published: true }), under({ published: true }));

		expect(deletionCost([ROOT])).toContain(
			'It is published — whoever already has it keeps their copy.'
		);
	});

	it('says so when it is something under the chosen note that is published', async () => {
		await loaded(branch(), under({ published: true }));

		expect(deletionCost([ROOT])).toContain(
			'Something under it is published — whoever already has it keeps their copy.'
		);
	});

	it('says nothing about publishing where nothing going is out', async () => {
		await loaded(branch(), under());

		expect(deletionCost([ROOT])).not.toContain('published');
	});

	it('speaks of a chosen set as a set', async () => {
		await loaded(branch({ published: true }), under());

		expect(deletionCost([ROOT, UNDER] as OwnedRef[])).toBe(
			`They go. Some of these are published — whoever already has them keeps their copy. You can put them back from What you deleted for ${DELETED_KEPT_FOR_DAYS} days.`
		);
	});
});

describe('how long is left to put a branch back', () => {
	const at = Date.UTC(2026, 0, 31);
	const deletedAt = new Date(Date.UTC(2026, 0, 1)).toISOString();

	it('counts the days that are left', () => {
		expect(timeToPutBack(deletedAt, Date.UTC(2026, 0, 11))).toBe('20 days left');
	});

	it('says so on the last of them', () => {
		expect(timeToPutBack(deletedAt, at)).toBe('Today is the last day');
	});
});
