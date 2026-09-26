/**
 * The notes a run reads and writes in a project's container. Its writer is the
 * container's own identity rather than the person's, and every write goes
 * through `writeOnto` in `@sloppy/local` — `DocumentingAccess.run` in
 * `@sloppy/app-core` says why both of those are so.
 */

import { containerDataAt, keepingDataAt, LocalApi, writeOnto, type Files } from '@sloppy/local';
import {
	anchorsOf,
	splitOwnedRef,
	ulid,
	type BlockDocument,
	type NodeView,
	type NoteLeft,
	type OwnedRef,
	type ProposedPlace
} from '@sloppy/types';
import { emptySidecars, fromMarkdown, toMarkdown } from '@sloppy/vault';
import type { NoteAsWritten, SaidNote } from './documenting-tool';

/** A store over the notes for the project rooted at `root`, writing as the
 *  container rather than as whoever is signed in here. */
export function containerApi(root: string, files: Files): LocalApi {
	return new LocalApi(keepingDataAt(files.at(root), containerDataAt(root)));
}

/** One note in the container, and the code it points at. */
export interface NoteHere {
	ref: OwnedRef;
	paths: string[];
}

export async function notesHere(api: LocalApi): Promise<NoteHere[]> {
	const held = new Map<OwnedRef, NoteHere>();
	for (const branch of await api.listNodes({})) {
		for (const note of await api.listNodes({ origin: branch.ref })) {
			if (held.has(note.ref)) continue;
			held.set(note.ref, { ref: note.ref, paths: await anchorsIn(api, note.ref) });
		}
	}
	return [...held.values()];
}

/** Every path the notes reach, so a survey proposes no second note about one. */
export function pathsWritten(notes: readonly NoteHere[]): string[] {
	return [...new Set(notes.flatMap((held) => held.paths))].sort();
}

/** The note about this place, where one is there. */
export function noteAbout(notes: readonly NoteHere[], path: string): OwnedRef | undefined {
	return notes.find((held) => held.paths.includes(path))?.ref;
}

/** The note a new one about `path` is written under: the one about the nearest
 *  folder above it, and nothing where no note reaches that far. */
function noteOver(notes: readonly NoteHere[], path: string): OwnedRef | undefined {
	let over: { ref: OwnedRef; at: string } | undefined;
	for (const held of notes) {
		for (const at of held.paths) {
			if (!path.startsWith(`${at}/`)) continue;
			if (over === undefined || at.length > over.at.length) over = { ref: held.ref, at };
		}
	}
	return over?.ref;
}

/** A note as the tool is shown it. */
export async function noteAsWritten(api: LocalApi, note: NodeView): Promise<NoteAsWritten> {
	const blocks = await api.listBlocks(note.ref);
	return {
		title: note.title,
		sections: blocks.map((block) => {
			const id = splitOwnedRef(block.ref).localId;
			return { id, markdown: toMarkdown(block.content, emptySidecars(id)) };
		})
	};
}

/** The note this place already has, whether the plan named it or the notes
 *  themselves point at it. */
export async function standingNote(
	api: LocalApi,
	notes: readonly NoteHere[],
	place: ProposedPlace
): Promise<NodeView | undefined> {
	for (const ref of [place.note, noteAbout(notes, place.path)]) {
		if (ref === undefined) continue;
		const held = await api.getNode(ref);
		if (held) return held;
	}
	return undefined;
}

/** What the run leaves at a place. Absent is a place the tool had nothing to
 *  say about, which is an answer. `notes` gains what a new note is about, so
 *  the rest of the run reads the container as it now stands. */
export async function writeNote(
	api: LocalApi,
	notes: NoteHere[],
	place: ProposedPlace,
	standing: NodeView | undefined,
	said: SaidNote
): Promise<NoteLeft | undefined> {
	if (said.sections.length === 0) return undefined;
	const sections = said.sections.map((markdown) => fromMarkdown(markdown, emptySidecars(ulid())));
	if (standing) {
		const { done } = await writeOnto(api, standing, sections);
		return { ref: standing.ref, done };
	}
	const under = noteOver(notes, place.path);
	const note = await api.createNode({
		from: under === undefined ? { relation: 'free' } : { relation: 'under', note: under },
		title: said.title ?? place.path,
		tags: []
	});
	let after: OwnedRef | undefined;
	for (const content of sections) {
		const block = await api.createBlock({
			node: note.ref,
			content,
			...(after === undefined ? {} : { after })
		});
		after = block.ref;
	}
	notes.push({ ref: note.ref, paths: pathsIn(sections, place.path) });
	return { ref: note.ref, done: 'written' };
}

async function anchorsIn(api: LocalApi, note: OwnedRef): Promise<string[]> {
	const paths = new Set<string>();
	for (const block of await api.listBlocks(note)) {
		for (const anchor of anchorsOf(block.content)) paths.add(anchor.path);
	}
	return [...paths];
}

function pathsIn(sections: readonly BlockDocument[], path: string): string[] {
	const paths = new Set<string>([path]);
	for (const content of sections) {
		for (const anchor of anchorsOf(content)) paths.add(anchor.path);
	}
	return [...paths];
}
