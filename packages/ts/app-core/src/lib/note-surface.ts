// What a note's interior reaches the API through. `@sloppy/ui` talks to no
// server, so `BlockStack`'s capabilities are built here — `contract.ts` in that
// package states what each one promises.

import { SloppyApiError, uploadFile } from '@sloppy/client';
import type { CustomEmoji, MediaRole } from '@sloppy/types';
import { SaveFailure, type CustomEmojiEntry, type NoteEmoji, type NoteMedia } from '@sloppy/ui';
import { api } from './api.js';
import { pictureSrc } from './asset-src.js';
import { refusal, serverMessage } from './stores/errors.js';

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
	if (error.status === 410) return new SaveFailure('gone');
	if (error.status === 401) return new SaveFailure('refused', 'Sign in again to keep this note.');
	if (error.status >= 500 || BUSY.has(error.status)) return new SaveFailure('transient');
	return new SaveFailure(
		'refused',
		serverMessage(error) ??
			'Sloppy cannot save this section as it is. Your writing is kept on this device; change the section and Sloppy will try again.'
	);
}

function sending(file: File, role: MediaRole, progress: (fraction: number) => void) {
	const handle = uploadFile(api, file, { role, onProgress: progress });
	return {
		asset: handle.asset.catch((error: unknown) => {
			throw refusal(error, 'That picture could not be added. Remove it and try again.');
		}),
		cancel: handle.cancel
	};
}

async function dropPicture(uploadId: string): Promise<void> {
	try {
		await api.removePicture(uploadId);
	} catch (error) {
		throw refusal(error, 'That picture could not be removed. Try again in a moment.');
	}
}

export const noteMedia: NoteMedia = {
	send: (file, progress) => sending(file, 'block', progress),
	picture: (uploadId) => api.ownPicture(uploadId),
	library: () => api.ownPictures(),
	remove: dropPicture
};

/** The ground keeps its own library and reads the note one beside it —
 *  DESIGN.md § "The wallpaper". */
export const wallpaperMedia: NoteMedia = {
	send: (file, progress) => sending(file, 'wallpaper', progress),
	picture: (uploadId) => api.ownPicture(uploadId),
	async library() {
		const [grounds, notes] = await Promise.all([
			api.ownPictures('wallpaper'),
			api.ownPictures('block')
		]);
		return [...grounds, ...notes];
	},
	remove: dropPicture
};

function entryOf(emoji: CustomEmoji): CustomEmojiEntry {
	return {
		id: emoji.emoji_id,
		shortcode: emoji.shortcode,
		src: pictureSrc(emoji.src),
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
		async remove(id) {
			try {
				await api.removeEmoji(id);
			} catch (error) {
				throw refusal(error, 'That could not be removed. Try again in a moment.');
			}
		}
	};
}
