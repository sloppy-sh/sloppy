import type { DeletedBranch, OwnedRef } from '@sloppy/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deleted } from './deleted.svelte.js';
import { session } from './session.svelte.js';
import { AT, DID, node, ref, useFakeApi, VIEWER, type FakeApi } from './fake-api.test-support.js';

function refPath(of: string): string {
	const cut = of.lastIndexOf('/');
	return `/${encodeURIComponent(of.slice(0, cut))}/${encodeURIComponent(of.slice(cut + 1))}`;
}

const HOME = `${DID}/00000000000000000000000000` as OwnedRef;
const BRANCH = ref(31);
const ANOTHER = ref(32);

function branch(of: OwnedRef, address: string, notes: number): DeletedBranch {
	return { ref: of, address, graph: HOME, title: address, deleted_at: AT, notes };
}

const LISTED: DeletedBranch[] = [branch(BRANCH, '1a', 12), branch(ANOTHER, '2', 1)];

let api: FakeApi;

beforeEach(async () => {
	deleted.clear();
	api = useFakeApi();
	api.on('GET /auth/me', () => VIEWER);
	api.on('GET /nodes/deleted', () => LISTED);
	await session.refresh();
});

afterEach(() => {
	session.clear();
	deleted.clear();
});

describe('the branches somebody can still put back', () => {
	it('answers the listing, and asks once however many surfaces call it', async () => {
		await Promise.all([deleted.load(), deleted.load()]);

		expect(deleted.all).toEqual(LISTED);
		expect(api.countOf('GET /nodes/deleted')).toBe(1);
	});

	it("keeps the server's own words when the listing fails", async () => {
		api.on(
			'GET /nodes/deleted',
			() => new Response('{"message":"Not right now."}', { status: 503 })
		);

		await expect(deleted.load()).rejects.toThrow();
		expect(deleted.state.error).toBe('Not right now.');
		expect(deleted.all).toEqual([]);
	});

	it('takes one out of the listing once it is back', async () => {
		await deleted.load();
		api.on(`POST /nodes${refPath(BRANCH)}/restore`, () => node(31, '1a'));

		const back = await deleted.restore(BRANCH);

		expect(back.ref).toBe(BRANCH);
		expect(deleted.all.map((one) => one.ref)).toEqual([ANOTHER]);
	});

	it('shows nobody what the person before them deleted', async () => {
		await deleted.load();
		expect(deleted.all).toEqual(LISTED);

		session.clear();

		expect(deleted.all).toEqual([]);
	});
});
