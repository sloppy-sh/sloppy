/**
 * Which notes a file in the project is the code of: every section whose
 * anchors reach it — docs/ARCHITECTURE.md § "A project's container". Read when
 * somebody asks and never kept; DESIGN.md § "An anchor into code" is how it is
 * drawn.
 */

import {
	anchorsOf,
	compareOrd,
	type BlockDocument,
	type CodeAnchor,
	type DocumentNode,
	type NodeView,
	type OwnedRef
} from '@sloppy/types';

/** One note and its sections, in the order they are read. */
export interface NoteSections {
	note: Pick<NodeView, 'ref' | 'title' | 'address'>;
	sections: readonly { ref: OwnedRef; content: BlockDocument }[];
}

/** One place a note points into a file, with the section that names it. */
export interface WhyHere {
	ref: OwnedRef;
	title: string;
	address?: string;
	anchor: CodeAnchor;
	/** The section the anchor is written in. */
	block: OwnedRef;
	/** That section's first heading, where it has one. */
	heading?: string;
	/** What the section says besides that heading, one paragraph a line. */
	text: string;
}

/** Whether an anchor reaches a file: it names that file, or a folder it is in. */
export function anchorReaches(anchor: CodeAnchor, path: string): boolean {
	return anchor.path === path || path.startsWith(`${anchor.path}/`);
}

/** Every place the notes point into `path`, note by note in the order given and
 *  each section's anchors in the order it names them — the answer
 *  `list_notes({ at })` gives an agent, with the section beside each one. */
export function notesReaching(notes: readonly NoteSections[], path: string): WhyHere[] {
	return notes.flatMap(({ note, sections }) =>
		sections.flatMap((section) => {
			const reaching = anchorsOf(section.content).filter((one) => anchorReaches(one, path));
			if (reaching.length === 0) return [];
			const { heading, text } = sectionSays(section.content);
			return reaching.map((anchor) => ({
				ref: note.ref,
				title: note.title,
				...(note.address === undefined ? {} : { address: note.address }),
				anchor,
				block: section.ref,
				...(heading === undefined ? {} : { heading }),
				text
			}));
		})
	);
}

/** The node kinds whose text is one paragraph of a section. */
const PARAGRAPHS = new Set(['paragraph', 'heading', 'codeBlock']);

function textOf(node: DocumentNode): string {
	if (typeof node.text === 'string') return node.text;
	return (node.content ?? []).map(textOf).join('');
}

/** A section's first heading, and the rest of its words a paragraph a line. */
export function sectionSays(content: BlockDocument): { heading?: string; text: string } {
	let heading: string | undefined;
	const lines: string[] = [];
	const walk = (node: DocumentNode): void => {
		if (PARAGRAPHS.has(node.type)) {
			const said = textOf(node).trim();
			if (said === '') return;
			if (heading === undefined && node.type === 'heading') heading = said;
			else lines.push(said);
			return;
		}
		for (const child of node.content ?? []) walk(child);
	};
	for (const node of content.content ?? []) walk(node);
	return { ...(heading === undefined ? {} : { heading }), text: lines.join('\n') };
}

/** Where the notes are read from: the graph in front of somebody, or a copy of
 *  it such as a draft. */
export interface NotesSource {
	listNodes(query?: { origin?: OwnedRef }): Promise<NodeView[]>;
	listBlocks(
		note: OwnedRef
	): Promise<readonly { ref: OwnedRef; ord: string; content: BlockDocument }[]>;
}

/** Every note in the source, each once, with its sections in order. */
export async function notesWithSections(source: NotesSource): Promise<NoteSections[]> {
	const held = new Map<OwnedRef, NodeView>();
	for (const branch of await source.listNodes({})) {
		if (!held.has(branch.ref)) held.set(branch.ref, branch);
		for (const note of await source.listNodes({ origin: branch.ref }).catch(() => [])) {
			if (!held.has(note.ref)) held.set(note.ref, note);
		}
	}
	return Promise.all(
		[...held.values()].map(async (note) => ({
			note,
			sections: [...(await source.listBlocks(note.ref).catch(() => []))].sort((a, b) =>
				compareOrd(a.ord, b.ord)
			)
		}))
	);
}

/** What a code sheet asks: which notes reach a file. The notes are read once,
 *  on the first question, and every question after is answered off that. */
export function provenanceOver(source: NotesSource): (path: string) => Promise<WhyHere[]> {
	let read: Promise<NoteSections[]> | null = null;
	return async (path) => notesReaching(await (read ??= notesWithSections(source)), path);
}
