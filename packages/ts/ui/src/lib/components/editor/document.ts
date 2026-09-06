// The seam between a note's stack of block rows and the one document its
// sections are written in — docs/ARCHITECTURE.md § "Blocks and ink". A section
// IS a block: `blockUid` identifies one across an edit and `blockRef` names the
// row it was loaded from.

import {
	type BlockDocument,
	type BlockView,
	type DocumentNode,
	type OwnedRef,
	type Timestamp,
	readsAsInk
} from '@sloppy/types';
import type { JSONContent } from '@tiptap/core';
import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';
import { INK_NODE } from './ink-node.js';
import { PICTURE_NODE, storedPicture } from './picture-node.js';
import { nextUid, SECTION_NODE } from './section-node.js';

/** How an element is written down, where that is not simply how it stands. */
const STORED_AS: Partial<Record<string, (node: DocumentNode) => DocumentNode | null>> = {
	[PICTURE_NODE]: storedPicture
};

/**
 * Whether an element's own module can read its `attrs`. `BlockDocumentSchema`
 * carries that payload without reading it, so this is where it is read —
 * docs/ARCHITECTURE.md § "Blocks and ink".
 */
const CLAIMED_BY: Partial<Record<string, (attrs: unknown) => boolean>> = {
	[INK_NODE]: readsAsInk
};

export interface DocBlock {
	uid: string;
	/** Null until the row exists. */
	ref: OwnedRef | null;
	content: BlockDocument;
}

/** What a row holds, as far as the surface knows: the last thing it saw saved. */
export interface SavedBlock {
	/** The section this row answers for; `ref` is only where it ended up. */
	uid: string;
	ref: OwnedRef;
	content: BlockDocument;
	/** The stamp the row carried when the surface last saw it. The next write to
	 *  it is conditioned on this; absent asks for no condition. */
	updated_at?: Timestamp;
}

/**
 * A note's writing that has not reached the API: what the surface planned to
 * write, and the rows it was measured against. Kept on the device, so it holds
 * plain data only. The uids in it belong to the page that wrote it, and a draft
 * opened again is given fresh ones.
 */
export interface NoteDraft {
	rows: SavedBlock[];
	next: DocBlock[];
}

/** Where a note's unsent writing waits. This package keeps nothing of its own;
 *  the app hands in the store it keeps. */
export interface DraftStore {
	read(note: OwnedRef): Promise<NoteDraft | null>;
	/** Which draft the note holds now; 0 where none has been kept for it. */
	last(note: OwnedRef): number;
	/** Answers with which draft this is. `which` writes only where nothing has
	 *  been kept for the note since, so a trip outliving the surface that asked
	 *  for it cannot write over what a later surface is holding. */
	keep(note: OwnedRef, draft: NoteDraft, which?: number): number;
	/** `which` drops the draft only where nothing has been kept since. */
	forget(note: OwnedRef, which?: number): void;
	/** A write reached the server: whatever is still held for the note is on its
	 *  way rather than waiting here. */
	landed(note: OwnedRef): void;
}

/** Why a write did not land, as far as it decides what the surface does next. */
export type SaveTrouble =
	/** Trying again is what fixes it. */
	| 'transient'
	/** The section was written somewhere else in between, and this write was
	 *  refused rather than taking that writing with it. */
	| 'elsewhere'
	/** Trying again cannot land it; `message` is already fit to show somebody. */
	| 'refused';

/** What a write capability rejects with when the surface has to act on WHY.
 *  Anything else it rejects with is read as trouble worth trying again. */
export class SaveFailure extends Error {
	constructor(
		readonly trouble: SaveTrouble,
		says = ''
	) {
		super(says);
	}
}

/** `after` is the uid of the block this one follows, so a create can anchor to a create. */
export type SaveOp =
	| { kind: 'create'; uid: string; after: string | null; content: BlockDocument }
	| { kind: 'update'; ref: OwnedRef; content: BlockDocument }
	| { kind: 'reorder'; ref: OwnedRef; after: string | null }
	| { kind: 'remove'; ref: OwnedRef };

function keepAll(nodes: readonly DocumentNode[]): DocumentNode[] {
	const kept: DocumentNode[] = [];
	for (const node of nodes) {
		const stored = STORED_AS[node.type];
		const held = stored
			? stored(node)
			: node.content
				? { ...node, content: keepAll(node.content) }
				: node;
		if (held) kept.push(held);
	}
	return kept;
}

/** One section, written down. */
function storedContent(section: ProseMirrorNode): BlockDocument {
	const json = section.toJSON() as DocumentNode;
	return { type: 'doc', content: keepAll(json.content ?? []) };
}

/** Whether anything in a section survives being written down. */
function written(node: ProseMirrorNode): boolean {
	const stored = STORED_AS[node.type.name];
	if (stored) return stored(node.toJSON() as DocumentNode) !== null;
	if (node.isText) return (node.text ?? '').length > 0;
	if (node.isLeaf) return true;
	let any = false;
	node.forEach((child) => {
		any ||= written(child);
	});
	return any;
}

function sameDocument(a: BlockDocument, b: BlockDocument): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/** False for an element this build cannot draw: a kind or a mark it has no
 *  renderer for, or attributes the renderer that owns them will not take. */
function readable(node: DocumentNode, schema: Schema): boolean {
	if (!schema.nodes[node.type]) return false;
	if (CLAIMED_BY[node.type]?.(node.attrs) === false) return false;
	if (node.marks?.some((mark) => !schema.marks[mark.type])) return false;
	return (node.content ?? []).every((child) => readable(child, schema));
}

function sectionOf(
	content: BlockDocument,
	ref: OwnedRef | null,
	schema: Schema
): JSONContent | null {
	const elements = content?.content ?? [];
	if (!elements.every((element) => readable(element, schema))) return null;
	return {
		type: SECTION_NODE,
		attrs: { blockUid: nextUid(), blockRef: ref },
		content: elements.length > 0 ? (elements as JSONContent[]) : [{ type: 'paragraph' }]
	};
}

function emptySection(): JSONContent {
	return {
		type: SECTION_NODE,
		attrs: { blockUid: nextUid(), blockRef: null },
		content: [{ type: 'paragraph' }]
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
 * `apart` is what the API holds for a row the document on screen does not say:
 * one a draft has unsent writing for, and one it has taken away. Everywhere
 * else the document is what the API answered with, and the editor's own reading
 * of it is what the next plan is measured against.
 */
function baselineOf(
	blocks: readonly BlockView[],
	apart?: ReadonlyMap<OwnedRef, BlockDocument>
): (opened: readonly DocBlock[]) => SavedBlock[] {
	return (opened) => {
		const read = new Map(opened.flatMap((row) => (row.ref ? [[row.ref, row] as const] : [])));
		return blocks.flatMap((block) => {
			const row = read.get(block.ref);
			const held = apart?.get(block.ref);
			if (!row && !held) return [];
			return [
				{
					uid: row?.uid ?? nextUid(),
					ref: block.ref,
					content: held ?? (row as DocBlock).content,
					updated_at: block.updated_at
				}
			];
		});
	};
}

/**
 * The document a stack of rows opens as, and the truth a save plan is measured
 * against. A row holding an element this build cannot read is in neither, and
 * so is carried untouched. A note with no rows yet opens as one empty section,
 * which becomes a row when something is written into it.
 */
export function openBlocks(blocks: readonly BlockView[], schema: Schema): Opened {
	const content: JSONContent[] = [];
	for (const block of blocks) {
		const section = sectionOf(block.content, block.ref, schema);
		if (section) content.push(section);
	}
	if (content.length === 0) content.push(emptySection());

	return { doc: { type: 'doc', content }, baseline: baselineOf(blocks) };
}

/**
 * The same, for a note this device is still holding writing for: the draft is
 * what opens, measured against the stack the API has answered with since.
 *
 * A section taken away elsewhere is not brought back, and one written elsewhere
 * stands as it came in with the unsent writing beside it as a section of its
 * own — neither version of a section is ever dropped for the other.
 */
export function openDraft(draft: NoteDraft, blocks: readonly BlockView[], schema: Schema): Opened {
	const held = new Map(blocks.map((block) => [block.ref, block]));
	const measured = new Map(draft.rows.map((row) => [row.ref, row]));
	const elsewhere = (ref: OwnedRef): boolean => {
		const was = measured.get(ref);
		const now = held.get(ref);
		return was !== undefined && now !== undefined && was.updated_at !== now.updated_at;
	};

	const entries: { content: BlockDocument; ref: OwnedRef | null }[] = [];
	/** What the API holds for a row the document on screen does not say. */
	const apart = new Map<OwnedRef, BlockDocument>();
	for (const block of draft.next) {
		if (!block.ref) {
			entries.push({ content: block.content, ref: null });
			continue;
		}
		const row = held.get(block.ref);
		if (!row) continue;
		if (elsewhere(block.ref)) {
			entries.push({ content: row.content, ref: row.ref });
			if (!sameDocument(row.content, block.content)) {
				entries.push({ content: block.content, ref: null });
			}
			continue;
		}
		entries.push({ content: block.content, ref: block.ref });
		apart.set(block.ref, measured.get(block.ref)?.content ?? row.content);
	}

	let at = -1;
	for (const block of blocks) {
		const found = entries.findIndex((entry) => entry.ref === block.ref);
		if (found >= 0) {
			at = found;
			continue;
		}
		// A section the draft took away stays away, unless somebody has written
		// into it since: nobody's writing goes because somebody else's went.
		if (measured.has(block.ref) && !elsewhere(block.ref)) continue;
		entries.splice(at + 1, 0, { content: block.content, ref: block.ref });
		at += 1;
	}

	// A section this device took away is still a row the API holds, so the plan
	// measured against this baseline is what takes it away there too.
	for (const was of draft.rows) {
		if (elsewhere(was.ref) || entries.some((entry) => entry.ref === was.ref)) continue;
		apart.set(was.ref, was.content);
	}

	const content: JSONContent[] = [];
	for (const entry of entries) {
		const section = sectionOf(entry.content, entry.ref, schema);
		if (section) content.push(section);
	}
	if (content.length === 0) content.push(emptySection());

	return { doc: { type: 'doc', content }, baseline: baselineOf(blocks, apart) };
}

/** One section holding a run of text somebody arrived with, a paragraph to a
 *  line. Empty where there is nothing to write. */
export function textDocument(text: string): BlockDocument {
	const content: DocumentNode[] = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] }));
	return { type: 'doc', content };
}

/** The one section a note opens on when somebody arrives holding writing for
 *  it. Null where they arrived with nothing. */
export function textSection(text: string): JSONContent | null {
	const said = textDocument(text).content as JSONContent[];
	return said.length === 0 ? null : { ...emptySection(), content: said };
}

/**
 * The rows the document currently describes. A section holding nothing is not
 * one until it is one: the empty section a note opens on never becomes a row on
 * its own, and a section already saved keeps its row when it is emptied.
 */
export function docBlocks(doc: ProseMirrorNode): DocBlock[] {
	const blocks: DocBlock[] = [];
	doc.forEach((section) => {
		if (section.type.name !== SECTION_NODE) return;
		const uid = (section.attrs.blockUid as string | null) ?? nextUid();
		const ref = (section.attrs.blockRef as OwnedRef | null) ?? null;
		if (!ref && !written(section)) return;
		blocks.push({ uid, ref, content: storedContent(section) });
	});
	return blocks;
}

/**
 * Where in `values` one longest strictly increasing run sits. Everything off it
 * is what has to move for the whole to be in order, which is what keeps one
 * section dragged across the stack to one `ord` rather than one per section it
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
			ops.push({ kind: 'create', uid: block.uid, after: previousUid, content: block.content });
		} else {
			if (!sameDocument(row.content, block.content)) {
				ops.push({ kind: 'update', ref: row.ref, content: block.content });
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
	/** The row the block became, and the stamp it carries now. */
	create(request: {
		after: OwnedRef | null;
		content: BlockDocument;
	}): Promise<{ ref: OwnedRef; updated_at?: Timestamp }>;
	/**
	 * `expects` is the stamp the surface last saw on this row. A row that has
	 * moved past it refuses the write rather than taking whatever was written
	 * there with it. Answers with the stamp the row carries now.
	 */
	update(
		ref: OwnedRef,
		content: BlockDocument,
		expects: Timestamp | undefined
	): Promise<Timestamp | undefined>;
	reorder(ref: OwnedRef, after: OwnedRef | null): Promise<Timestamp | undefined>;
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
			const made = await writer.create({ after, content: op.content });
			refs.set(op.uid, made.ref);
			place(saved, after, {
				uid: op.uid,
				ref: made.ref,
				content: op.content,
				updated_at: made.updated_at
			});
			writer.placed(op.uid, made.ref);
		} else if (op.kind === 'update') {
			const row = saved.find((row) => row.ref === op.ref);
			const stamp = await writer.update(op.ref, op.content, row?.updated_at);
			if (row) {
				row.content = op.content;
				row.updated_at = stamp ?? row.updated_at;
			}
		} else if (op.kind === 'reorder') {
			const after = anchor(op.after);
			const stamp = await writer.reorder(op.ref, after);
			const at = saved.findIndex((row) => row.ref === op.ref);
			if (at >= 0) {
				const [row] = saved.splice(at, 1);
				row.updated_at = stamp ?? row.updated_at;
				place(saved, after, row);
			}
		} else {
			await writer.remove(op.ref);
			const at = saved.findIndex((row) => row.ref === op.ref);
			if (at >= 0) saved.splice(at, 1);
		}
	}
}
