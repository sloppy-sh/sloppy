// What a node's interior is handed and how it saves — docs/ARCHITECTURE.md
// § "Blocks and ink".
//
// This package reaches no API, so everything that talks to one arrives as a
// capability. Every one of them is required: a surface somebody writes in can
// send a picture and use the emoji they have, and an optional capability is a
// feature a shell can leave out without anything saying so.

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
	/** What the person has already put in a note, newest first — so a picture can
	 *  be used twice without being sent twice. */
	library(): Promise<HeldPicture[]>;
}

export interface NoteEmoji {
	/** Whose catalog is the person's own: what the picker offers under "Yours",
	 *  and what {@link add} and {@link remove} act on. A note somebody else wrote
	 *  still resolves its shortcodes against ITS author's catalog. */
	mine: string;
	/** What that identity's own instance serves, with `src` already resolved into
	 *  something an `<img>` may load. */
	catalog(did: string): Promise<readonly CustomEmojiEntry[]>;
	add(entry: { file: File; shortcode: string; kind: CustomEmojiKind }): Promise<void>;
	remove(id: CustomEmojiEntry['id']): Promise<void>;
}

/**
 * How a note reaches the others from inside the writing: what `[[` finds, and
 * what a reference in a section resolves against. Nothing here writes
 * `node.links` — DESIGN.md § Edges is the ruling.
 *
 * `find` and `write` are both answered against the note being written in, which
 * is the shell's to know: a relation is `under` this note or `after` it.
 */
export interface NoteReferences {
	/** Notes whose address or title carries `query`; all of them where it is
	 *  empty, in address order. */
	find(query: string): readonly NodeView[];
	/** The note a reference names, as it stands now; `null` once there is no such
	 *  note. A rejection says nothing about whether it is there. */
	read(note: OwnedRef): Promise<NodeView | null>;
	/**
	 * Writes a note nobody has written yet, and answers with it. Rejects with an
	 * `Error` whose `message` is already fit to show somebody — this package
	 * cannot tell a server's words for a person from its words for a log.
	 */
	write(title: string, relation: 'under' | 'after'): Promise<NodeView>;
	/** Take the reader to a note. */
	open(note: OwnedRef): void;
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
	media: NoteMedia;
	emoji: NoteEmoji;
	references: NoteReferences;
}
