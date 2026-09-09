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
	it('is what the loader answered with, once it has', async () => {
		const load: LoadCatalog = async () => [fire('/emoji/fire.png')];
		emojiCatalogs.of(OWNER, load);
		await landed();

		expect(resolveEmoji('fire', emojiCatalogs.of(OWNER, load))).toMatchObject({
			src: '/emoji/fire.png'
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
