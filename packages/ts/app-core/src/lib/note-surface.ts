// What a note's interior reaches the API through. `@sloppy/ui` talks to no
// server, so `BlockStack`'s capabilities are built here — `contract.ts` in that
// package states what each one promises.

import { proxied, SloppyApiError, uploadFile } from '@sloppy/client';
import type { CustomEmoji } from '@sloppy/types';
import { SaveFailure, type CustomEmojiEntry, type NoteEmoji, type NoteMedia } from '@sloppy/ui';
import { api } from './api.js';
import { serverMessage } from './stores/errors.js';

/** Whatever the surface shows a person when a send fails is this message, so a
 *  server that explained itself in words for a human is the one they read. */
function refusal(error: unknown, fallback: string): Error {
	return new Error(serverMessage(error) ?? fallback);
}

/** Answers a server gives while it is busy or out of reach, which the next try
 *  can land. Everything else it names is an answer that will not change. */
const BUSY = new Set([408, 425, 429]);

/**
 * How a write to a note's stack failed, as far as the writing surface has to
 * act on it. Anything that never reached a server at all is trouble worth
 * trying again.
 */
export function saveFailure(error: unknown): SaveFailure {
	if (!(error instanceof SloppyApiError)) return new SaveFailure('transient');
	if (error.status === 409) return new SaveFailure('elsewhere');
	if (error.status === 401) return new SaveFailure('refused', 'Sign in again to keep this note.');
	if (error.status >= 500 || BUSY.has(error.status)) return new SaveFailure('transient');
	return new SaveFailure('refused', serverMessage(error) ?? 'Sloppy cannot save this note.');
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
