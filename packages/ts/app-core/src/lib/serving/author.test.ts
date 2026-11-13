import { MemoryFiles, servingProjects } from '@sloppy/local';
import {
	AUTHOR_READ,
	type AuthorRead,
	NOT_PUBLIC_SAID,
	type Principal,
	type ProfileView,
	SERVE_REFUSALS,
	UNRESOLVED_ENAME,
	type W3id
} from '@sloppy/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetApi } from '../api.js';
import { initRuntime, updateRuntime } from '../runtime.js';
import { type FakeApi, useFakeApi } from '../stores/fake-api.test-support.js';
import { people } from '../stores/people.svelte.js';
import { type AuthorSources, authorMethods, deskAuthors, type Who, whoIs } from './author.js';
import { servedMethods } from './methods.js';
import './served.js';

const ADA = 'w3id:@0f6b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
const HIDDEN = 'w3id:@0f6b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2e';
const GONE = 'w3id:@0f6b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2f';
const FACE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const SMALLER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9]);

function aDesk(sources: AuthorSources) {
	const loop = servingProjects(
		[
			{
				id: 'garden',
				name: 'garden',
				server: { version: '1', files: new MemoryFiles({ root: '/g', data: '/g-data' }) }
			}
		],
		{ methods: authorMethods(sources) }
	);
	let id = 0;
	return async (principal: unknown): Promise<Record<string, unknown>> => {
		id += 1;
		const answers: Record<string, unknown>[] = [];
		loop.take(
			JSON.stringify({ jsonrpc: '2.0', id, method: AUTHOR_READ, params: { principal } }),
			(line) => answers.push(JSON.parse(line))
		);
		await loop.settled();
		return answers[0];
	};
}

function knowing(named: Record<string, Who>): AuthorSources {
	return {
		whoIs: async (principal: Principal) => named[principal] ?? 'unreached',
		scaled: async (face) => (face.bytes === FACE ? SMALLER : undefined)
	};
}

function decoded(read: AuthorRead): number[] {
	return [...atob(read.picture ?? '')].map((letter) => letter.charCodeAt(0));
}

describe('who a note’s author is, read for a headset', () => {
	it('answers their name, handle and face, the face made small', async () => {
		const ask = aDesk(
			knowing({
				[ADA]: { name: 'Ada', handle: 'ada', avatar: { bytes: FACE, mime: 'image/jpeg' } }
			})
		);

		const answer = (await ask(ADA)).result as AuthorRead;

		expect(answer.name).toBe('Ada');
		expect(answer.handle).toBe('ada');
		expect(decoded(answer)).toEqual([...SMALLER]);
	});

	it('answers somebody with no name and no face as nothing more than that', async () => {
		const ask = aDesk(
			knowing({
				'mailto:sam@example.org': {},
				[ADA]: { name: 'Ada', avatar: { bytes: new Uint8Array([1]), mime: 'image/svg+xml' } }
			})
		);

		expect((await ask('mailto:sam@example.org')).result).toEqual({});
		expect((await ask(ADA)).result).toEqual({ name: 'Ada' });
	});

	it('names a profile that is not public, or could not be reached, as an unresolvable eName', async () => {
		const ask = aDesk(knowing({ [HIDDEN]: 'not-public' }));

		expect((await ask(HIDDEN)).result).toEqual({ name: UNRESOLVED_ENAME });
		expect((await ask(GONE)).result).toEqual({ name: UNRESOLVED_ENAME });
		expect((await ask('nobody at all')).error).toMatchObject({
			code: SERVE_REFUSALS.UNREACHED
		});
	});

	it('answers alongside the project’s reads, not behind them', () => {
		expect(servedMethods[AUTHOR_READ]?.queued).toBe(false);
	});
});

describe('an author named the way the desk names them', () => {
	const PEER = 'did:syr:z6MkjChhrJfLm9WGVUAnyLPnfPGmZDcyDKNsBTsAsn7RkAqB';
	const STRANGER = 'did:syr:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH';
	const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
	const CHARLES: ProfileView = {
		did: PEER,
		username: 'charles',
		display_name: 'Charles Babbage',
		bio: null,
		avatar_src: '/proxy?ref=charles',
		banner_src: null
	};
	let api: FakeApi;
	let reached: string[];
	let profile: () => Response;

	beforeEach(() => {
		people.hold(null);
		api = useFakeApi();
		api.on(`GET /profile/${encodeURIComponent(PEER)}`, () => CHARLES);
		api.on('GET /proxy', () => new Response(PNG, { headers: { 'content-type': 'image/png' } }));
		reached = [];
		profile = () =>
			Response.json({
				data: {
					metaEnvelopes: {
						edges: [{ node: { parsed: { displayName: 'Ada Lovelace', username: 'ada' } } }]
					}
				}
			});
		updateRuntime({
			reachOut: async (url: string) => {
				reached.push(url);
				if (url.includes('/resolve')) return Response.json({ uri: 'http://203.0.113.7:4000' });
				return profile();
			}
		});
	});

	afterEach(() => {
		updateRuntime({ reachOut: undefined });
		initRuntime({ apiHost: () => 'http://api.test', createApi: undefined });
		resetApi();
		people.hold(null);
	});

	it('names a W3ID author from the people store, which the desk then names them from', async () => {
		expect(await whoIs(ADA)).toEqual({ name: 'Ada Lovelace', handle: 'ada' });
		await whoIs(ADA);

		expect(people.of(ADA)?.displayName).toBe('Ada Lovelace');
		expect(reached.filter((url) => url.includes('/resolve'))).toHaveLength(1);
	});

	it('says a W3ID author’s profile is not public where the people store does', async () => {
		profile = () => Response.json({ errors: [{ message: 'Authentication required' }] });
		const ask = aDesk(deskAuthors);

		expect((await ask(ADA)).result).toEqual({ name: UNRESOLVED_ENAME });
		expect(people.said(ADA as W3id)).toBe(NOT_PUBLIC_SAID);
	});

	it('names a syr author with their face from the people store, asking once', async () => {
		const named = await whoIs(PEER);

		expect(named).toMatchObject({ name: 'Charles Babbage', handle: 'charles' });
		expect(typeof named === 'object' && [...(named.avatar?.bytes ?? [])]).toEqual([...PNG]);
		await whoIs(PEER);
		expect(people.of(PEER)?.handle).toBe('charles');
		expect(api.countOf(`GET /profile/${encodeURIComponent(PEER)}`)).toBe(1);
	});

	it('answers a syr author nobody can name as nobody named, and one unanswered as unreached', async () => {
		expect(await whoIs(STRANGER)).toEqual({});
		api.on(
			`GET /profile/${encodeURIComponent(PEER)}`,
			() => new Response('{"message":"Try again."}', { status: 503 })
		);
		expect(await whoIs(PEER)).toBe('unreached');
	});

	it('answers a mail address as nobody named', async () => {
		expect(await whoIs('mailto:sam@example.org')).toEqual({});
	});
});
