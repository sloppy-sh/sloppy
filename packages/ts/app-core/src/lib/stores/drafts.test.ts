import 'fake-indexeddb/auto';
import type { NoteDraft } from '@sloppy/ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deviceStore } from '../device-store.js';
import { drafts } from './drafts.svelte.js';
import { ref, useFakeApi, VIEWER } from './fake-api.test-support.js';
import { session } from './session.svelte.js';

const NOTE = ref(1);
const SECTION = ref(2);

function draft(says: string): NoteDraft {
	const content = {
		type: 'doc' as const,
		content: [{ type: 'paragraph', content: [{ type: 'text', text: says }] }]
	};
	return {
		rows: [{ uid: 'b1', ref: SECTION, content, updated_at: '2026-01-01T00:00:00.000Z' }],
		next: [{ uid: 'b1', ref: SECTION, content }]
	};
}

const said = (held: NoteDraft | null) => held?.next[0].content.content[0].content?.[0].text ?? null;

beforeEach(async () => {
	// Only the clock this store keeps: the device's own store runs on the loop.
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
	const api = useFakeApi();
	api.on('GET /auth/me', () => VIEWER);
	await session.refresh();
	drafts.forget(NOTE);
	await deviceStore.forget(VIEWER.did);
});

afterEach(() => {
	vi.useRealTimers();
	session.clear();
});

describe('the writing a device is holding for a note', () => {
	it('is there to open the note from until it lands', async () => {
		drafts.keep(NOTE, draft('a thought on a train'));
		await expect(drafts.read(NOTE).then(said)).resolves.toBe('a thought on a train');

		drafts.forget(NOTE);
		await expect(drafts.read(NOTE)).resolves.toBeNull();
	});

	it('is what the surface said then, not what it says by the time it is written down', async () => {
		const held = draft('as it stood');
		drafts.keep(NOTE, held);
		held.next[0].content.content[0].content = [{ type: 'text', text: 'as it stands now' }];

		await expect(drafts.read(NOTE).then(said)).resolves.toBe('as it stood');
	});

	it('survives a surface being taken down after another has written its own', async () => {
		const leaving = drafts.keep(NOTE, draft('the one being left'));
		drafts.keep(NOTE, draft('the one just written'));

		drafts.forget(NOTE, leaving);
		await expect(drafts.read(NOTE).then(said)).resolves.toBe('the one just written');

		drafts.forget(NOTE);
		await expect(drafts.read(NOTE)).resolves.toBeNull();
	});

	it('is not written over by a surface taken down before it', async () => {
		const leaving = drafts.keep(NOTE, draft('the one being left'));
		drafts.keep(NOTE, draft('the one just written'));
		drafts.keep(NOTE, draft('what the surface being left is still holding'), leaving);

		await expect(drafts.read(NOTE).then(said)).resolves.toBe('the one just written');
	});

	it('is not worth saying anything about until it has been waiting', () => {
		drafts.keep(NOTE, draft('on its way'));
		expect(drafts.waiting(NOTE)).toBe(false);

		vi.advanceTimersByTime(4000);
		expect(drafts.waiting(NOTE)).toBe(true);

		drafts.forget(NOTE);
		expect(drafts.waiting(NOTE)).toBe(false);
	});

	it('is on its way again for as long as the server keeps taking it', () => {
		drafts.keep(NOTE, draft('the first of it'));
		vi.advanceTimersByTime(2000);
		drafts.landed(NOTE);
		drafts.keep(NOTE, draft('and more of it'));

		vi.advanceTimersByTime(2000);
		expect(drafts.waiting(NOTE)).toBe(false);

		vi.advanceTimersByTime(2000);
		expect(drafts.waiting(NOTE)).toBe(true);
	});

	it('is said of a note opened on writing left here before', async () => {
		await deviceStore.area(VIEWER.did, 'drafts').set(NOTE, draft('left here yesterday'));

		await expect(drafts.read(NOTE).then(said)).resolves.toBe('left here yesterday');
		vi.advanceTimersByTime(4000);
		expect(drafts.waiting(NOTE)).toBe(true);
	});

	it('is not answered for as settled while a trip carrying it is in the air', async () => {
		const first = drafts.leaving(NOTE);
		const second = drafts.leaving(NOTE);
		let arrived = false;
		void drafts.settled(NOTE).then(() => (arrived = true));

		first();
		first();
		await Promise.resolve();
		await Promise.resolve();
		expect(arrived).toBe(false);

		second();
		await drafts.settled(NOTE);
		expect(arrived).toBe(true);
	});

	it('is settled for a note nothing has been sent for', async () => {
		await expect(drafts.settled(NOTE)).resolves.toBeUndefined();
	});

	it('belongs to nobody while nobody is signed in', async () => {
		session.clear();
		drafts.keep(NOTE, draft('typed by nobody'));
		await expect(drafts.read(NOTE)).resolves.toBeNull();
	});
});
