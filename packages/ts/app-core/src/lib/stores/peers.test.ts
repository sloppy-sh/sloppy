// What the store does with what a peer's instance answers, and what it still
// shows the reader when half of what it asked for did not arrive.

import type { PullView } from '@sloppy/types';
import { beforeEach, describe, expect, it } from 'vitest';
import { AT, DID, useFakeApi, VIEWER, type FakeApi } from './fake-api.test-support.js';
import { peers } from './peers.svelte.js';
import { session } from './session.svelte.js';

const AUTHOR = 'did:syr:z6MkpTHR8VNsBxYAAWHut2Geadd9jSLuFvdmsZ2mFmZjMxYZ';

const held: PullView = {
	ref: `${DID}/01JQXR000000000000000000RG`,
	created_by: DID,
	source_did: AUTHOR,
	root_address: '1',
	source_url: 'http://peer.test',
	created_at: AT,
	updated_at: AT
};

/** A listing page as an instance serves one. */
const listing = (address: string, nextCursor?: string) => ({
	did: AUTHOR,
	roots: [{ root_address: address, title: 'A branch', updated_at: AT }],
	...(nextCursor === undefined ? {} : { next_cursor: nextCursor })
});

let api: FakeApi;

beforeEach(() => {
	api = useFakeApi();
	peers.clear();
	session.adopt(VIEWER, 'a-token');
});

describe('what somebody publishes', () => {
	it('walks a listing page by page', async () => {
		api.on('GET /peers/publications', (url) =>
			url.searchParams.get('cursor') === null ? listing('1', '1') : listing('2')
		);

		const first = await peers.publishedBy(AUTHOR);
		expect(first?.roots.map((root) => root.root_address)).toEqual(['1']);
		const second = await peers.publishedBy(AUTHOR, { cursor: first?.next_cursor });
		expect(second?.roots.map((root) => root.root_address)).toEqual(['2']);
		expect(peers.says).toBeNull();
	});

	it('refuses a listing that serves one region twice', async () => {
		api.on('GET /peers/publications', () => listing('1', '1'));

		const first = await peers.publishedBy(AUTHOR);
		expect(first).not.toBeNull();
		expect(await peers.publishedBy(AUTHOR, { cursor: '1' })).toBeNull();
		expect(peers.says).toBe('Sloppy could not read what they publish.');
	});

	it('starts a fresh run for a listing asked for from the top', async () => {
		api.on('GET /peers/publications', () => listing('1', '1'));

		expect(await peers.publishedBy(AUTHOR)).not.toBeNull();
		expect(await peers.publishedBy(AUTHOR)).not.toBeNull();
	});
});

describe('the lists the reader opens onto', () => {
	it('holds the regions when the follow list cannot be read', async () => {
		api.on('GET /following', () => new Response('{"message":"Not now."}', { status: 503 }));
		api.on('GET /pulls', () => [held]);

		await peers.load();

		expect(peers.regions).toHaveLength(1);
		expect(peers.region(held.ref)).toBeDefined();
		expect(peers.loaded).toBe(false);
		expect(peers.says).toBe('Not now.');
	});

	it('asks again only for the half that is still missing', async () => {
		let answering = false;
		api.on('GET /following', () =>
			answering ? [] : new Response('{"message":"Not now."}', { status: 503 })
		);
		api.on('GET /pulls', () => [held]);

		await peers.load();
		answering = true;
		await peers.load();

		expect(peers.loaded).toBe(true);
		expect(api.countOf('GET /pulls')).toBe(1);
		expect(api.countOf('GET /following')).toBe(2);
	});
});
