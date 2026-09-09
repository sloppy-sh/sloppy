import { beforeEach, describe, expect, it } from 'vitest';
import { resolveEmoji, type CustomEmojiEntry } from './catalog.js';
import { emojiCatalogs, type LoadCatalog } from './catalogs.svelte.js';

const OWNER = 'did:syr:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK';

function fire(src: string): CustomEmojiEntry {
	return { id: 'e1', shortcode: 'fire', src, sticker: false };
}

async function landed(): Promise<void> {
	for (let turn = 0; turn < 4; turn += 1) await new Promise((done) => setTimeout(done, 0));
}

beforeEach(() => emojiCatalogs.forget(OWNER));

describe('the catalog a shortcode is read against', () => {
	// The pictures come from an instance where a Sloppy serves the graph and from
	// the folder beside it where the device holds its own; a shortcode resolves
	// the same way against either.
	it('is whichever one the app was handed', async () => {
		const served: LoadCatalog = async () => [fire('/api/media/proxy?ref=fire')];
		emojiCatalogs.of(OWNER, served);
		await landed();
		expect(resolveEmoji('fire', emojiCatalogs.of(OWNER, served))).toMatchObject({
			src: '/api/media/proxy?ref=fire'
		});

		emojiCatalogs.forget(OWNER);
		const onDevice: LoadCatalog = async () => [fire('asset://vault/.sloppy/emoji/fire.png')];
		emojiCatalogs.of(OWNER, onDevice);
		await landed();
		expect(resolveEmoji('fire', emojiCatalogs.of(OWNER, onDevice))).toMatchObject({
			src: 'asset://vault/.sloppy/emoji/fire.png'
		});
	});

	it('is empty until the answer lands, and never asked for twice at once', async () => {
		let asks = 0;
		const load: LoadCatalog = async () => {
			asks += 1;
			return [fire('one')];
		};

		expect(emojiCatalogs.of(OWNER, load)).toEqual([]);
		expect(emojiCatalogs.of(OWNER, load)).toEqual([]);
		await landed();

		expect(emojiCatalogs.of(OWNER, load)).toHaveLength(1);
		expect(asks).toBe(1);
	});

	// A read that failed is not an answer: whoever holds the catalog must not
	// have their emoji blanked for the life of the tab.
	it('is asked again after a read that did not land', async () => {
		emojiCatalogs.of(OWNER, async () => Promise.reject(new Error('no')));
		await landed();

		expect(emojiCatalogs.of(OWNER, async () => [fire('two')])).toEqual([]);
		await landed();
		expect(emojiCatalogs.of(OWNER, async () => [fire('two')])).toHaveLength(1);
	});

	it('is empty where there is nobody to read one of', () => {
		expect(emojiCatalogs.of(undefined, async () => [fire('one')])).toEqual([]);
	});
});
