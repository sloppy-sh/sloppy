// One editor built exactly the way the block surface builds it, so a test
// exercises the schema the product runs on rather than a smaller one.

import type { BlockDocument, BlockView, DocumentNode, NodeView, OwnedRef } from '@sloppy/types';
import { Editor } from '@tiptap/core';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import StarterKit from '@tiptap/starter-kit';
import type { CustomEmojiEntry } from '../../emoji/catalog.js';
import type { NoteEmoji, NoteMedia, NoteReferences } from './contract.js';
import { docBlocks, openBlocks, type SavedBlock } from './document.js';
import { EmojiNode } from './emoji-node.js';
import { InkNode } from './ink-node.js';
import { PictureNode } from './picture-node.js';
import { ReferenceNode } from './reference-node.js';
import { NoteDocument, SectionNode } from './section-node.js';

export const OWNER = 'did:syr:z6MkwSiAvviKsS8dvXsScr4ipdeZwusLQY92cWWBisnvpJLc';

let ulid = 0;
export function ref(): OwnedRef {
	return `${OWNER}/${(++ulid).toString(36).toUpperCase().padStart(26, '0')}` as OwnedRef;
}

/** One section, from the elements written into it. */
export function section(...elements: DocumentNode[]): BlockDocument {
	return { type: 'doc', content: elements };
}

export function text(...lines: string[]): DocumentNode[] {
	return lines.map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] }));
}

export function block(partial: Partial<BlockView> = {}): BlockView {
	return {
		ref: ref(),
		node: `${OWNER}/${'0'.repeat(26)}` as OwnedRef,
		created_by: OWNER,
		created_at: '2026-01-01T00:00:00.000Z',
		updated_at: '2026-01-01T00:00:00.000Z',
		ord: 'a0',
		content: section(),
		...partial
	} as BlockView;
}

export const NOTE: NodeView = {
	ref: `${OWNER}/${'0'.repeat(26)}` as OwnedRef,
	created_by: OWNER,
	created_at: '2026-01-01T00:00:00.000Z',
	updated_at: '2026-01-01T00:00:00.000Z',
	address: '1a',
	depth: 2,
	origin: `${OWNER}/${'0'.repeat(26)}` as OwnedRef,
	title: 'A thought',
	tags: [],
	links: [],
	published: false
};

/** A store that answers nothing, for a test about something else. */
export function noMedia(): NoteMedia {
	return {
		send: () => ({ asset: new Promise<never>(() => {}), cancel: () => {} }),
		picture: async (uploadId) => ({ src: `blob:${uploadId}`, release: () => {} }),
		library: async () => []
	};
}

export function noEmoji(catalog: readonly CustomEmojiEntry[] = []): NoteEmoji {
	return {
		mine: OWNER,
		catalog: async () => catalog,
		add: async () => {},
		remove: async () => {}
	};
}

/** A graph with nothing else in it, for a test about something else. */
export function noNotes(): NoteReferences {
	return {
		find: () => [],
		read: async () => null,
		write: async () => {
			throw new Error('That note could not be added. Try again in a moment.');
		},
		open: () => {}
	};
}

/** jsdom has no 2D context, and the ink surfaces ask for one on every repaint. */
export function stubCanvas(): void {
	HTMLCanvasElement.prototype.getContext = (() => ({
		setTransform() {},
		clearRect() {},
		beginPath() {},
		drawImage() {},
		moveTo() {},
		lineTo() {},
		stroke() {},
		arc() {},
		fill() {},
		lineCap: '',
		lineJoin: '',
		lineWidth: 0,
		strokeStyle: '',
		fillStyle: ''
	})) as unknown as HTMLCanvasElement['getContext'];
}

/** The editor and the baseline it opened with, exactly as the surface takes them. */
export function makeEditor(blocks: readonly BlockView[] = []): {
	editor: Editor;
	saved: SavedBlock[];
} {
	const element = document.createElement('div');
	document.body.appendChild(element);
	const editor = new Editor({
		element,
		extensions: [
			StarterKit.configure({ document: false }),
			NoteDocument,
			SectionNode,
			TaskList,
			TaskItem.configure({ nested: true }),
			EmojiNode(() => []),
			InkNode,
			PictureNode(() => undefined),
			ReferenceNode(() => undefined)
		]
	});
	const opening = openBlocks(blocks, editor.schema);
	editor.commands.setContent(opening.doc, { emitUpdate: false });
	return { editor, saved: opening.baseline(docBlocks(editor.state.doc)) };
}
