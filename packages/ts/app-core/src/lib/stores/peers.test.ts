// What the store does with what a peer's instance answers, and what it still
// shows the reader when half of what it asked for did not arrive.

import type { NodeView, PullView } from '@sloppy/types';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	AT,
	DID,
	holding,
	homeOf,
	node,
	ref,
	useFakeApi,
	VIEWER,
	type FakeApi
} from './fake-api.test-support.js';
import { peers } from './peers.svelte.js';
import { session } from './session.svelte.js';

const AUTHOR = 'did:syr:z6MkpTHR8VNsBxYAAWHut2Geadd9jSLuFvdmsZ2mFmZjMxYZ';

const held: PullView = {
	ref: `${DID}/01JQXR000000000000000000RG`,
	created_by: DID,
	publication: ref(31, AUTHOR),
	version: { ref: ref(32, AUTHOR), sequence: 1, published_at: AT },
	root_address: '1',
	comments: 'anyone',
	source_url: 'http://peer.test',
	created_at: AT,
	updated_at: AT
};

/** A listing page as an instance serves one. One publication per seed, so a
 *  page repeating a seed is a page repeating a publication. */
const listing = (seed: number, nextCursor?: string) => ({
	did: AUTHOR,
	publications: [
		{
			ref: ref(seed, AUTHOR),
			root_address: `${seed}`,
			title: 'A branch',
			latest: { ref: ref(seed + 100, AUTHOR), sequence: 1, published_at: AT }
		}
	],
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
			url.searchParams.get('cursor') === null ? listing(1, '1') : listing(2)
		);

		const first = await peers.publishedBy(AUTHOR);
		expect(first?.publications.map((one) => one.root_address)).toEqual(['1']);
		const second = await peers.publishedBy(AUTHOR, { cursor: first?.next_cursor });
		expect(second?.publications.map((one) => one.root_address)).toEqual(['2']);
		expect(peers.says).toBeNull();
	});

	it('refuses a listing that serves one region twice', async () => {
		api.on('GET /peers/publications', () => listing(1, '1'));

		const first = await peers.publishedBy(AUTHOR);
		expect(first).not.toBeNull();
		expect(await peers.publishedBy(AUTHOR, { cursor: '1' })).toBeNull();
		expect(peers.says).toBe('Sloppy could not read what they publish.');
	});

	it('starts a fresh run for a listing asked for from the top', async () => {
		api.on('GET /peers/publications', () => listing(1, '1'));

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

describe('what the author has published since', () => {
	const chain = (sequence: number) => ({
		publication: held.publication,
		versions: [{ ref: ref(sequence + 40, AUTHOR), sequence, published_at: AT }]
	});

	it('asks the instance the copy came from, and asks it once', async () => {
		api.on('GET /peers/versions', () => chain(3));

		await peers.readChain(held.publication, held.source_url);
		await peers.readChain(held.publication, held.source_url);

		expect(peers.newestOf(held.publication)?.sequence).toBe(3);
		expect(api.countOf('GET /peers/versions')).toBe(1);
		expect(api.calls.at(-1)).toContain(`source_url=${encodeURIComponent('http://peer.test')}`);
	});

	it('says nothing to the reader when their instance does not answer', async () => {
		api.on('GET /peers/versions', () => new Response('{"message":"Not now."}', { status: 503 }));

		expect(await peers.readChain(held.publication, held.source_url)).toBeNull();
		expect(peers.newestOf(held.publication)).toBeUndefined();
		expect(peers.says).toBeNull();
	});

	it('asks again after the copy is taken afresh', async () => {
		let sequence = 3;
		api.on('GET /peers/versions', () => chain(sequence));
		api.on('POST /pulls', () => ({ ...held, version: chain(sequence).versions[0] }));
		api.on('GET /pulls', () => [held]);

		await peers.readChain(held.publication, held.source_url);
		sequence = 4;
		await peers.pull({ publication: held.publication, sourceUrl: held.source_url });
		await peers.readChain(held.publication, held.source_url);

		expect(peers.newestOf(held.publication)?.sequence).toBe(4);
	});

	it('reads what changed where the copy came from', async () => {
		api.on('GET /peers/changes', () => ({
			publication: held.publication,
			root_address: held.root_address,
			from: held.version.ref,
			to: ref(43, AUTHOR),
			changes: []
		}));

		const page = await peers.changesBetween(held.publication, held.version.ref, ref(43, AUTHOR), {
			sourceUrl: held.source_url
		});

		expect(page?.changes).toEqual([]);
		expect(api.calls.at(-1)).toContain(`source_url=${encodeURIComponent('http://peer.test')}`);
	});
});

describe('a note somebody else wrote, cited to the reader', () => {
	const theirs: NodeView = {
		...node(12, '1a'),
		ref: ref(12, AUTHOR),
		created_by: AUTHOR,
		graph: homeOf(AUTHOR),
		origin: ref(12, AUTHOR),
		published: true
	};

	it('answers with the region holding it, and keeps that region', async () => {
		holding(api, [{ note: theirs, pull: held }]);

		const hit = await peers.heldNote(theirs.ref);

		expect(hit?.pull.ref).toBe(held.ref);
		expect(peers.region(held.ref)).toBeDefined();
	});

	it('answers with nothing where the reader holds no copy of it', async () => {
		api.on(
			`GET /pulls/nodes/${encodeURIComponent(AUTHOR)}/${theirs.ref.split('/')[1]}`,
			() => null
		);

		expect(await peers.heldNote(theirs.ref)).toBeNull();
	});
});

describe('whoever was typed into the peer field', () => {
	it('takes an identifier as itself, without asking anybody', async () => {
		expect(await peers.identify(AUTHOR)).toBe(AUTHOR);
		expect(api.calls).toHaveLength(0);
	});

	it('looks a name up, and holds whoever it is answered with', async () => {
		api.on('GET /peers/identity', () => ({ did: AUTHOR }));

		expect(await peers.identify('alice')).toBe(AUTHOR);
	});

	// A name is kept somewhere, and the reader was told where along with it.
	it('asks the instance the name carries, and never the peer’s server itself', async () => {
		api.on('GET /peers/identity', () => ({ did: AUTHOR }));

		expect(await peers.identify('alice@peer.example')).toBe(AUTHOR);
		const asked = api.calls.find((call) => call.startsWith('GET /peers/identity'));
		const query = new URL(asked!, 'http://api.test').searchParams;
		expect(query.get('name')).toBe('alice');
		expect(query.get('source_url')).toBe('https://peer.example');
	});

	// The surface asks for who and where on two lines, so it hands over two.
	it('asks where it was told to, where the name carries nowhere', async () => {
		api.on('GET /peers/identity', () => ({ did: AUTHOR }));

		expect(await peers.identify('alice', 'https://peer.example')).toBe(AUTHOR);
		const asked = api.calls.find((call) => call.startsWith('GET /peers/identity'));
		const query = new URL(asked!, 'http://api.test').searchParams;
		expect(query.get('name')).toBe('alice');
		expect(query.get('source_url')).toBe('https://peer.example');
	});

	it('takes the instance written into the name over the one it was told', async () => {
		api.on('GET /peers/identity', () => ({ did: AUTHOR }));

		expect(await peers.identify('alice@peer.example', 'https://elsewhere.example')).toBe(AUTHOR);
		const asked = api.calls.find((call) => call.startsWith('GET /peers/identity'));
		const query = new URL(asked!, 'http://api.test').searchParams;
		expect(query.get('source_url')).toBe('https://peer.example');
	});

	it('takes an identifier written beside an instance as itself', async () => {
		expect(await peers.identify(`${AUTHOR}@peer.example`)).toBe(AUTHOR);
		expect(api.calls).toHaveLength(0);
	});

	it('says what an instance address looks like where what follows the name is not one', async () => {
		expect(await peers.identify('alice@not a place')).toBeNull();
		expect(peers.says).toContain('instance address');
		expect(api.calls).toHaveLength(0);
	});

	it('says what to try instead where the lookup said nothing a person can read', async () => {
		api.on('GET /peers/identity', () => new Response('', { status: 502 }));

		expect(await peers.identify('nobody')).toBeNull();
		expect(peers.says).toContain('identifier');
	});

	// The API says who is not there in words meant for a person; a second line
	// written here would talk over it.
	it('passes on what the server said about a name nobody answers to', async () => {
		api.on(
			'GET /peers/identity',
			() =>
				new Response(JSON.stringify({ message: 'Nobody there goes by that name.' }), {
					status: 404
				})
		);

		expect(await peers.identify('ghost@peer.example')).toBeNull();
		expect(peers.says).toBe('Nobody there goes by that name.');
	});
});
