// What a section written on somebody else's instance may be drawn from.

import type { BlockDocument, BlockView, DocumentNode } from '@sloppy/types';
import { EMOJI_NODE } from '../editor/emoji-node.js';
import { PICTURE_NODE, storedPicture } from '../editor/picture-node.js';

/**
 * How an element a peer sent is read, where that is not simply how it stands.
 * `BlockDocumentSchema` carries `attrs` without reading them, so a peer chooses
 * what an element arrives holding — and a picture's `preview` is an address the
 * drawing code puts straight into an `<img>`. Reading each element as its own
 * module WRITES one is what stops a stranger choosing what the reader's browser
 * fetches; AI.md § "Sloppy's Vocabulary Stays Out of the Identity Store".
 */
const READ_AS: Partial<Record<string, (node: DocumentNode) => DocumentNode | null>> = {
	[PICTURE_NODE]: storedPicture,
	[EMOJI_NODE]: withoutMintedSrc
};

/**
 * The same sections, every element read as the kind it claims to be. An emoji is
 * the one whose stored form carries an address at all — its author's own
 * instance minted it — and the shortcode stands for itself until this instance
 * resolves that author's catalog.
 */
export function withoutPeerAddresses(blocks: readonly BlockView[]): BlockView[] {
	return blocks.map((block) => ({ ...block, content: local(block.content) }));
}

function local(document: BlockDocument): BlockDocument {
	return { ...document, content: elements(document.content) };
}

function elements(nodes: readonly DocumentNode[]): DocumentNode[] {
	const kept: DocumentNode[] = [];
	for (const node of nodes) {
		const read = READ_AS[node.type];
		const held = read
			? read(node)
			: node.content
				? { ...node, content: elements(node.content) }
				: node;
		if (held) kept.push(held);
	}
	return kept;
}

function withoutMintedSrc(node: DocumentNode): DocumentNode {
	if (node.attrs?.src === undefined) return node;
	return { ...node, attrs: { ...node.attrs, src: '' } };
}
