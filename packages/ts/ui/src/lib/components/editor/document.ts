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
import { PICTURE_NODE, pictureDataFrom, type PictureBlockData } from './picture-node.js';

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
	INK_NODE,
	PICTURE_NODE
] as const;

const TYPE_BY_NODE: Partial<Record<string, BlockType>> = {
	heading: 'heading',
	bulletList: 'list',
	orderedList: 'list',
	taskList: 'todo',
	codeBlock: 'code',
	[INK_NODE]: 'ink',
	[PICTURE_NODE]: 'image'
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
	/** The document node this row answers for; `ref` is only where it ended up. */
	uid: string;
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

/** Undefined until the bytes have landed and the block has an upload to name. */
export function pictureDataOf(node: ProseMirrorNode): PictureBlockData | undefined {
	return pictureDataFrom({
		upload_id: node.attrs.uploadId,
		width: node.attrs.width,
		height: node.attrs.height,
		alt: node.attrs.alt
	});
}

function pictureNodeFrom(block: BlockView, data: PictureBlockData): JSONContent {
	return {
		type: PICTURE_NODE,
		attrs: {
			blockUid: nextUid(),
			blockRef: block.ref,
			uploadId: data.upload_id,
			alt: data.alt ?? '',
			width: data.width ?? null,
			height: data.height ?? null
		}
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
		if (block.type === 'image') {
			// A row naming no upload has no picture to draw, so it is carried
			// untouched rather than opened as an empty one and saved back over.
			const picture = pictureDataFrom(block.data);
			if (picture) content.push(pictureNodeFrom(block, picture));
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
			divided.set(block.ref, {
				uid: nodes[0].attrs?.blockUid as string,
				ref: block.ref,
				type: block.type,
				content: block.content ?? ''
			});
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
					rows.push({
						uid: row.uid,
						ref: block.ref,
						type: row.type,
						content: row.content,
						data: row.data
					});
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
		if (node.type.name === PICTURE_NODE) {
			const picture = pictureDataOf(node);
			if (picture) blocks.push({ uid, ref, type: 'image', content: '', data: picture });
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
 * Where in `values` one longest strictly increasing run sits. Everything off it
 * is what has to move for the whole to be in order, which is what keeps one
 * block dragged across the stack to one `ord` rather than one per block it
 * passed.
 */
function longestRun(values: readonly number[]): number[] {
	const tails: number[] = [];
	const before: number[] = [];
	values.forEach((value, index) => {
		let low = 0;
		let high = tails.length;
		while (low < high) {
			const middle = (low + high) >> 1;
			if (values[tails[middle]] < value) low = middle + 1;
			else high = middle;
		}
		before[index] = low > 0 ? tails[low - 1] : -1;
		tails[low] = index;
	});
	const run: number[] = [];
	for (let index = tails.at(-1) ?? -1; index >= 0; index = before[index]) run.push(index);
	return run.reverse();
}

/**
 * What has to reach the API for the rows to say what the document says. A
 * create and a move both name the block they are to follow, so both are emitted
 * in document order and the deletions last — the anchor a block names is then
 * already where the document wants it.
 */
export function planSave(saved: readonly SavedBlock[], next: readonly DocBlock[]): SaveOp[] {
	const byRef = new Map(saved.map((row) => [row.ref, row]));
	const byUid = new Map(saved.map((row) => [row.uid, row]));
	// A block still carries its uid when the create that made it landed too late
	// to stamp the ref back into the document, so it is answered for, not remade.
	const rowFor = next.map(
		(block) => (block.ref ? byRef.get(block.ref) : undefined) ?? byUid.get(block.uid)
	);
	const kept = new Set<OwnedRef>();
	for (const row of rowFor) if (row) kept.add(row.ref);

	const order = saved.filter((row) => kept.has(row.ref)).map((row) => row.ref);
	const wanted = next.flatMap((_, index) => (rowFor[index] ? [index] : []));
	const staying = new Set(
		longestRun(wanted.map((at) => order.indexOf((rowFor[at] as SavedBlock).ref))).map(
			(place) => wanted[place]
		)
	);

	const ops: SaveOp[] = [];
	let previousUid: string | null = null;
	next.forEach((block, index) => {
		const row = rowFor[index];
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
			const change: SaveOp = { kind: 'update', ref: row.ref };
			if (row.type !== block.type) change.type = block.type;
			if (row.content !== block.content) change.content = block.content;
			if (!sameData(row.data, block.data)) change.data = block.data ?? null;
			if (change.type !== undefined || change.content !== undefined || change.data !== undefined) {
				ops.push(change);
			}
			if (!staying.has(index)) ops.push({ kind: 'reorder', ref: row.ref, after: previousUid });
		}
		previousUid = block.uid;
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
	for (const row of saved) refs.set(row.uid, row.ref);
	for (const block of next) if (block.ref) refs.set(block.uid, block.ref);
	const anchor = (uid: string | null) => (uid && refs.get(uid)) ?? null;

	for (const op of ops) {
		if (op.kind === 'create') {
			const after = anchor(op.after);
			const ref = await writer.create({
				after,
				type: op.type,
				content: op.content,
				...(op.data === undefined ? {} : { data: op.data })
			});
			refs.set(op.uid, ref);
			place(saved, after, { uid: op.uid, ref, type: op.type, content: op.content, data: op.data });
			writer.placed(op.uid, ref);
		} else if (op.kind === 'update') {
			const changes = {
				...(op.type === undefined ? {} : { type: op.type }),
				...(op.content === undefined ? {} : { content: op.content }),
				...(op.data === undefined ? {} : { data: op.data })
			};
			await writer.update(op.ref, changes);
			const row = saved.find((row) => row.ref === op.ref);
			if (row) Object.assign(row, changes);
		} else if (op.kind === 'reorder') {
			const after = anchor(op.after);
			await writer.reorder(op.ref, after);
			const at = saved.findIndex((row) => row.ref === op.ref);
			if (at >= 0) place(saved, after, saved.splice(at, 1)[0]);
		} else {
			await writer.remove(op.ref);
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
