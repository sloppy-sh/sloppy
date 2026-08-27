// What a node's interior is handed and how it saves — docs/ARCHITECTURE.md
// § "Blocks and ink". Every kind of block, ink included, is a `type` with a
// renderer; none of them is a field here.

import type {
	BlockView,
	CreateBlockRequest,
	NodeView,
	OwnedRef,
	UpdateBlockRequest
} from '@sloppy/types';

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
}
