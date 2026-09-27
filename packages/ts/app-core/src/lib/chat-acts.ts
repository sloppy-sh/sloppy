/**
 * Sloppy's own acts, done in the page an agent's chat runs in —
 * docs/ARCHITECTURE.md § "Asking a tool to write the notes". `ChatAccess` in
 * `runtime.ts` carries the two obligations this file keeps: the writer is the
 * project container's own identity rather than the person's, and every write
 * goes through `writeOnto`.
 *
 * What an answer RUNS TO is `listingAnswer`'s, `foundAnswer`'s and
 * `noteAnswer`'s in `@sloppy/types`, so nothing here decides how much of a
 * project one call carries.
 */

import { containerDataAt, type Files, keepingDataAt, LocalApi, writeOnto } from '@sloppy/local';
import {
	anchorsOf,
	type BlockDocument,
	type ChatToolAnswer,
	type ChatToolCall,
	CODE_SCHEME,
	type EdgeLook,
	type FoundNote,
	foundAnswer,
	type ListedNote,
	listingAnswer,
	lookBetween,
	type NodeAppearance,
	type NodeView,
	noteAnswer,
	type NoteBinned,
	type NoteSection,
	type NoteWritten,
	type OwnedRef,
	type SearchHit,
	splitOwnedRef,
	type StyleEdgeArguments,
	type StyleNoteArguments,
	type Tag,
	tagsAmong,
	ulid
} from '@sloppy/types';
import { emptySidecars, fromMarkdown, toMarkdown } from '@sloppy/vault';
import { wordsFor } from './stores/errors.js';

const NO_NOTE = 'There is no note here with that ref. List the notes and read one of those.';
const NOTHING_WRITTEN = 'That write named no sections, so nothing was written.';
const NO_PARENT =
	'There is no note here to write that one under. List the notes and name one of those.';
const NOT_WRITTEN = 'That note was not written.';
const NOT_CARRIED = 'That note was not carried anywhere.';
const NOTHING_TAGGED = 'That named no tags to put on and none to take off.';
const NOT_NUMBERED = 'That note was not numbered.';
const NOTHING_LINKED = 'That named no lines to draw and none to take off.';
const NO_OTHER_NOTE =
	'There is no note here at the other end of that line. List the notes and name one of those.';
const NOT_TO_ITSELF = 'A note draws no line to itself. Name the note at the other end.';
const NOT_LINKED = 'Those lines were left as they were.';
const NOTHING_DRAWN = 'That named nothing to draw and nothing to take off.';
const NOT_LOOKED = 'That line was left as it was.';
const NOT_DRAWN = 'That mark was left as it was.';

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
		case 'search_notes':
			return foundAnswer((await api.searchNotes(call.arguments.words)).map(asFound));
		case 'read_note':
			return await readNote(api, call.arguments.note);
		case 'write_note':
			return await writeNote(api, call.arguments);
		case 'move_note':
			return await moveNote(api, call.arguments);
		case 'tag_note':
			return await tagNote(api, call.arguments);
		case 'number_note':
			return await numberNote(api, call.arguments);
		case 'link_notes':
			return await linkNotes(api, call.arguments);
		case 'style_edge':
			return await styleEdge(api, call.arguments);
		case 'style_note':
			return await styleNote(api, call.arguments);
		case 'delete_note':
			return await deleteNote(api, call.arguments);
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
		...(note.parent === undefined ? {} : { parent: note.parent }),
		tags: [...note.tags],
		about: [...about],
		...(note.links.length === 0 ? {} : { links: [...note.links] })
	};
}

/** One note as an act that wrote on it answers with. */
async function listedAnswer(api: LocalApi, note: NodeView): Promise<ChatToolAnswer> {
	return { said: JSON.stringify(asListed(note, await anchorsIn(api, note.ref))) };
}

function asFound(hit: SearchHit): FoundNote {
	return {
		note: hit.note,
		title: hit.title,
		...(hit.address === undefined ? {} : { address: hit.address }),
		snippet: hit.snippet
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
	return noteAnswer(
		{
			...asListed(note, await anchorsIn(api, note.ref)),
			...(note.edges === undefined || note.edges.length === 0 ? {} : { edges: [...note.edges] })
		},
		sections
	);
}

async function writeNote(
	api: LocalApi,
	asked: Extract<ChatToolCall, { act: 'write_note' }>['arguments']
): Promise<ChatToolAnswer> {
	if (asked.sections.length === 0) return { said: NOTHING_WRITTEN, trouble: true };
	const here = await notesHere(api);
	const standing = here.find((held) => held.about.includes(asked.about))?.note;
	if (!standing && asked.under !== undefined && !(await api.getNode(asked.under))) {
		return { said: NO_PARENT, trouble: true };
	}
	const tags = tagsAmong(asked.tags ?? []);
	const aside = emptySidecars(
		standing === undefined ? ulid() : splitOwnedRef(standing.ref).localId
	);
	const sections = asked.sections.map((markdown) => fromMarkdown(markdown, aside));
	try {
		// Before the writing, so that a number the graph refuses leaves the note
		// as it was rather than written at the number it already had.
		if (standing && asked.address !== undefined) {
			await api.setAddress(standing.ref, asked.address);
		}
		const written = standing
			? { note: standing.ref, done: (await writeOnto(api, standing, sections, tags)).done }
			: {
					note: await startNote(api, here, asked, sections, tags),
					done: 'written' as const
				};
		return { said: JSON.stringify(written satisfies NoteWritten) };
	} catch (error) {
		return { said: wordsFor(error) ?? NOT_WRITTEN, trouble: true };
	}
}

/**
 * A note this project has none of yet. Where the agent named nothing to write
 * it under, it hangs under the note about the nearest folder above it, and
 * otherwise under whatever the notes about this code already hang under —
 * docs/ARCHITECTURE.md § "Tooling and the review" is the shape it joins.
 */
async function startNote(
	api: LocalApi,
	here: readonly NoteHere[],
	asked: Extract<ChatToolCall, { act: 'write_note' }>['arguments'],
	sections: readonly BlockDocument[],
	tags: readonly Tag[]
): Promise<OwnedRef> {
	const { about, title } = asked;
	const under = asked.under ?? noteOver(here, about) ?? branchOf(here);
	const note = await api.createNode({
		from: under === undefined ? { relation: 'free' } : { relation: 'under', note: under },
		title: title ?? about,
		tags: [...tags],
		...(asked.address === undefined ? {} : { address: asked.address })
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

/** A note carried somewhere else, by the rule `moveNote` in `@sloppy/local`
 *  holds a move to. */
async function moveNote(
	api: LocalApi,
	asked: Extract<ChatToolCall, { act: 'move_note' }>['arguments']
): Promise<ChatToolAnswer> {
	if (!(await api.getNode(asked.note))) return { said: NO_NOTE, trouble: true };
	try {
		const carried = await api.moveNote(
			asked.note,
			{ relation: asked.relation, note: asked.to },
			asked.address
		);
		const moved = carried.find((one) => one.ref === asked.note);
		if (!moved) return { said: NOT_CARRIED, trouble: true };
		return await listedAnswer(api, moved);
	} catch (error) {
		return { said: wordsFor(error) ?? NOT_CARRIED, trouble: true };
	}
}

/** A tag named both to put on and to take off comes off. */
async function tagNote(
	api: LocalApi,
	asked: Extract<ChatToolCall, { act: 'tag_note' }>['arguments']
): Promise<ChatToolAnswer> {
	const on = tagsAmong(asked.tags ?? []);
	const off = new Set<string>(tagsAmong(asked.off ?? []));
	if (on.length === 0 && off.size === 0) return { said: NOTHING_TAGGED, trouble: true };
	const note = await api.getNode(asked.note);
	if (!note) return { said: NO_NOTE, trouble: true };
	const tags = [...new Set([...note.tags, ...on])].filter((tag) => !off.has(tag));
	const written = await api.updateNode(asked.note, { tags });
	return await listedAnswer(api, written);
}

/** The label a person cites a note by, written or taken off. Every rule it is
 *  held to — unique in its graph, springing from the note above, the number it
 *  leaves still leading to it — is `setAddress` in `@sloppy/local`, which
 *  refuses in words the agent is handed. */
async function numberNote(
	api: LocalApi,
	asked: Extract<ChatToolCall, { act: 'number_note' }>['arguments']
): Promise<ChatToolAnswer> {
	if (!(await api.getNode(asked.note))) return { said: NO_NOTE, trouble: true };
	try {
		return await listedAnswer(api, await api.setAddress(asked.note, asked.address ?? null));
	} catch (error) {
		return { said: wordsFor(error) ?? NOT_NUMBERED, trouble: true };
	}
}

/** A note named both to draw a line to and to take one off loses its line. */
async function linkNotes(
	api: LocalApi,
	asked: Extract<ChatToolCall, { act: 'link_notes' }>['arguments']
): Promise<ChatToolAnswer> {
	const off = new Set<OwnedRef>(asked.off ?? []);
	const to = [...new Set(asked.to ?? [])].filter((one) => !off.has(one));
	if (to.length === 0 && off.size === 0) return { said: NOTHING_LINKED, trouble: true };
	const note = await api.getNode(asked.note);
	if (!note) return { said: NO_NOTE, trouble: true };
	if (to.includes(asked.note)) return { said: NOT_TO_ITSELF, trouble: true };
	for (const other of to) {
		if (!(await api.getNode(other))) return { said: NO_OTHER_NOTE, trouble: true };
	}
	const links = [...new Set([...note.links, ...to])].filter((one) => !off.has(one));
	try {
		return await listedAnswer(api, await api.updateNode(asked.note, { links }));
	} catch (error) {
		return { said: wordsFor(error) ?? NOT_LINKED, trouble: true };
	}
}

/**
 * The look on one line. It is written on the end already carrying the pair's
 * look, so one line keeps one — and the arrowhead is read against the note it
 * is written on, so it turns with it.
 */
async function styleEdge(
	api: LocalApi,
	asked: Extract<ChatToolCall, { act: 'style_edge' }>['arguments']
): Promise<ChatToolAnswer> {
	if (asked.to === asked.note) return { said: NOT_TO_ITSELF, trouble: true };
	if (!saysAnything([asked.label, asked.direction, asked.stroke], asked.off)) {
		return { said: NOTHING_DRAWN, trouble: true };
	}
	const note = await api.getNode(asked.note);
	if (!note) return { said: NO_NOTE, trouble: true };
	const other = await api.getNode(asked.to);
	if (!other) return { said: NO_OTHER_NOTE, trouble: true };
	const won = lookBetween(note, other);
	const on = won !== undefined && won.to === note.ref ? other : note;
	const at = on === note ? other : note;
	const look = lookAsked(won, asked, at.ref, on !== note);
	const edges = [...(on.edges ?? []).filter((one) => one.to !== at.ref), look];
	try {
		return await listedAnswer(api, await api.updateNode(on.ref, { edges }));
	} catch (error) {
		return { said: wordsFor(error) ?? NOT_LOOKED, trouble: true };
	}
}

/** Whether a look act names anything at all — a channel to set, or one to take
 *  back off. */
function saysAnything(channels: readonly unknown[], off: readonly unknown[] | undefined): boolean {
	return channels.some((said) => said !== undefined) || (off ?? []).length > 0;
}

/** Which end an arrowhead sits at, read from the other end of the same line. */
function facing(direction: EdgeLook['direction']): EdgeLook['direction'] {
	if (direction === 'to') return 'from';
	return direction === 'from' ? 'to' : direction;
}

/** The look the line is left with: what it already reads as, what this act
 *  says, and the channels it takes back off. */
function lookAsked(
	held: EdgeLook | undefined,
	asked: StyleEdgeArguments,
	to: OwnedRef,
	turned: boolean
): EdgeLook {
	const off = new Set<string>(asked.off ?? []);
	const kept = <T>(channel: string, said: T | undefined, was: T | undefined): T | undefined =>
		off.has(channel) ? undefined : (said ?? was);
	const label = kept('label', asked.label, held?.label);
	const direction = kept(
		'direction',
		turned ? facing(asked.direction) : asked.direction,
		held?.direction
	);
	const stroke = kept('stroke', asked.stroke, held?.stroke);
	return {
		to,
		...(label === undefined ? {} : { label }),
		...(direction === undefined ? {} : { direction }),
		...(stroke === undefined ? {} : { stroke })
	};
}

/** How a note's mark is drawn. A look with nothing left set leaves the note
 *  unstyled, which `lookWritten` in `@sloppy/local` is what recognises. */
async function styleNote(
	api: LocalApi,
	asked: Extract<ChatToolCall, { act: 'style_note' }>['arguments']
): Promise<ChatToolAnswer> {
	const named = [asked.ring_weight, asked.ring_style, asked.mark_radius];
	if (!saysAnything(named, asked.off)) return { said: NOTHING_DRAWN, trouble: true };
	const note = await api.getNode(asked.note);
	if (!note) return { said: NO_NOTE, trouble: true };
	const appearance = markAsked(note.appearance, asked);
	try {
		return await listedAnswer(api, await api.updateNode(asked.note, { appearance }));
	} catch (error) {
		return { said: wordsFor(error) ?? NOT_DRAWN, trouble: true };
	}
}

/** The channels this act writes, taken off what the note carries so that what
 *  it leaves out is left out rather than written twice. */
const MARK_SHAPE = ['ring_weight', 'ring_style', 'mark_radius', 'mark_scale'] as const;

function markAsked(held: NodeAppearance | undefined, asked: StyleNoteArguments): NodeAppearance {
	const off = new Set<string>(asked.off ?? []);
	const kept = <T>(channel: string, said: T | undefined, was: T | undefined): T | undefined =>
		off.has(channel) ? undefined : (said ?? was);
	const weight = kept('ring_weight', asked.ring_weight, held?.ring_weight);
	const style = kept('ring_style', asked.ring_style, held?.ring_style);
	const radius = kept('mark_radius', asked.mark_radius, held?.mark_radius);
	// A step and a fine size say one size two ways and the fine one is what
	// draws, so a step named here takes it off.
	const sized = asked.mark_radius !== undefined || off.has('mark_radius');
	const scale = sized ? undefined : held?.mark_scale;
	const pictures: NodeAppearance = { ...held };
	for (const channel of MARK_SHAPE) delete pictures[channel];
	return {
		...pictures,
		...(weight === undefined ? {} : { ring_weight: weight }),
		...(style === undefined ? {} : { ring_style: style }),
		...(radius === undefined ? {} : { mark_radius: radius }),
		...(scale === undefined ? {} : { mark_scale: scale })
	};
}

async function deleteNote(
	api: LocalApi,
	asked: Extract<ChatToolCall, { act: 'delete_note' }>['arguments']
): Promise<ChatToolAnswer> {
	const note = await api.getNode(asked.note);
	if (!note) return { said: NO_NOTE, trouble: true };
	const binned = asListed(note, await anchorsIn(api, note.ref));
	try {
		await api.deleteNode(asked.note);
	} catch (error) {
		return { said: wordsFor(error) ?? NO_NOTE, trouble: true };
	}
	return { said: JSON.stringify({ binned } satisfies NoteBinned) };
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
