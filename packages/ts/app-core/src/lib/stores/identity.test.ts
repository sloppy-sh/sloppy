import { beforeEach, describe, expect, it } from 'vitest';
import { useFakeApi, VIEWER, type FakeApi } from './fake-api.test-support.js';
import { identity } from './identity.svelte.js';
import { session } from './session.svelte.js';

/** The same instance the viewer's identity is on, spelled the other way. A
 *  person types one and a config file holds the other. */
const SAME_INSTANCE = `${VIEWER.syr_instance_url}/`;

describe('where the signed-in person keeps their identity', () => {
	let api: FakeApi;

	beforeEach(() => {
		identity.clear();
		session.clear();
		api = useFakeApi();
	});

	it('says nothing until the ask has landed', async () => {
		let answer: (url: string | null) => void = () => {};
		api.on(
			'GET /auth/own-instance',
			() =>
				new Promise((settle) => {
					answer = (url) => settle({ instance_url: url });
				})
		);
		session.adopt(VIEWER, 'a-session');

		const asking = identity.load();
		expect(identity.kind).toBeUndefined();
		expect(identity.converses).toBe(false);

		answer(null);
		await asking;
		expect(identity.kind).toBe('delegated');
	});

	it('says nothing while nobody is signed in', async () => {
		api.on('GET /auth/own-instance', () => ({ instance_url: null }));
		await identity.load();
		expect(identity.kind).toBeUndefined();
	});

	it('is delegated where the identity is kept somewhere else', async () => {
		api.on('GET /auth/own-instance', () => ({ instance_url: 'https://elsewhere.test' }));
		session.adopt(VIEWER, 'a-session');
		await identity.load();

		expect(identity.kind).toBe('delegated');
		expect(identity.converses).toBe(true);
	});

	it('is delegated on an instance that keeps no identities of its own', async () => {
		api.on('GET /auth/own-instance', () => ({ instance_url: null }));
		session.adopt(VIEWER, 'a-session');
		await identity.load();

		expect(identity.kind).toBe('delegated');
	});

	it('is local where the identity is kept on this instance itself', async () => {
		api.on('GET /auth/own-instance', () => ({ instance_url: VIEWER.syr_instance_url }));
		session.adopt(VIEWER, 'a-session');
		await identity.load();

		expect(identity.kind).toBe('local');
		expect(identity.converses).toBe(false);
	});

	it('reads two spellings of one instance as one instance', async () => {
		api.on('GET /auth/own-instance', () => ({ instance_url: SAME_INSTANCE }));
		session.adopt(VIEWER, 'a-session');
		await identity.load();

		expect(identity.kind).toBe('local');
	});

	it('asks once however many surfaces ask', async () => {
		api.on('GET /auth/own-instance', () => ({ instance_url: null }));
		session.adopt(VIEWER, 'a-session');
		await Promise.all([identity.load(), identity.load()]);
		await identity.load();

		expect(api.countOf('GET /auth/own-instance')).toBe(1);
	});

	it('does not remember an ask that did not land', async () => {
		api.on('GET /auth/own-instance', () => new Response('', { status: 503 }));
		session.adopt(VIEWER, 'a-session');
		await identity.load();
		expect(identity.kind).toBeUndefined();

		api.on('GET /auth/own-instance', () => ({ instance_url: VIEWER.syr_instance_url }));
		await identity.load();

		expect(api.countOf('GET /auth/own-instance')).toBe(2);
		expect(identity.kind).toBe('local');
	});

	it('carries where a reader reaches the graph kept here', async () => {
		api.on('GET /auth/own-instance', () => ({
			instance_url: null,
			instance_origin: 'https://notes.example'
		}));
		session.adopt(VIEWER, 'a-session');
		await identity.load();

		expect(identity.servedAt).toBe('https://notes.example');
	});

	it('says nothing about where the graph is until the ask lands, or where none was named', async () => {
		api.on('GET /auth/own-instance', () => ({ instance_url: null }));
		session.adopt(VIEWER, 'a-session');
		expect(identity.servedAt).toBeUndefined();

		await identity.load();
		expect(identity.servedAt).toBeUndefined();
	});

	it('holds nothing of the last person for the next', async () => {
		api.on('GET /auth/own-instance', () => ({
			instance_url: VIEWER.syr_instance_url,
			instance_origin: 'https://notes.example'
		}));
		session.adopt(VIEWER, 'a-session');
		await identity.load();
		expect(identity.kind).toBe('local');

		identity.clear();
		expect(identity.servedAt).toBeUndefined();
		api.on('GET /auth/own-instance', () => ({ instance_url: 'https://elsewhere.test' }));
		await identity.load();

		expect(identity.kind).toBe('delegated');
		expect(identity.servedAt).toBeUndefined();
	});
});
