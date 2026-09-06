import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deviceStore } from './device-store.js';

const ADA = 'did:syr:z6MkAdaAdaAdaAdaAdaAdaAdaAdaAdaAda';
const BRAM = 'did:syr:z6MkBramBramBramBramBramBramBram';

describe('what this device keeps', () => {
	beforeEach(async () => {
		await deviceStore.forget(ADA);
		await deviceStore.forget(BRAM);
	});

	it('hands back what it was given', async () => {
		const notes = deviceStore.area(ADA, 'notes');
		await notes.set('1a', { title: 'A thought' });

		await expect(notes.get('1a')).resolves.toEqual({ title: 'A thought' });
		await expect(notes.get('1b')).resolves.toBeUndefined();
	});

	it('keeps two areas of one identity apart', async () => {
		await deviceStore.area(ADA, 'notes').set('1a', 'a note');
		await deviceStore.area(ADA, 'drafts').set('1a', 'a draft');

		await expect(deviceStore.area(ADA, 'notes').get('1a')).resolves.toBe('a note');
		await expect(deviceStore.area(ADA, 'drafts').keys()).resolves.toEqual(['1a']);
	});

	it('keeps two identities apart', async () => {
		await deviceStore.area(ADA, 'notes').set('1a', 'hers');
		await deviceStore.area(BRAM, 'notes').set('1a', 'his');

		await expect(deviceStore.area(BRAM, 'notes').get('1a')).resolves.toBe('his');
		await deviceStore.forget(BRAM);
		await expect(deviceStore.area(ADA, 'notes').get('1a')).resolves.toBe('hers');
		await expect(deviceStore.area(BRAM, 'notes').keys()).resolves.toEqual([]);
	});

	it('takes one key, one area, or everything of one identity', async () => {
		const notes = deviceStore.area(ADA, 'notes');
		await notes.set('1a', 'one');
		await notes.set('1b', 'two');
		await deviceStore.area(ADA, 'drafts').set('1a', 'three');

		await notes.delete('1a');
		await expect(notes.keys()).resolves.toEqual(['1b']);

		await notes.clear();
		await expect(notes.keys()).resolves.toEqual([]);
		await expect(deviceStore.area(ADA, 'drafts').keys()).resolves.toEqual(['1a']);

		await deviceStore.forget(ADA);
		await expect(deviceStore.area(ADA, 'drafts').keys()).resolves.toEqual([]);
	});
});

describe('a device with nowhere to keep anything', () => {
	it('holds what it is given for as long as the page lives', async () => {
		vi.resetModules();
		vi.stubGlobal('indexedDB', undefined);
		const { deviceStore: withoutStore } = await import('./device-store.js');

		const notes = withoutStore.area(ADA, 'notes');
		await notes.set('1a', 'still here');
		await expect(notes.get('1a')).resolves.toBe('still here');
		await withoutStore.forget(ADA);
		await expect(notes.get('1a')).resolves.toBeUndefined();

		vi.unstubAllGlobals();
	});
});
