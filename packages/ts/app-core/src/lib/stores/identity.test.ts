import { beforeEach, describe, expect, it } from 'vitest';
import { useFakeApi, VIEWER, type FakeApi } from './fake-api.test-support.js';
import { answersReach, identity } from './identity.svelte.js';
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

	// Sloppy holds nothing that answers for them: what they signed in with is a
	// key of their own, and a surface that read them as delegated would offer
	// what no store is there to do.
	it('is its own kind for somebody who signed in with a key of their own', async () => {
		api.on('GET /auth/own-instance', () => ({ instance_url: null }));
		session.adopt({ did: 'mailto:alice@example.com' }, 'a-session');

		expect(identity.kind).toBe('own-key');
		await identity.load();
		expect(identity.kind).toBe('own-key');
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

describe('whether this person’s own store can hold a conversation', () => {
	let api: FakeApi;

	beforeEach(() => {
		identity.clear();
		session.clear();
		api = useFakeApi();
		api.on('GET /auth/own-instance', () => ({ instance_url: null }));
	});

	it('answers nothing until the store has been asked', async () => {
		let answer: () => void = () => {};
		api.on(
			'GET /converses',
			() =>
				new Promise((settle) => {
					answer = () => settle({ comments: true, reactions: true });
				})
		);
		session.adopt(VIEWER, 'a-session');

		const asking = identity.load();
		expect(identity.converses).toBeUndefined();

		answer();
		await asking;
		expect(identity.converses).toBe(true);
	});

	// A store that takes a comment and lists none gives the writer a comment that
	// is gone on the next read, so the surface is not offered.
	it('says no where the store serves only half of one', async () => {
		api.on('GET /converses', () => ({ comments: true, reactions: false }));
		session.adopt(VIEWER, 'a-session');
		await identity.load();

		expect(identity.converses).toBe(false);
	});

	it('says nothing while nobody is signed in, and asks nobody', async () => {
		api.on('GET /converses', () => ({ comments: true, reactions: true }));
		await identity.load();

		expect(identity.converses).toBeUndefined();
		expect(api.countOf('GET /converses')).toBe(0);
	});

	it('does not remember an ask that did not land', async () => {
		api.on('GET /converses', () => new Response('', { status: 503 }));
		session.adopt(VIEWER, 'a-session');
		await identity.load();
		expect(identity.converses).toBeUndefined();

		api.on('GET /converses', () => ({ comments: true, reactions: true }));
		await identity.load();

		expect(identity.converses).toBe(true);
	});

	it('asks again for whoever signs in next', async () => {
		api.on('GET /converses', () => ({ comments: true, reactions: true }));
		session.adopt(VIEWER, 'a-session');
		await identity.load();
		expect(identity.converses).toBe(true);

		api.on('GET /converses', () => ({ comments: false, reactions: false }));
		session.adopt({ ...VIEWER, did: 'did:syr:z6MkSomebodyElse' }, 'another-session');
		await identity.load();

		expect(identity.converses).toBe(false);
		expect(api.countOf('GET /converses')).toBe(2);
	});
});

describe('where an answer somebody writes arrives', () => {
	it('is a store this instance does not run, and nowhere else', () => {
		expect(answersReach('delegated')).toBe(true);
		expect(answersReach('local')).toBe(false);
		expect(answersReach('own-key')).toBe(false);
	});

	// Saying so before the ask lands would put the harder sentence in front of
	// somebody it is not true of, and then take it back.
	it('is not yet a no while the identity is still being asked about', () => {
		expect(answersReach(undefined)).toBe(true);
	});
});
