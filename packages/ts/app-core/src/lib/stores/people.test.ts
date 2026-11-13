import { serverOnly, type SloppyApi } from '@sloppy/client';
import {
	NOT_PUBLIC_SAID,
	type ProfileView,
	UNREACHED_SAID,
	UNRESOLVED_ENAME,
	type W3id
} from '@sloppy/types';
import { DEFAULT_AVATAR } from '@sloppy/ui';
import { nameOr } from '@sloppy/ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetApi } from '../api.js';
import { initRuntime, updateRuntime } from '../runtime.js';
import { DID, useFakeApi, type FakeApi } from './fake-api.test-support.js';
import { people, UNREACHED_FOR_MS } from './people.svelte.js';
import { prefs, W3ID_REGISTRY } from './prefs.svelte.js';

const PEER = 'did:syr:z6MkjChhrJfLm9WGVUAnyLPnfPGmZDcyDKNsBTsAsn7RkAqB';

/** As it reaches the server: an address is one path segment, colons and all. */
const asked = (did: string) => `GET /profile/${encodeURIComponent(did)}`;

const ME: ProfileView = {
	did: DID,
	username: 'ada',
	display_name: 'Ada Lovelace',
	bio: null,
	avatar_src: '/proxy?ref=my-avatar',
	banner_src: null
};

const THEM: ProfileView = {
	did: PEER,
	username: 'charles',
	display_name: null,
	bio: null,
	avatar_src: null,
	banner_src: null
};

/** Past the read the store issues and the answer it stores. */
async function settle(): Promise<void> {
	for (let turn = 0; turn < 3; turn += 1) await new Promise((done) => setTimeout(done, 0));
}

let api: FakeApi;

beforeEach(() => {
	people.hold(null);
	api = useFakeApi();
	api.on('GET /profile/me', () => ME);
	api.on(asked(PEER), () => THEM);
});

afterEach(() => {
	initRuntime({ apiHost: () => 'http://api.test', createApi: undefined });
	resetApi();
});

describe('who somebody is', () => {
	it('asks the identity store once, however many surfaces want the answer', async () => {
		await Promise.all([people.read(), people.read()]);
		await people.read();
		expect(api.countOf('GET /profile/me')).toBe(1);
	});

	it('renders a picture through the proxy rather than from where it is held', async () => {
		await people.read();
		expect(people.of(DID)?.avatar).toContain('/api/proxy?ref=my-avatar');
	});

	it('names somebody else from their address, and asks for them once', async () => {
		people.resolve(PEER);
		people.resolve(PEER);
		await settle();
		people.resolve(PEER);
		expect(people.of(PEER)?.handle).toBe('charles');
		expect(api.countOf(asked(PEER))).toBe(1);
	});

	it('answers the signed-in person from what it holds, without asking again', async () => {
		await people.read();
		people.resolve(DID);
		await settle();
		expect(people.of(DID)?.displayName).toBe('Ada Lovelace');
		expect(api.countOf(asked(DID))).toBe(0);
	});

	// An identity this instance cannot resolve is a name the surface does without.
	it('leaves a person it cannot reach unnamed, and says nothing about it', async () => {
		const stranger = 'did:syr:z6MkfZ3Uc1nUxUeaKvcVjNbBidsWv5tvfAv1TFuxNvcbXeaC';
		people.resolve(stranger);
		await settle();
		expect(people.of(stranger)).toBeNull();
	});

	// A surface stops waiting for a name once this is settled, and draws them
	// with the identity that tells one stranger from another.
	it('holds somebody nobody could place as somebody nobody can, and stops asking', async () => {
		const stranger = 'did:syr:z6MkfZ3Uc1nUxUeaKvcVjNbBidsWv5tvfAv1TFuxNvcbXeaC';
		people.resolve(stranger);
		await settle();
		people.resolve(stranger);
		await settle();

		expect(people.unplaced(stranger)).toBe(true);
		expect(api.countOf(asked(stranger))).toBe(1);
	});

	// A read that never landed says nothing about who somebody is, so the name is
	// still coming and the next surface that wants it asks again.
	it('asks again for somebody whose instance did not answer', async () => {
		api.on(asked(PEER), () => new Response('', { status: 503 }));
		people.resolve(PEER);
		await settle();

		expect(people.unplaced(PEER)).toBe(false);

		api.on(asked(PEER), () => THEM);
		people.resolve(PEER);
		await settle();

		expect(people.of(PEER)?.handle).toBe('charles');
	});

	// A graph served off the device reaches nobody's store, so no name is coming
	// for anybody but the reader — and that is settled, not pending.
	it('settles somebody this device has no way to ask about, and stops asking', async () => {
		let asks = 0;
		initRuntime({
			apiHost: () => 'http://api.test',
			createApi: () =>
				({
					async profileOf(): Promise<ProfileView> {
						asks += 1;
						serverOnly('Somebody else’s profile');
					}
				}) as unknown as SloppyApi
		});
		resetApi();

		people.resolve(PEER);
		await settle();
		people.resolve(PEER);
		await settle();

		expect(people.unplaced(PEER)).toBe(true);
		expect(asks).toBe(1);
	});

	// A graph on this device knows the identity and nothing else about whoever
	// owns it, and no part of an identity is a name.
	it('leaves somebody with nothing to be known by but their identity unnamed', async () => {
		api.on('GET /profile/me', () => ({ ...ME, username: DID, display_name: null }));
		await people.read();

		const held = people.of(DID);
		expect(held?.handle).toBeNull();
		expect(held?.identity).toBe(DID);
		expect(nameOr(held)).toBe('Somebody');
	});

	it('holds somebody it has not asked about apart from somebody it could not place', async () => {
		expect(people.unplaced(PEER)).toBe(false);
		people.resolve(PEER);
		await settle();
		expect(people.unplaced(PEER)).toBe(false);
	});

	// Nothing the last person's graph named may be on screen for the next one.
	it('forgets everybody when the person signs out', async () => {
		await people.read();
		people.resolve(PEER);
		await settle();
		people.hold(null);
		expect(people.me).toBeNull();
		expect(people.of(PEER)).toBeNull();
		expect(people.unplaced(PEER)).toBe(false);
	});

	it('does not let an answer in flight at sign-out land on the next person', async () => {
		let answer: (profile: ProfileView) => void = () => {};
		api.on('GET /profile/me', () => new Promise<ProfileView>((resolve) => (answer = resolve)));
		const asked = people.read();
		people.hold(null);
		answer(ME);
		await asked;
		expect(people.me).toBeNull();
	});
});

describe('somebody named by a W3ID', () => {
	const AUTHOR: W3id = 'w3id:@0f6b4a1e-2c3d-4e5f-8a9b-0c1d2e3f4a5b';
	const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
	let store: () => Response | Promise<Response>;
	let reached: string[];

	beforeEach(() => {
		reached = [];
		store = () =>
			Response.json({
				data: {
					metaEnvelopes: {
						edges: [
							{
								node: {
									parsed: {
										displayName: 'Ada Lovelace',
										username: 'ada',
										avatarUrl: 'https://pictures.example.org/ada.png'
									}
								}
							}
						]
					}
				}
			});
		updateRuntime({
			reachOut: async (url: string) => {
				reached.push(url);
				if (url.includes('/resolve')) return Response.json({ uri: 'http://203.0.113.7:4000' });
				if (url.endsWith('.png'))
					return new Response(PNG, { headers: { 'content-type': 'image/png' } });
				return store();
			}
		});
	});

	afterEach(() => {
		updateRuntime({ reachOut: undefined });
		prefs.set('w3idRegistry', W3ID_REGISTRY);
		vi.useRealTimers();
	});

	it('names them from their own profile, with their face, and never asks the API', async () => {
		people.resolve(AUTHOR);
		await settle();

		const held = people.of(AUTHOR);
		expect(held?.displayName).toBe('Ada Lovelace');
		expect(held?.handle).toBe('ada');
		expect(held?.identity).toBe(AUTHOR);
		expect(held?.avatar).toMatch(/^data:image\/png;base64,/);
		expect(api.countOf(asked(AUTHOR))).toBe(0);
		expect(reached[0]).toBe(
			`${W3ID_REGISTRY}/resolve?w3id=${encodeURIComponent('@0f6b4a1e-2c3d-4e5f-8a9b-0c1d2e3f4a5b')}`
		);
	});

	it('asks once a session, however many surfaces name them', async () => {
		people.resolve(AUTHOR);
		people.resolve(AUTHOR);
		await settle();
		people.resolve(AUTHOR);
		await settle();
		expect(reached.filter((url) => url.includes('/resolve'))).toHaveLength(1);
	});

	it('holds somebody whose profile is not public as an unresolvable eName with the plain avatar, and says so', async () => {
		store = () => Response.json({ errors: [{ message: 'Authentication required' }] });
		people.resolve(AUTHOR);
		await settle();

		expect(people.of(AUTHOR)?.displayName).toBe(UNRESOLVED_ENAME);
		expect(people.of(AUTHOR)?.avatar).toBe(DEFAULT_AVATAR);
		expect(people.unplaced(AUTHOR)).toBe(true);
		expect(people.said(AUTHOR)).toBe(NOT_PUBLIC_SAID);
	});

	it('asks again for somebody unreached once five minutes have passed', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		store = () => Promise.reject(new TypeError('connection refused'));
		people.resolve(AUTHOR);
		await settle();
		expect(people.said(AUTHOR)).toBe(UNREACHED_SAID);

		people.resolve(AUTHOR);
		await settle();
		expect(reached.filter((url) => url.includes('/resolve'))).toHaveLength(1);

		vi.setSystemTime(Date.now() + UNREACHED_FOR_MS + 1);
		store = () =>
			Response.json({
				data: { metaEnvelopes: { edges: [{ node: { parsed: { displayName: 'Ada' } } }] } }
			});
		people.resolve(AUTHOR);
		await settle();
		expect(people.of(AUTHOR)?.displayName).toBe('Ada');
	});

	it('asks wherever Settings → People names', async () => {
		prefs.set('w3idRegistry', 'https://names.example.org');
		people.resolve(AUTHOR);
		await settle();
		expect(reached[0]).toMatch(/^https:\/\/names\.example\.org\/resolve\?/);
	});

	it('leaves them unnamed, with nothing said, on a device that cannot ask', async () => {
		updateRuntime({ reachOut: undefined });
		people.resolve(AUTHOR);
		await settle();

		expect(people.unplaced(AUTHOR)).toBe(true);
		expect(people.said(AUTHOR)).toBeNull();
		expect(reached).toHaveLength(0);
	});
});
