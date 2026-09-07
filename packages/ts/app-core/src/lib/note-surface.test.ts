import type { OwnedMediaAsset } from '@sloppy/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetApi, type SloppyApi } from './api.js';
import { noteMedia, wallpaperMedia } from './note-surface.js';
import { initRuntime } from './runtime.js';

const OWNER = 'did:syr:z6MkwSiAvviKsS8dvXsScr4ipdeZwusLQY92cWWBisnvpJLc';

const asset = (role: string, name: string): OwnedMediaAsset => ({
	upload_id: `${OWNER}/${name}`,
	filename: `${role}-${name}.png`,
	mime_type: 'image/png',
	size: 9
});

let listed: string[];
let removed: string[];
let sentAs: string[];

beforeEach(() => {
	listed = [];
	removed = [];
	sentAs = [];
	initRuntime({
		apiHost: () => 'https://sloppy.example',
		createApi: () =>
			({
				ownPictures: async (role = 'block') => {
					listed.push(role);
					return [asset(role, '1')];
				},
				removePicture: async (uploadId: string) => {
					removed.push(uploadId);
				},
				createUpload: async (request: { role: string }) => {
					sentAs.push(request.role);
					throw new Error('nothing is listening');
				}
			}) as unknown as SloppyApi
	});
	resetApi();
});

const aFile = () => new File(['x'], 'kite.png', { type: 'image/png' });

afterEach(() => resetApi());

describe('the pictures a note surface offers', () => {
	it('reads what is in the notes and nothing else', async () => {
		expect(await noteMedia.library()).toEqual([asset('block', '1')]);
		expect(listed).toEqual(['block']);
	});

	it('adds one to the note library', async () => {
		await expect(noteMedia.send(aFile(), () => {}).asset).rejects.toThrow();
		expect(sentAs).toEqual(['block']);
	});
});

// DESIGN.md § "The wallpaper": the ground has its own library and reads the
// note one beside it, so a picture goes behind a graph without going into a note.
describe('the pictures the ground offers', () => {
	it('reads the grounds first and the notes after them', async () => {
		expect(await wallpaperMedia.library()).toEqual([asset('wallpaper', '1'), asset('block', '1')]);
		expect([...listed].sort()).toEqual(['block', 'wallpaper']);
	});

	it('adds one to the ground library, not to the notes', async () => {
		await expect(wallpaperMedia.send(aFile(), () => {}).asset).rejects.toThrow();
		expect(sentAs).toEqual(['wallpaper']);
	});

	it('takes one out of the store by the upload it arrived on', async () => {
		await wallpaperMedia.remove(`${OWNER}/1`);
		expect(removed).toEqual([`${OWNER}/1`]);
	});
});
