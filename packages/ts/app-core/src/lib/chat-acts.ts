/**
 * Sloppy's own acts, done in the page an agent's chat runs in —
 * docs/ARCHITECTURE.md § "Asking a tool to write the notes". `ChatAccess` in
 * `runtime.ts` carries the two obligations this file keeps: the writer is the
 * project container's own identity rather than the person's, and every write
 * goes through `writeOnto`.
 *
 * What an answer RUNS TO is `listingAnswer`'s and `noteAnswer`'s in
 * `@sloppy/types`, so nothing here decides how much of a project one call
 * carries.
 */

import { containerDataAt, type Files, keepingDataAt, LocalApi, writeOnto } from '@sloppy/local';
import {
	anchorsOf,
	type BlockDocument,
	type ChatToolAnswer,
	type ChatToolCall,
	CODE_SCHEME,
	type ListedNote,
	listingAnswer,
	type NodeView,
	noteAnswer,
	type NoteSection,
	type NoteWritten,
	type OwnedRef,
	splitOwnedRef,
	type Tag,
	tagsAmong,
	ulid
} from '@sloppy/types';
import { emptySidecars, fromMarkdown, toMarkdown } from '@sloppy/vault';

const NO_NOTE = 'There is no note here with that ref. List the notes and read one of those.';
const NOTHING_WRITTEN = 'That write named no sections, so nothing was written.';

/** A store over the notes for the project `files` is rooted at, writing as the
 *  container rather than as whoever is signed in here. */
export function containerApi(files: Files): LocalApi {
	return new LocalApi(keepingDataAt(files, containerDataAt(files.root)));
}

/** One of Sloppy's own acts, done and answered. The arguments arrived parsed;
 *  what this answers with is what the agent reads. */
export async function serveChatCall(files: Files, call: ChatToolCall): Promise<ChatToolAnswer> {
	const api = containerApi(files);
	switch (call.act) {
		case 'list_notes':
			return listingAnswer((await notesHere(api)).map((held) => asListed(held.note, held.about)));
		case 'read_note':
			return await readNote(api, call.arguments.note);
		case 'write_note':
			return await writeNote(api, call.arguments);
		case 'tag_note':
			return await tagNote(api, call.arguments.note, call.arguments.tags);
	}
}

/** One note in the container and the places in the code it reaches. */
interface NoteHere {
	note: NodeView;
	about: string[];
}

async function notesHere(api: LocalApi): Promise<NoteHere[]> {
	const held = new Map<OwnedRef, NoteHere>();
	for (const branch of await api.listNodes({})) {
		for (const note of await api.listNodes({ origin: branch.ref })) {
			if (held.has(note.ref)) continue;
			held.set(note.ref, { note, about: await anchorsIn(api, note.ref) });
		}
	}
	return [...held.values()];
}

function asListed(note: NodeView, about: readonly string[]): ListedNote {
	return {
		note: note.ref,
		title: note.title,
		...(note.address === undefined ? {} : { address: note.address }),
		tags: [...note.tags],
		about: [...about]
	};
}

async function readNote(api: LocalApi, ref: OwnedRef): Promise<ChatToolAnswer> {
	const note = await api.getNode(ref);
	if (!note) return { said: NO_NOTE, trouble: true };
	const aside = emptySidecars(splitOwnedRef(note.ref).localId);
	const sections: NoteSection[] = (await api.listBlocks(note.ref)).map((block) => {
		const id = splitOwnedRef(block.ref).localId;
		// A drawing's files are named after the section it is in, not the note.
		return { id, markdown: toMarkdown(block.content, { ...aside, block: id }) };
	});
	return noteAnswer(asListed(note, await anchorsIn(api, note.ref)), sections);
}

async function writeNote(
	api: LocalApi,
	asked: Extract<ChatToolCall, { act: 'write_note' }>['arguments']
): Promise<ChatToolAnswer> {
	if (asked.sections.length === 0) return { said: NOTHING_WRITTEN, trouble: true };
	const here = await notesHere(api);
	const standing = here.find((held) => held.about.includes(asked.about))?.note;
	const tags = tagsAmong(asked.tags ?? []);
	const aside = emptySidecars(
		standing === undefined ? ulid() : splitOwnedRef(standing.ref).localId
	);
	const sections = asked.sections.map((markdown) => fromMarkdown(markdown, aside));
	const written = standing
		? { note: standing.ref, done: (await writeOnto(api, standing, sections, tags)).done }
		: {
				note: await startNote(api, here, asked.about, asked.title, sections, tags),
				done: 'written' as const
			};
	return { said: JSON.stringify(written satisfies NoteWritten) };
}

/**
 * A note this project has none of yet. It hangs under the note about the
 * nearest folder above it, and otherwise under whatever the notes about this
 * code already hang under — docs/ARCHITECTURE.md § "Tooling and the review" is
 * the shape it joins.
 */
async function startNote(
	api: LocalApi,
	here: readonly NoteHere[],
	about: string,
	title: string | undefined,
	sections: readonly BlockDocument[],
	tags: readonly Tag[]
): Promise<OwnedRef> {
	const under = noteOver(here, about) ?? branchOf(here);
	const note = await api.createNode({
		from: under === undefined ? { relation: 'free' } : { relation: 'under', note: under },
		title: title ?? about,
		tags: [...tags]
	});
	let after: OwnedRef | undefined;
	for (const content of bodyAbout(about, sections)) {
		const block = await api.createBlock({
			node: note.ref,
			content,
			...(after === undefined ? {} : { after })
		});
		after = block.ref;
	}
	return note.ref;
}

/** A note started about a place opens with an anchor to it where its sections
 *  reach it nowhere: the places a note is about are read back off its anchors
 *  and off nothing else, so one carrying none is about nowhere. */
function bodyAbout(about: string, sections: readonly BlockDocument[]): BlockDocument[] {
	const reaches = sections.some((content) =>
		anchorsOf(content).some((anchor) => anchor.path === about)
	);
	return reaches ? [...sections] : [pointingAt(about), ...sections];
}

function pointingAt(about: string): BlockDocument {
	return {
		type: 'doc',
		content: [
			{
				type: 'paragraph',
				content: [
					{
						type: 'text',
						text: about,
						marks: [{ type: 'link', attrs: { href: `${CODE_SCHEME}${about}` } }]
					}
				]
			}
		]
	};
}

async function tagNote(
	api: LocalApi,
	ref: OwnedRef,
	asked: readonly string[]
): Promise<ChatToolAnswer> {
	const note = await api.getNode(ref);
	if (!note) return { said: NO_NOTE, trouble: true };
	const tags = [...new Set([...note.tags, ...tagsAmong(asked)])];
	const written = await api.updateNode(ref, { tags });
	return { said: JSON.stringify(asListed(written, await anchorsIn(api, ref))) };
}

/** The note about the nearest folder above `path`, and nothing where no note
 *  reaches that far. */
function noteOver(here: readonly NoteHere[], path: string): OwnedRef | undefined {
	let over: { note: OwnedRef; at: string } | undefined;
	for (const held of here) {
		for (const at of held.about) {
			if (!path.startsWith(`${at}/`)) continue;
			if (over === undefined || at.length > over.at.length) over = { note: held.note.ref, at };
		}
	}
	return over?.note;
}

/** What the notes about this project's code hang under. Absent where nothing
 *  here points at code, and where two branches do, which nothing can choose
 *  between. */
function branchOf(here: readonly NoteHere[]): OwnedRef | undefined {
	const origins = new Set(
		here.filter((held) => held.about.length > 0).map((held) => held.note.origin)
	);
	const [only] = origins;
	return origins.size === 1 ? only : undefined;
}

async function anchorsIn(api: LocalApi, note: OwnedRef): Promise<string[]> {
	const paths = new Set<string>();
	for (const block of await api.listBlocks(note)) {
		for (const anchor of anchorsOf(block.content)) paths.add(anchor.path);
	}
	return [...paths];
}
