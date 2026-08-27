// The seam between a node's stack of block rows and the one editable document
// they are written in — docs/ARCHITECTURE.md § "Blocks and ink". Each top-level
// node in the document IS a block; `blockUid` identifies one across an edit and
// `blockRef` names the row it was loaded from.

import type { BlockType, BlockView, InkBlockData, OwnedRef } from '@sloppy/types';
import { InkBlockDataSchema } from '@sloppy/types';
import { Extension, type JSONContent } from '@tiptap/core';
import type { MarkdownManager } from '@tiptap/markdown';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';

export const INK_NODE = 'ink';

/** Every node kind that can stand at the top of a node's interior. */
export const BLOCK_NODES = [
	'paragraph',
	'heading',
	'bulletList',
	'orderedList',
	'taskList',
	'codeBlock',
	'blockquote',
	'horizontalRule',
	INK_NODE
] as const;

const TYPE_BY_NODE: Partial<Record<string, BlockType>> = {
	heading: 'heading',
	bulletList: 'list',
	orderedList: 'list',
	taskList: 'todo',
	codeBlock: 'code',
	[INK_NODE]: 'ink'
};

/** Prose the enum does not name — a quote, a rule — keeps its Markdown as a paragraph. */
export function blockTypeOf(nodeName: string): BlockType {
	return TYPE_BY_NODE[nodeName] ?? 'paragraph';
}

/** The kinds a row can be written back as: one for every node this document has. */
const WRITABLE_TYPES: ReadonlySet<BlockType> = new Set<BlockType>([
	'paragraph',
	...Object.values(TYPE_BY_NODE).filter((type): type is BlockType => type !== undefined)
]);

/** Only these carry `blockUid` and `blockRef`, so only these can be a row. */
const IDENTIFIED_NODES: ReadonlySet<string> = new Set(BLOCK_NODES);

let sequence = 0;
function nextUid(): string {
	return `b${++sequence}`;
}

export interface DocBlock {
	uid: string;
	/** Null until the row exists. */
	ref: OwnedRef | null;
	type: BlockType;
	content: string;
	data?: unknown;
}

/** What a row holds, as far as the surface knows: the last thing it saw saved. */
export interface SavedBlock {
	ref: OwnedRef;
	type: BlockType;
	content: string;
	data?: unknown;
}

/** `after` is the uid of the block this one follows, so a create can anchor to a create. */
export type SaveOp =
	| {
			kind: 'create';
			uid: string;
			after: string | null;
			type: BlockType;
			content: string;
			data?: unknown;
	  }
	| { kind: 'update'; ref: OwnedRef; type?: BlockType; content?: string; data?: unknown }
	| { kind: 'reorder'; ref: OwnedRef; after: string | null }
	| { kind: 'remove'; ref: OwnedRef };

export function inkDataOf(node: ProseMirrorNode): InkBlockData {
	return {
		strokes: node.attrs.strokes ?? [],
		width: node.attrs.width,
		height: node.attrs.height,
		...(node.attrs.rasterUploadId ? { raster_upload_id: node.attrs.rasterUploadId } : {})
	};
}

function inkNodeFrom(block: BlockView): JSONContent {
	const parsed = InkBlockDataSchema.safeParse(block.data);
	const data: InkBlockData = parsed.success
		? parsed.data
		: { strokes: [], width: 600, height: 200 };
	return {
		type: INK_NODE,
		attrs: {
			blockUid: nextUid(),
			blockRef: block.ref,
			strokes: data.strokes,
			width: data.width,
			height: data.height,
			rasterUploadId: data.raster_upload_id ?? null
		}
	};
}

export interface Opened {
	doc: JSONContent;
	/**
	 * What the API holds for the rows this document answers for, in its order.
	 * `opened` is {@link docBlocks} of the document once the editor has it.
	 */
	baseline(opened: readonly DocBlock[]): SavedBlock[];
}

/**
 * The document a stack of rows opens as, and the truth a save plan is measured
 * against. A row this surface has no node for, or whose Markdown opens as
 * something that cannot hold a row's identity, is in neither, and so is carried
 * untouched. A row whose Markdown opens as several nodes keeps the first as
 * itself and is baselined as stored, so the first save truncates it to that
 * node and writes out the rest.
 */
export function openBlocks(blocks: readonly BlockView[], manager: MarkdownManager): Opened {
	const content: JSONContent[] = [];
	const divided = new Map<OwnedRef, SavedBlock>();

	for (const block of blocks) {
		if (block.type === 'ink') {
			content.push(inkNodeFrom(block));
			continue;
		}
		if (!WRITABLE_TYPES.has(block.type)) continue;
		const parsed = manager.parse(block.content ?? '').content ?? [];
		const nodes = parsed.length > 0 ? parsed : [{ type: 'paragraph' }];
		if (!nodes.every((node) => IDENTIFIED_NODES.has(node.type ?? ''))) continue;
		nodes.forEach((node, index) => {
			node.attrs = {
				...node.attrs,
				blockUid: nextUid(),
				blockRef: index === 0 ? block.ref : null
			};
		});
		if (nodes.length > 1) {
			divided.set(block.ref, { ref: block.ref, type: block.type, content: block.content ?? '' });
		}
		content.push(...nodes);
	}
	if (content.length === 0) {
		content.push({ type: 'paragraph', attrs: { blockUid: nextUid(), blockRef: null } });
	}

	return {
		doc: { type: 'doc', content },
		baseline(opened) {
			const read = new Map(opened.flatMap((row) => (row.ref ? [[row.ref, row] as const] : [])));
			const rows: SavedBlock[] = [];
			for (const block of blocks) {
				const held = divided.get(block.ref);
				if (held) {
					rows.push(held);
					continue;
				}
				const row = read.get(block.ref);
				if (row) {
					rows.push({ ref: block.ref, type: row.type, content: row.content, data: row.data });
				}
			}
			return rows;
		}
	};
}

/**
 * The rows the document currently describes. An empty text block is not one: the
 * blank line a writer is about to type into never becomes a row, and clearing a
 * block deletes it.
 */
export function docBlocks(doc: ProseMirrorNode, manager: MarkdownManager): DocBlock[] {
	const blocks: DocBlock[] = [];
	doc.forEach((node) => {
		const uid = (node.attrs.blockUid as string | null) ?? nextUid();
		const ref = (node.attrs.blockRef as OwnedRef | null) ?? null;
		if (node.type.name === INK_NODE) {
			blocks.push({ uid, ref, type: 'ink', content: '', data: inkDataOf(node) });
			return;
		}
		const content = manager.serialize(node.toJSON() as JSONContent).trim();
		if (content) blocks.push({ uid, ref, type: blockTypeOf(node.type.name), content });
	});
	return blocks;
}

function sameData(a: unknown, b: unknown): boolean {
	return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * What has to reach the API for the rows to say what the document says. Creates
 * and updates come first in document order, then any move, then the deletions —
 * an anchor is still there when the block that names it is placed.
 */
export function planSave(saved: readonly SavedBlock[], next: readonly DocBlock[]): SaveOp[] {
	const byRef = new Map(saved.map((block) => [block.ref, block]));
	const kept = new Set<OwnedRef>();
	const ops: SaveOp[] = [];

	let previousUid: string | null = null;
	for (const block of next) {
		const row = block.ref ? byRef.get(block.ref) : undefined;
		if (!row) {
			ops.push({
				kind: 'create',
				uid: block.uid,
				after: previousUid,
				type: block.type,
				content: block.content,
				...(block.data === undefined ? {} : { data: block.data })
			});
		} else {
			kept.add(row.ref);
			const change: SaveOp = { kind: 'update', ref: row.ref };
			if (row.type !== block.type) change.type = block.type;
			if (row.content !== block.content) change.content = block.content;
			if (!sameData(row.data, block.data)) change.data = block.data ?? null;
			if (change.type !== undefined || change.content !== undefined || change.data !== undefined) {
				ops.push(change);
			}
		}
		previousUid = block.uid;
	}

	const order = saved.filter((row) => kept.has(row.ref)).map((row) => row.ref);
	const wanted = next.filter((block) => block.ref && kept.has(block.ref));
	wanted.forEach((block, index) => {
		const ref = block.ref as OwnedRef;
		if (order[index] === ref) return;
		order.splice(order.indexOf(ref), 1);
		order.splice(index, 0, ref);
		const before = next[next.indexOf(block) - 1];
		ops.push({ kind: 'reorder', ref, after: before ? before.uid : null });
	});

	for (const row of saved) {
		if (!kept.has(row.ref)) ops.push({ kind: 'remove', ref: row.ref });
	}
	return ops;
}

export interface BlockWriter {
	create(request: {
		after: OwnedRef | null;
		type: BlockType;
		content: string;
		data?: unknown;
	}): Promise<OwnedRef>;
	update(
		ref: OwnedRef,
		changes: { type?: BlockType; content?: string; data?: unknown }
	): Promise<void>;
	reorder(ref: OwnedRef, after: OwnedRef | null): Promise<void>;
	remove(ref: OwnedRef): Promise<void>;
	/** The row a new block became, so the document can carry it from here on. */
	placed(uid: string, ref: OwnedRef): void;
	/** True once the surface has moved to another note and none of this matters. */
	abandoned?(): boolean;
}

function place(saved: SavedBlock[], after: OwnedRef | null, row: SavedBlock): void {
	const at = after ? saved.findIndex((row) => row.ref === after) : -1;
	saved.splice(at + 1, 0, row);
}

/**
 * Carries out a plan, keeping `saved` true to the API after every single call —
 * so a run that fails half way leaves a record of what landed, and the next plan
 * is the remainder rather than the whole thing again.
 */
export async function runSave(
	ops: readonly SaveOp[],
	saved: SavedBlock[],
	next: readonly DocBlock[],
	writer: BlockWriter
): Promise<void> {
	const refs = new Map<string, OwnedRef>();
	for (const block of next) if (block.ref) refs.set(block.uid, block.ref);
	const anchor = (uid: string | null) => (uid && refs.get(uid)) ?? null;

	for (const op of ops) {
		if (writer.abandoned?.()) return;
		if (op.kind === 'create') {
			const after = anchor(op.after);
			const ref = await writer.create({
				after,
				type: op.type,
				content: op.content,
				...(op.data === undefined ? {} : { data: op.data })
			});
			if (writer.abandoned?.()) return;
			refs.set(op.uid, ref);
			writer.placed(op.uid, ref);
			place(saved, after, { ref, type: op.type, content: op.content, data: op.data });
		} else if (op.kind === 'update') {
			const changes = {
				...(op.type === undefined ? {} : { type: op.type }),
				...(op.content === undefined ? {} : { content: op.content }),
				...(op.data === undefined ? {} : { data: op.data })
			};
			await writer.update(op.ref, changes);
			if (writer.abandoned?.()) return;
			const row = saved.find((row) => row.ref === op.ref);
			if (row) Object.assign(row, changes);
		} else if (op.kind === 'reorder') {
			const after = anchor(op.after);
			await writer.reorder(op.ref, after);
			if (writer.abandoned?.()) return;
			const at = saved.findIndex((row) => row.ref === op.ref);
			if (at >= 0) place(saved, after, saved.splice(at, 1)[0]);
		} else {
			await writer.remove(op.ref);
			if (writer.abandoned?.()) return;
			const at = saved.findIndex((row) => row.ref === op.ref);
			if (at >= 0) saved.splice(at, 1);
		}
	}
}

/**
 * Identity for the blocks in a document. A split copies its origin's attributes,
 * so the copy is the block that has to be renamed — the first node holding a uid
 * keeps it, and every later claimant becomes a new, unsaved block.
 */
export const BlockIdentity = Extension.create({
	name: 'blockIdentity',

	addGlobalAttributes() {
		return [
			{
				types: [...BLOCK_NODES],
				// Carried on the element so a block cut and pasted back into the note
				// is the same row moved, not the old one deleted and a new one made.
				attributes: {
					blockUid: {
						default: null,
						parseHTML: (el) => el.getAttribute('data-block-uid'),
						renderHTML: (attrs) => (attrs.blockUid ? { 'data-block-uid': attrs.blockUid } : {})
					},
					blockRef: {
						default: null,
						parseHTML: (el) => el.getAttribute('data-block-ref'),
						renderHTML: (attrs) => (attrs.blockRef ? { 'data-block-ref': attrs.blockRef } : {})
					}
				}
			}
		];
	},

	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: new PluginKey('blockIdentity'),
				appendTransaction: (_transactions, _old, state) => {
					const claimed = new Set<string>();
					let tr: ReturnType<typeof state.tr.setNodeMarkup> | null = null;
					state.doc.forEach((node, pos) => {
						if (!('blockUid' in node.attrs)) return;
						const uid = node.attrs.blockUid as string | null;
						if (uid && !claimed.has(uid)) {
							claimed.add(uid);
							return;
						}
						const fresh = nextUid();
						claimed.add(fresh);
						tr = (tr ?? state.tr).setNodeMarkup(pos, undefined, {
							...node.attrs,
							blockUid: fresh,
							blockRef: null
						});
					});
					return tr ? (tr as typeof state.tr).setMeta('addToHistory', false) : null;
				}
			})
		];
	}
});
