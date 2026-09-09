import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deviceStore } from '../device-store.js';
import { initRuntime, runtime } from '../runtime.js';
import { useFakeApi, VIEWER, type FakeApi } from './fake-api.test-support.js';
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
