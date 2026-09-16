import { SloppyApiError } from '@sloppy/client';
import type { IdentityAccess } from '@sloppy/local';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deviceStore } from '../device-store.js';
import { initRuntime, runtime } from '../runtime.js';
import { DID, homeOf, useFakeApi, VIEWER, type FakeApi } from './fake-api.test-support.js';
import { session } from './session.svelte.js';

describe('a session nobody has asked about', () => {
	it('reports neither ready nor signed in', () => {
		expect(session.ready).toBe(false);
		expect(session.signedIn).toBe(false);
	});
});

describe('the session', () => {
	let api: FakeApi;

	beforeEach(() => {
		session.clear();
		api = useFakeApi();
		api.on('GET /auth/me', () => VIEWER);
		api.on('POST /auth/logout', () => ({}));
	});

	it('adopts the viewer the API answers with', async () => {
		await session.refresh();
		expect(session.viewer?.did).toBe(VIEWER.did);
		expect(session.signedIn).toBe(true);
		expect(session.ready).toBe(true);
	});

	it('issues one request when two surfaces ask at once', async () => {
		await Promise.all([session.refresh(), session.refresh()]);
		expect(api.countOf('GET /auth/me')).toBe(1);
	});

	it('issues none once the answer is known', async () => {
		await session.refresh();
		await session.load();
		expect(api.countOf('GET /auth/me')).toBe(1);
	});

	it('treats nobody signed in as the ordinary first visit, not a failure', async () => {
		api.on('GET /auth/me', () => undefined);
		await session.refresh();
		expect(session.viewer).toBeNull();
		expect(session.ready).toBe(true);
	});

	it('is not signed back in by an answer that lands after the sign-out', async () => {
		let answer!: () => void;
		const held = new Promise<void>((resolve) => (answer = resolve));
		api.on('GET /auth/me', async () => {
			await held;
			return VIEWER;
		});
		const asking = session.refresh();
		session.clear();
		answer();
		await asking;
		expect(session.signedIn).toBe(false);
	});

	it('is not signed back out by an answer that lands after the consent round-trip', async () => {
		let answer!: () => void;
		const held = new Promise<void>((resolve) => (answer = resolve));
		api.on('GET /auth/me', async () => {
			await held;
			return undefined;
		});
		const asking = session.refresh();
		session.adopt(VIEWER, 'a-live-token');
		answer();
		await asking;
		expect(session.signedIn).toBe(true);
		expect(await session.load()).toEqual(VIEWER);
	});

	it('does not hand a later ask the request the consent round-trip outran', async () => {
		let answer!: () => void;
		const held = new Promise<void>((resolve) => (answer = resolve));
		api.on('GET /auth/me', async () => {
			await held;
			return undefined;
		});
		const asking = session.refresh();
		session.adopt(VIEWER, 'a-live-token');
		const later = session.load();
		answer();
		await asking;
		expect((await later)?.did).toBe(VIEWER.did);
	});

	// The app is signed out of by a credential the server turned down, and only by
	// that: dropping somebody because the answer could not be had takes the whole
	// app away over a blip they did nothing to cause.
	it('holds a session it could not ask about, rather than calling it nobody', async () => {
		api.on(
			'GET /auth/me',
			() =>
				new Response(JSON.stringify({ message: 'Try again in a moment.' }), {
					status: 503,
					headers: { 'content-type': 'application/json' }
				})
		);
		await session.refresh();
		expect(session.signedIn).toBe(false);
		expect(session.unavailable).toBe(true);
	});

	it('calls a credential the server turned down nobody, and says so', async () => {
		api.on('GET /auth/me', () => new Response('{}', { status: 401 }));
		await session.refresh();
		expect(session.signedIn).toBe(false);
		expect(session.unavailable).toBe(false);
	});

	it('stops holding it once the answer comes back', async () => {
		api.on('GET /auth/me', () => new Response('{}', { status: 503 }));
		await session.refresh();
		api.on('GET /auth/me', () => VIEWER);
		await session.refresh();
		expect(session.unavailable).toBe(false);
		expect(session.signedIn).toBe(true);
	});

	it('drops the credential when signing out', async () => {
		runtime.token.set('a-live-token');
		await session.refresh();
		await session.signOut();
		expect(session.signedIn).toBe(false);
		expect(runtime.token.get()).toBeUndefined();
	});

	it('leaves nothing of the person on the device', async () => {
		await session.refresh();
		const notes = deviceStore.area(VIEWER.did, 'notes');
		await notes.set('1a', 'what the graph looked like');

		await session.signOut();
		await vi.waitFor(async () => expect(await notes.keys()).toEqual([]));
	});

	it('keeps what the device holds when a session lapses rather than ends', async () => {
		await session.refresh();
		const notes = deviceStore.area(VIEWER.did, 'notes');
		await notes.set('1a', 'a paragraph that never reached Sloppy');

		session.clear();
		expect(session.signedIn).toBe(false);
		expect(await notes.keys()).toEqual(['1a']);

		await deviceStore.forget(VIEWER.did);
	});
});

describe('a graph the device holds itself', () => {
	beforeEach(() => {
		session.clear();
		useFakeApi();
	});

	afterEach(() => initRuntime({ apiHost: () => 'http://api.test', mode: () => 'hosted' }));

	it('is a session with nobody to sign in or out', () => {
		expect(session.onDevice).toBe(false);

		initRuntime({ apiHost: () => 'http://api.test', mode: () => 'local' });
		expect(session.onDevice).toBe(true);
	});
});

describe('a sign-in the device itself began', () => {
	let api: FakeApi;
	let asked: unknown;
	let folder: string | undefined;

	const HERE = {
		did: DID,
		source: 'delegated' as const,
		lapsed: false,
		writing: true,
		carriable: false
	};

	function shell(finish: IdentityAccess['finish']): void {
		initRuntime({
			apiHost: () => 'http://api.test',
			identities: {
				list: async () => [HERE],
				makeOne: async () => HERE,
				signIn: async () => {},
				finish,
				bring: async () => HERE,
				carryOut: async () => ({ name: 'sloppy-identity.json', body: new Uint8Array() }),
				writeAs: async () => {}
			},
			vault: {
				folder: () => folder,
				graph: async () => (folder ? homeOf(DID) : undefined),
				asks: true,
				open: async () => folder
			}
		});
	}

	beforeEach(() => {
		session.clear();
		asked = undefined;
		folder = '/Users/me/garden';
		api = useFakeApi();
		api.on('GET /auth/me', () => VIEWER);
		api.on('PATCH /profile/me', (_url, init) => {
			asked = JSON.parse(String(init?.body));
			return {
				did: DID,
				username: DID,
				display_name: 'Ada Lovelace',
				bio: null,
				avatar_src: null,
				banner_src: null
			};
		});
	});

	afterEach(() => {
		initRuntime({
			apiHost: () => 'http://api.test',
			mode: () => 'hosted',
			identities: undefined,
			vault: undefined
		});
	});

	it('leaves a launch that is not a return from one alone', async () => {
		shell(async () => undefined);

		expect(await session.finishSignInHere(new URLSearchParams('state=s'))).toBe(false);
		expect(api.countOf('PATCH /profile/me')).toBe(0);
	});

	it('carries what the store calls a person into the graph in front of them', async () => {
		shell(async () => ({ identity: HERE, name: 'Ada Lovelace' }));

		expect(await session.finishSignInHere(new URLSearchParams('state=s&code=c'))).toBe(true);
		expect(asked).toEqual({ display_name: 'Ada Lovelace' });
		expect(session.signInProblem).toBeNull();
	});

	it('says what to do next where the store turned it down', async () => {
		shell(async () => {
			throw new SloppyApiError(400, 'Sloppy was not approved, so you are not signed in.', {
				detail: 'Sloppy was not approved, so you are not signed in.'
			});
		});

		expect(await session.finishSignInHere(new URLSearchParams('state=s&error=denied'))).toBe(false);
		expect(session.signInProblem).toContain('not approved');
		expect(api.countOf('PATCH /profile/me')).toBe(0);
	});

	it('keeps the name to carry until there is a graph to carry it into', async () => {
		folder = undefined;
		shell(async () => ({ identity: HERE, name: 'Ada Lovelace' }));
		await session.finishSignInHere(new URLSearchParams('state=s&code=c'));
		expect(api.countOf('PATCH /profile/me')).toBe(0);

		folder = '/Users/me/garden';
		await session.carryProfile();

		expect(asked).toEqual({ display_name: 'Ada Lovelace' });
	});
});
