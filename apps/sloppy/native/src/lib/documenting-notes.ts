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
	tagsAmong,
	ulid,
	type BlockDocument,
	type NodeView,
	type NoteLeft,
	type OwnedRef,
	type ProposedPlace,
	type Tag
} from '@sloppy/types';
import { emptySidecars, fromMarkdown, toMarkdown, type Sidecars } from '@sloppy/vault';
import type { NoteAsWritten, SaidNote } from './documenting-tool';

/** A store over the notes for the project rooted at `root`, writing as the
 *  container rather than as whoever is signed in here. */
export function containerApi(root: string, files: Files): LocalApi {
	return new LocalApi(keepingDataAt(files.at(root), containerDataAt(root)));
}

/** More of a graph's vocabulary than a prompt needs: past this a tool is
 *  reading a list rather than choosing from one. */
const MOST_TAGS_SHOWN = 40;

/** One note in the container, the code it points at, and the note it hangs
 *  under. */
export interface NoteHere {
	ref: OwnedRef;
	origin: OwnedRef;
	paths: string[];
}

/** The container as a run found it. */
export interface ContainerNotes {
	notes: NoteHere[];
	/** What the notes about this project's code hang under — the project's own
	 *  note in a container `sloppy init` started. Absent where nothing here
	 *  points at code, and where two branches of notes do, which a run has no
	 *  way to choose between. */
	branch?: OwnedRef;
}

export async function notesHere(api: LocalApi): Promise<ContainerNotes> {
	const held = new Map<OwnedRef, NoteHere>();
	for (const branch of await api.listNodes({})) {
		for (const note of await api.listNodes({ origin: branch.ref })) {
			if (held.has(note.ref)) continue;
			held.set(note.ref, {
				ref: note.ref,
				origin: note.origin,
				paths: await anchorsIn(api, note.ref)
			});
		}
	}
	const notes = [...held.values()];
	const origins = new Set(notes.filter((one) => one.paths.length > 0).map((one) => one.origin));
	const [branch] = origins;
	return { notes, ...(origins.size === 1 ? { branch } : {}) };
}

/** Every path the notes reach, so a survey proposes no second note about one. */
export function pathsWritten(notes: readonly NoteHere[]): string[] {
	return [...new Set(notes.flatMap((held) => held.paths))].sort();
}

/** The note about this place, where one is there. */
export function noteAbout(notes: readonly NoteHere[], path: string): OwnedRef | undefined {
	return notes.find((held) => held.paths.includes(path))?.ref;
}

/** The note about the nearest folder above `path`, and nothing where no note
 *  reaches that far. */
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

/** The note a place already has, and what the markdown the tool is shown
 *  cannot carry: a drawing's strokes and a picture's size are in `aside`
 *  rather than in `shown`, so what the tool hands back is only read back with
 *  the `aside` it was shown from. */
export interface StandingNote {
	note: NodeView;
	shown: NoteAsWritten;
	aside: Sidecars;
}

/** The note this place already has, whether the plan named it or the notes
 *  themselves point at it. */
export async function standingNote(
	api: LocalApi,
	notes: readonly NoteHere[],
	place: ProposedPlace
): Promise<StandingNote | undefined> {
	for (const ref of [place.note, noteAbout(notes, place.path)]) {
		if (ref === undefined) continue;
		const held = await api.getNode(ref);
		if (held) return await asWritten(api, held);
	}
	return undefined;
}

async function asWritten(api: LocalApi, note: NodeView): Promise<StandingNote> {
	const blocks = await api.listBlocks(note.ref);
	const aside = emptySidecars(splitOwnedRef(note.ref).localId);
	const sections = blocks.map((block) => {
		const id = splitOwnedRef(block.ref).localId;
		// A drawing's files are named after the section it is in, not the note.
		return { id, markdown: toMarkdown(block.content, { ...aside, block: id }) };
	});
	return { note, shown: { title: note.title, sections }, aside };
}

/** What the run leaves at a place. Absent is a place the tool had nothing to
 *  say about, which is an answer. A new note hangs under the note about the
 *  nearest folder above it, and otherwise under the container's own branch —
 *  docs/ARCHITECTURE.md § "Tooling and the review" is the shape it joins.
 *  `here` gains what a new note is about, so the rest of the run reads the
 *  container as it now stands. */
export async function writeNote(
	api: LocalApi,
	here: ContainerNotes,
	place: ProposedPlace,
	standing: StandingNote | undefined,
	said: SaidNote
): Promise<NoteLeft | undefined> {
	if (said.sections.length === 0) return undefined;
	const aside = standing?.aside ?? emptySidecars(ulid());
	const sections = said.sections.map((markdown) => fromMarkdown(markdown, aside));
	const allowed = place.tags ?? [];
	const suggested = tagsAmong(said.tags ?? []).filter(
		(tag) => !allowed.includes(tag) && !(standing?.note.tags ?? []).includes(tag)
	);
	const beside = suggested.length === 0 ? {} : { suggested };
	if (standing) {
		const { done } = await writeOnto(api, standing.note, sections, allowed);
		return { ref: standing.note.ref, done, ...beside };
	}
	const under = noteOver(here.notes, place.path) ?? here.branch;
	const note = await api.createNode({
		from: under === undefined ? { relation: 'free' } : { relation: 'under', note: under },
		title: said.title ?? place.path,
		tags: [...allowed]
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
	here.notes.push({
		ref: note.ref,
		origin: note.origin,
		paths: pathsIn(sections, place.path)
	});
	return { ref: note.ref, done: 'written', ...beside };
}

/** The tags this container already classifies by, the most used first, so a
 *  tool is shown the vocabulary rather than inventing a second name for a
 *  scope that has one. */
export async function tagsHere(api: LocalApi): Promise<Tag[]> {
	return (await api.listTags()).slice(0, MOST_TAGS_SHOWN).map((held) => held.tag);
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
