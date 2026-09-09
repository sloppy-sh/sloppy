import type { CustomEmoji, OwnedMediaAsset } from '@sloppy/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetApi, type SloppyApi } from './api.js';
import { noteEmoji, noteMedia, wallpaperMedia } from './note-surface.js';
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

// docs/ARCHITECTURE.md § "Local-only mode": a shortcode is read against the
// catalog whichever api the runtime handed over answers with.
describe('the catalog a note reads its shortcodes against', () => {
	const fire = (src: string): CustomEmoji => ({
		emoji_id: 'e1',
		did: OWNER,
		shortcode: 'fire',
		kind: 'emoji',
		src
	});

	it('is the one beside a graph the device holds', async () => {
		initRuntime({
			apiHost: () => 'https://sloppy.example',
			mode: () => 'local',
			assetSrc: (src) => src,
			createApi: () =>
				({
					ownEmoji: async () => [fire('/.sloppy/emoji/fire.png')]
				}) as unknown as SloppyApi
		});
		resetApi();

		expect(await noteEmoji(OWNER).catalog(OWNER)).toEqual([
			{ id: 'e1', shortcode: 'fire', src: '/.sloppy/emoji/fire.png', sticker: false }
		]);
	});

	it('is the instance’s where a Sloppy serves the graph', async () => {
		initRuntime({
			apiHost: () => 'https://sloppy.example',
			mode: () => 'hosted',
			assetSrc: undefined,
			createApi: undefined,
			fetchImpl: () => async () =>
				new Response(JSON.stringify([fire('/proxy?ref=fire')]), {
					headers: { 'content-type': 'application/json' }
				})
		});
		resetApi();

		expect(await noteEmoji(OWNER).catalog(OWNER)).toEqual([
			{
				id: 'e1',
				shortcode: 'fire',
				src: 'https://sloppy.example/api/proxy?ref=fire',
				sticker: false
			}
		]);
	});
});
