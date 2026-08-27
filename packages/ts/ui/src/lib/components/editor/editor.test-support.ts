// One editor built exactly the way the block surface builds it, so a test
// exercises the schema the product runs on rather than a smaller one.

import type { BlockView, NodeView, OwnedRef } from '@sloppy/types';
import { Editor } from '@tiptap/core';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { BlockIdentity, docBlocks, openBlocks, type SavedBlock } from './document.js';
import { EmojiNode } from './emoji-node.js';
import { InkNode } from './ink-node.js';
import { PictureNode } from './picture-node.js';

export const OWNER = 'did:syr:z6MkwSiAvviKsS8dvXsScr4ipdeZwusLQY92cWWBisnvpJLc';

let ulid = 0;
export function ref(): OwnedRef {
	return `${OWNER}/${(++ulid).toString(36).toUpperCase().padStart(26, '0')}` as OwnedRef;
}

export function block(partial: Partial<BlockView> & Pick<BlockView, 'type'>): BlockView {
	return {
		ref: ref(),
		node: `${OWNER}/${'0'.repeat(26)}` as OwnedRef,
		created_by: OWNER,
		created_at: '2026-01-01T00:00:00.000Z',
		updated_at: '2026-01-01T00:00:00.000Z',
		ord: 'a0',
		content: '',
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
	labels: {},
	links: [],
	published: false
};

/** jsdom has no 2D context, and the ink surfaces ask for one on every repaint. */
export function stubCanvas(): void {
	HTMLCanvasElement.prototype.getContext = (() => ({
		setTransform() {},
		clearRect() {},
		beginPath() {},
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
			StarterKit,
			Markdown,
			TaskList,
			TaskItem.configure({ nested: true }),
			BlockIdentity,
			EmojiNode(() => []),
			InkNode,
			PictureNode(() => undefined)
		]
	});
	const manager = editor.storage.markdown.manager;
	const opening = openBlocks(blocks, manager);
	editor.commands.setContent(opening.doc, { emitUpdate: false });
	return { editor, saved: opening.baseline(docBlocks(editor.state.doc, manager)) };
}
