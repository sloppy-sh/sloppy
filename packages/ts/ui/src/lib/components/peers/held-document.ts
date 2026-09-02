// What a section written on somebody else's instance may be drawn from.

import type { BlockDocument, BlockView, DocumentNode } from '@sloppy/types';
import { EMOJI_NODE } from '../editor/emoji-node.js';

/**
 * The same sections with every emoji's picture address dropped. A pulled
 * document carries the addresses its author's own instance minted, and an
 * `<img>` pointed at one would tell that instance who is reading — AI.md
 * § "Sloppy's Vocabulary Stays Out of the Identity Store". What draws instead
 * is the author's catalog as this instance resolved it, or the shortcode alone.
 *
 * Every other element addresses what it needs by an id the API answers for, so
 * this is the whole of it.
 */
export function withoutPeerAddresses(blocks: readonly BlockView[]): BlockView[] {
	return blocks.map((block) => ({ ...block, content: local(block.content) }));
}

function local(document: BlockDocument): BlockDocument {
	return { ...document, content: document.content.map(element) };
}

function element(node: DocumentNode): DocumentNode {
	const within = node.content ? { content: node.content.map(element) } : {};
	if (node.type !== EMOJI_NODE || node.attrs?.src === undefined) {
		return { ...node, ...within };
	}
	return { ...node, ...within, attrs: { ...node.attrs, src: '' } };
}
