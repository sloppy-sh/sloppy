// What a node's interior is handed and how it saves — docs/ARCHITECTURE.md
// § "Blocks and ink".
//
// This package reaches no API, so everything that talks to one arrives as a
// capability. Every one of them is required: a surface somebody writes in can
// send a picture and use the emoji they have, and an optional capability is a
// feature a shell can leave out without anything saying so. {@link NoteCode} is
// the exception, and its absence is a fact about the graph rather than a
// shell's choice.

import type {
	BlockView,
	CodeAnchor,
	CreateBlockRequest,
	CustomEmojiKind,
	MediaAsset,
	NodeView,
	OwnedRef,
	UpdateBlockRequest
} from '@sloppy/types';
import type { CustomEmojiEntry } from '../../emoji/catalog.js';
import type { DraftStore } from './document.js';

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
	/** What this surface offers the person to choose from, newest first — so a
	 *  picture can be used twice without being sent twice. Which of their
	 *  libraries that is is the caller's to decide. */
	library(): Promise<HeldPicture[]>;
	/** Out of the person's own store. Whatever still cites it — a section, a
	 *  mark, the ground — has nothing left to draw, so a surface asks first. */
	remove(uploadId: MediaAsset['upload_id']): Promise<void>;
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

/** A note in one of the author's other graphs, and what they call that graph.
 *  An address means one thing inside one graph, so the name is what tells the
 *  two `1a`s apart. */
export interface NoteElsewhere {
	note: NodeView;
	graph: string;
}

/**
 * How a note reaches the others from inside the writing: what `[[` finds, and
 * what a reference in a section resolves against. A reference draws a line on
 * the canvas, but not by writing one: `references` are derived from the words
 * themselves, and `links` stays what a hand drew — DESIGN.md § Edges rules on
 * both.
 *
 * `find` and `write` are both answered against the note being written in, which
 * is the shell's to know.
 */
export interface NoteReferences {
	/** Notes in THIS note's graph whose address or title carries `query`; all of
	 *  them where it is empty, in address order. */
	find(query: string): readonly NodeView[];
	/** The same, in the author's other graphs. Empty where they keep one — and a
	 *  reference into another graph is an ordinary reference once it is made. */
	elsewhere(query: string): readonly NoteElsewhere[];
	/** The note a reference names, as it stands now; `null` once there is no such
	 *  note. A rejection says nothing about whether it is there. */
	read(note: OwnedRef): Promise<NodeView | null>;
	/**
	 * Writes a note nobody has written yet, and answers with it. `free` springs
	 * it from nothing, in the graph the note being written is read in. Rejects
	 * with an `Error` whose `message` is already fit to show somebody — this
	 * package cannot tell a server's words for a person from its words for a
	 * log.
	 */
	write(title: string, relation: 'under' | 'after' | 'free'): Promise<NodeView>;
	/** Take the reader to a note. */
	open(note: OwnedRef): void;
}

/**
 * How the writing reaches the code it is about. **Absent is a graph with no
 * code beside it**, where an anchor is drawn and followed as the ordinary link
 * it is and nothing is offered to point at one — docs/ARCHITECTURE.md § "A
 * project's container".
 */
export interface NoteCode {
	/** Ask the writer where in the code to point. `undefined` is somebody who
	 *  named nowhere, and is not a failure. */
	cite(): Promise<CodeAnchor | undefined>;
	/** Show what is at an anchor. */
	show(anchor: CodeAnchor): void;
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
	code?: NoteCode;
	/** Where this note's writing waits while the API does not have it. */
	drafts: DraftStore;
	/** Said when the note opens holding both a section written elsewhere and the
	 *  version of it written on this device. */
	onBothVersions?: (note: OwnedRef) => void;
}
