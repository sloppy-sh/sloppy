// What a node's interior is handed and how it saves — docs/ARCHITECTURE.md
// § "Blocks and ink". Every kind of block, ink and pictures included, is a
// `type` with a renderer; none of them is a field here.
//
// This package reaches no API, so everything that talks to one arrives as a
// capability. Each is optional, and its ABSENCE is what turns the surface that
// needs it off — a shell leaves one out to say the surface cannot serve it.

import type {
	BlockView,
	CreateBlockRequest,
	CustomEmojiKind,
	MediaAsset,
	NodeView,
	OwnedRef,
	UpdateBlockRequest
} from '@sloppy/types';
import type { CustomEmojiEntry } from '../../emoji/catalog.js';

export interface SendingPicture {
	/**
	 * The upload the bytes became. Rejects where the send failed or was stopped,
	 * with an `Error` whose `message` is already fit to show somebody — this
	 * package cannot tell a server's words for a person from its words for a log.
	 */
	readonly asset: Promise<MediaAsset>;
	cancel: () => void;
}

/** A picture ready for an `<img>`. `release` frees whatever `src` held, and is
 *  a no-op where nothing was held; call it when the picture leaves the screen. */
export interface ShownPicture {
	src: string;
	release: () => void;
}

/** One already in the person's own store, as a picker lists it. */
export interface HeldPicture extends MediaAsset {
	filename: string;
}

export interface NoteMedia {
	/** `progress` runs from 0 to 1 while the bytes are moving. */
	send(file: File, progress: (fraction: number) => void): SendingPicture;
	/** A note's picture is private, so only its owner can be answered. */
	picture(uploadId: MediaAsset['upload_id']): Promise<ShownPicture>;
	/**
	 * What the person has already put in a note, newest first — so a picture can
	 * be used twice without being sent twice.
	 *
	 * Declared, not yet servable: nothing lists an identity's own uploads back to
	 * them, so every shell leaves this out today and the picker offers sending
	 * alone. Closing it is a route on the API and a method on `@sloppy/client`.
	 */
	library?(): Promise<HeldPicture[]>;
}

export interface NoteEmoji {
	/** What that identity's own instance serves, with `src` already resolved into
	 *  something an `<img>` may load. */
	catalog(did: string): Promise<readonly CustomEmojiEntry[]>;
	/** Absent → a catalog is readable here but cannot be added to. */
	add?(entry: { file: File; shortcode: string; kind: CustomEmojiKind }): Promise<void>;
	/** Absent → an entry cannot be taken back out of the catalog here. */
	remove?(id: CustomEmojiEntry['id']): Promise<void>;
}

export interface BlockStackProps {
	/** The node whose interior this is. */
	node: NodeView;
	/** Its stack, in `ord` order. */
	blocks: readonly BlockView[];
	onCreate: (request: CreateBlockRequest) => Promise<BlockView>;
	onUpdate: (ref: OwnedRef, request: UpdateBlockRequest) => Promise<BlockView>;
	onRemove: (ref: OwnedRef) => Promise<void>;
	/** `null` moves the block to the top of the stack. */
	onReorder: (ref: OwnedRef, after: OwnedRef | null) => Promise<BlockView>;
	/** Absent → a note takes no pictures and nothing offers to add one. */
	media?: NoteMedia;
	/** Absent → the Unicode set is the whole of what a `:shortcode:` can name,
	 *  and one naming a picture stays written as the text it was typed as. */
	emoji?: NoteEmoji;
}
