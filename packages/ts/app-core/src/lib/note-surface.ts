// What a note's interior reaches the API through. `@sloppy/ui` talks to no
// server, so `BlockStack`'s capabilities are built here — `contract.ts` in that
// package states what each one promises.

import { proxied, uploadFile } from '@sloppy/client';
import type { CustomEmoji } from '@sloppy/types';
import type { CustomEmojiEntry, NoteEmoji, NoteMedia } from '@sloppy/ui';
import { api } from './api.js';
import { serverMessage } from './stores/errors.js';

/** Whatever the surface shows a person when a send fails is this message, so a
 *  server that explained itself in words for a human is the one they read. */
function refusal(error: unknown, fallback: string): Error {
	return new Error(serverMessage(error) ?? fallback);
}

export const noteMedia: NoteMedia = {
	send(file, progress) {
		const handle = uploadFile(api, file, { role: 'block', onProgress: progress });
		return {
			asset: handle.asset.catch((error: unknown) => {
				throw refusal(error, 'That picture could not be added. Remove it and try again.');
			}),
			cancel: handle.cancel
		};
	},
	picture: (uploadId) => api.ownPicture(uploadId),
	library: () => api.ownPictures()
};

function entryOf(emoji: CustomEmoji): CustomEmojiEntry {
	return {
		id: emoji.emoji_id,
		shortcode: emoji.shortcode,
		src: proxied(emoji.src),
		sticker: emoji.kind === 'sticker'
	};
}

/** `mine` is the signed-in identity: their catalog is what the picker offers and
 *  what adding and removing act on. */
export function noteEmoji(mine: string): NoteEmoji {
	return {
		mine,
		catalog: async (did) =>
			(did === mine ? await api.ownEmoji() : await api.emojiOf(did)).map(entryOf),
		async add({ file, shortcode, kind }) {
			try {
				const asset = await uploadFile(api, file, { role: 'emoji' }).asset;
				await api.addEmoji({ shortcode, kind, upload_id: asset.upload_id });
			} catch (error) {
				throw refusal(error, 'That picture could not be added. Try again in a moment.');
			}
		},
		remove: (id) => api.removeEmoji(id)
	};
}
