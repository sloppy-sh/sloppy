/**
 * Sloppy's own acts, done in the page an agent's chat runs in —
 * docs/ARCHITECTURE.md § "Asking a tool to write the notes". `ChatAccess` in
 * `runtime.ts` carries the two obligations this file keeps: the writer is the
 * project container's own identity rather than the person's, and every write
 * goes through `writeOnto`.
 *
 * An act answers two readers: `said` is the agent's, and the line, the card and
 * the notes it left different are the person's. What an answer RUNS TO is
 * `listingAnswer`'s, `foundAnswer`'s and `noteAnswer`'s in `@sloppy/types`, so
 * nothing here decides how much of a project one call carries.
 */

import { containerDataAt, type Files, keepingDataAt, LocalApi, writeOnto } from '@sloppy/local';
import {
	sectionHeadings,
	CARD_ROWS,
	CARD_NONE,
	A_NOTE,
	anchorsOf,
	type BlockDocument,
	CHAT_TOLD_MAX,
	type ChatActDone,
	type ChatCard,
	cardRow,
	chatCard,
	type ChatToolAnswer,
	type ChatToolCall,
	CODE_SCHEME,
	type DeleteNoteArguments,
	type EdgeDirection,
	type EdgeLook,
	type EdgeLookChannel,
	type FoundNote,
	foundAnswer,
	type LinkNotesArguments,
	type ListedNote,
	listingAnswer,
	lookBetween,
	type MarkChannel,
	MOST_NOTES_TOUCHED,
	type MoveNoteArguments,
	type NodeAppearance,
	type NodeView,
	noteAnswer,
	type NoteBinned,
	type NoteSection,
	type NoteWritten,
	type NumberNoteArguments,
	type OwnedRef,
	type SearchHit,
	splitOwnedRef,
	type StyleEdgeArguments,
	type StyleNoteArguments,
	type Tag,
	type TagNoteArguments,
	tagsAmong,
	ulid,
	type WriteNoteArguments
} from '@sloppy/types';
import {
	EDGE_STROKE_LABELS,
	MARK_RADIUS_LABELS,
	RING_STYLE_LABELS,
	RING_WEIGHT_LABELS
} from '@sloppy/ui';
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

/** The person's half of what the agent was told above: the same fact, without
 *  the sentence telling an agent what to call next. */
const NO_NOTE_TOLD = 'That note is not here.';
const NO_OTHER_NOTE_TOLD = 'The note at the other end is not here.';
const NO_PARENT_TOLD = 'There is no note here to write that one under.';
const NOTHING_WRITTEN_TOLD = 'Nothing to write.';
const NOTHING_TAGGED_TOLD = 'No tags named.';
const NOTHING_LINKED_TOLD = 'No lines named.';
const NOTHING_DRAWN_TOLD = 'Nothing named to draw.';
const NOT_TO_ITSELF_TOLD = 'A note draws no line to itself.';
const TOO_MANY_HERE = 'Too many notes here to read at once.';
const TOO_MANY_FOUND = 'Too many notes carry those words.';
const TOO_LONG_TO_READ = 'That note is too long to read in one go.';

const RING = 'Ring';
const RING_STYLE = 'Ring style';
const SIZE = 'Size';

/** A channel taken back off reads as what the graph draws without it. */

/** A store over the notes for the project `files` is rooted at, writing as the
 *  container rather than as whoever is signed in here. */
export function containerApi(files: Files): LocalApi {
	return new LocalApi(keepingDataAt(files, containerDataAt(files.root)));
}

/**
 * A store over the notes a PLACE already holds: a folder beside the project
 * that a thread reads. A folder holding none is said rather than made into a
 * graph, and every act that would write refuses.
 */
export function placeApi(files: Files): LocalApi {
	return new LocalApi(keepingDataAt(files, containerDataAt(files.root)), { reading: true });
}

/**
 * One of Sloppy's own acts, done and answered. The arguments arrived parsed;
 * `said` is what the agent reads and the rest is the person's.
 *
 * `reading` is a folder beside the project, served by {@link placeApi} — so
 * nothing an act does there lands.
 */
export async function serveChatCall(
	files: Files,
	call: ChatToolCall,
	reading = false
): Promise<ChatActDone> {
	const done = await act(reading ? placeApi(files) : containerApi(files), call);
	return done.told === undefined ? done : { ...done, told: shortly(done.told) };
}

async function act(api: LocalApi, call: ChatToolCall): Promise<ChatActDone> {
	switch (call.act) {
		case 'list_notes': {
			const here = await notesHere(api);
			const answer = listingAnswer(here.map((held) => asListed(held.note, held.about)));
			return {
				...answer,
				told: answer.trouble ? TOO_MANY_HERE : notesHereTold(here.length),
				touched: []
			};
		}
		case 'search_notes': {
			const hits = (await api.searchNotes(call.arguments.words)).map(asFound);
			const answer = foundAnswer(hits);
			return {
				...answer,
				told: answer.trouble ? TOO_MANY_FOUND : notesFoundTold(hits.length),
				touched: []
			};
		}
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

/** One note as an act that wrote on it answers the agent with. */
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

async function readNote(api: LocalApi, ref: OwnedRef): Promise<ChatActDone> {
	const note = await api.getNode(ref);
	if (!note) return trouble(NO_NOTE, NO_NOTE_TOLD);
	const aside = emptySidecars(splitOwnedRef(note.ref).localId);
	const sections: NoteSection[] = (await api.listBlocks(note.ref)).map((block) => {
		const id = splitOwnedRef(block.ref).localId;
		// A drawing's files are named after the section it is in, not the note.
		return { id, markdown: toMarkdown(block.content, { ...aside, block: id }) };
	});
	const answer = noteAnswer(
		{
			...asListed(note, await anchorsIn(api, note.ref)),
			...(note.edges === undefined || note.edges.length === 0 ? {} : { edges: [...note.edges] })
		},
		sections
	);
	return { ...answer, told: answer.trouble ? TOO_LONG_TO_READ : heads(note), touched: [] };
}

async function writeNote(api: LocalApi, asked: WriteNoteArguments): Promise<ChatActDone> {
	if (asked.sections.length === 0) return trouble(NOTHING_WRITTEN, NOTHING_WRITTEN_TOLD);
	const here = await notesHere(api);
	const standing = here.find((held) => held.about.includes(asked.about))?.note;
	if (!standing && asked.under !== undefined && !(await api.getNode(asked.under))) {
		return trouble(NO_PARENT, NO_PARENT_TOLD);
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
		const written: NoteWritten = standing
			? { note: standing.ref, done: (await writeOnto(api, standing, sections, tags)).done }
			: { note: await startNote(api, here, asked, sections, tags), done: 'written' };
		const note = await api.getNode(written.note);
		return {
			said: JSON.stringify(written),
			told: written.done === 'offered' ? 'Offered on a note somebody else wrote.' : 'Written.',
			card: writeCard(asked, note ?? undefined, headingIn(here, note?.parent)),
			touched: [written.note]
		};
	} catch (error) {
		return troubleWriting(error, NOT_WRITTEN);
	}
}

/**
 * A note this project has none of yet. Where the agent named nothing to write
 * it under, it hangs under the note about the nearest folder above it, and
 * otherwise under whatever the notes about this code already hang under —
 * docs/ARCHITECTURE.md § "Tooling" is the shape it joins.
 */
async function startNote(
	api: LocalApi,
	here: readonly NoteHere[],
	asked: WriteNoteArguments,
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
async function moveNote(api: LocalApi, asked: MoveNoteArguments): Promise<ChatActDone> {
	if (!(await api.getNode(asked.note))) return trouble(NO_NOTE, NO_NOTE_TOLD);
	const to = await api.getNode(asked.to);
	try {
		const carried = await api.moveNote(
			asked.note,
			{ relation: asked.relation, note: asked.to },
			asked.address
		);
		const moved = carried.find((one) => one.ref === asked.note);
		if (!moved) return trouble(NOT_CARRIED);
		const going = carried.length - 1;
		return {
			...(await listedAnswer(api, moved)),
			told: going === 0 ? 'Carried.' : `Carried, with ${notesSaid(going)} beneath it.`,
			card: moveCard(moved, asked.relation, to ?? undefined, going, moved.address),
			...touchedBy(carried.map((one) => one.ref))
		};
	} catch (error) {
		return troubleWriting(error, NOT_CARRIED);
	}
}

/** A tag named both to put on and to take off comes off. */
async function tagNote(api: LocalApi, asked: TagNoteArguments): Promise<ChatActDone> {
	const on = tagsAmong(asked.tags ?? []);
	const off = tagsOff(asked);
	if (on.length === 0 && off.length === 0) return trouble(NOTHING_TAGGED, NOTHING_TAGGED_TOLD);
	const note = await api.getNode(asked.note);
	if (!note) return trouble(NO_NOTE, NO_NOTE_TOLD);
	const tags = tagsCarried(note, asked);
	const written = await api.updateNode(asked.note, { tags });
	return {
		...(await listedAnswer(api, written)),
		told: taggedTold(on.length > 0, off.length > 0),
		card: tagCard(written, on, off),
		touched: [written.ref]
	};
}

function tagsOff(asked: TagNoteArguments): Tag[] {
	return tagsAmong(asked.off ?? []);
}

/** The tags a note is left carrying: the ones it has and the ones going on,
 *  less the ones coming off. */
function tagsCarried(note: NodeView, asked: TagNoteArguments): Tag[] {
	const off = new Set<string>(tagsOff(asked));
	const on = tagsAmong(asked.tags ?? []);
	return [...new Set([...note.tags, ...on])].filter((tag) => !off.has(tag));
}

function taggedTold(on: boolean, off: boolean): string {
	if (!on) return 'Tags taken off.';
	return off ? 'Tagged, and tags taken off.' : 'Tagged.';
}

/** The label a person cites a note by, written or taken off. Every rule it is
 *  held to — unique in its graph, springing from the note above, the number it
 *  leaves still leading to it — is `setAddress` in `@sloppy/local`, which
 *  refuses in words the agent is handed. */
async function numberNote(api: LocalApi, asked: NumberNoteArguments): Promise<ChatActDone> {
	if (!(await api.getNode(asked.note))) return trouble(NO_NOTE, NO_NOTE_TOLD);
	try {
		const written = await api.setAddress(asked.note, asked.address ?? null);
		return {
			...(await listedAnswer(api, written)),
			told: asked.address === undefined ? numberOffTold(written) : `Numbered ${asked.address}.`,
			card: numberCard(written, asked.address),
			touched: [written.ref]
		};
	} catch (error) {
		return troubleWriting(error, NOT_NUMBERED);
	}
}

/** A number taken off a note still leads to it, which is the half somebody
 *  would otherwise go looking for. */
function numberOffTold(note: NodeView): string {
	const led = note.aliases ?? [];
	return led.length === 0
		? 'The number is off it.'
		: `The number is off it. ${led.join(', ')} still leads here.`;
}

/** A note named both to draw a line to and to take one off loses its line. */
async function linkNotes(api: LocalApi, asked: LinkNotesArguments): Promise<ChatActDone> {
	const off = new Set<OwnedRef>(asked.off ?? []);
	const to = [...new Set(asked.to ?? [])].filter((one) => !off.has(one));
	if (to.length === 0 && off.size === 0) return trouble(NOTHING_LINKED, NOTHING_LINKED_TOLD);
	const note = await api.getNode(asked.note);
	if (!note) return trouble(NO_NOTE, NO_NOTE_TOLD);
	if (to.includes(asked.note)) return trouble(NOT_TO_ITSELF, NOT_TO_ITSELF_TOLD);
	for (const other of to) {
		if (!(await api.getNode(other))) return trouble(NO_OTHER_NOTE, NO_OTHER_NOTE_TOLD);
	}
	const links = [...new Set([...note.links, ...to])].filter((one) => !off.has(one));
	try {
		const written = await api.updateNode(asked.note, { links });
		return {
			...(await listedAnswer(api, written)),
			told: linedTold(to.length > 0, off.size > 0),
			card: linkCard(written, await headingsOf(api, to), await headingsOf(api, [...off])),
			touched: [written.ref]
		};
	} catch (error) {
		return troubleWriting(error, NOT_LINKED);
	}
}

function linedTold(drawn: boolean, taken: boolean): string {
	if (!drawn) return 'Lines taken off.';
	return taken ? 'Lines drawn, and lines taken off.' : 'Lines drawn.';
}

/**
 * The look on one line. It is written on the end already carrying the pair's
 * look, so one line keeps one — and the arrowhead is read against the note it
 * is written on, so it turns with it.
 */
async function styleEdge(api: LocalApi, asked: StyleEdgeArguments): Promise<ChatActDone> {
	if (asked.to === asked.note) return trouble(NOT_TO_ITSELF, NOT_TO_ITSELF_TOLD);
	if (!saysAnything([asked.label, asked.direction, asked.stroke], asked.off)) {
		return trouble(NOTHING_DRAWN, NOTHING_DRAWN_TOLD);
	}
	const note = await api.getNode(asked.note);
	if (!note) return trouble(NO_NOTE, NO_NOTE_TOLD);
	const other = await api.getNode(asked.to);
	if (!other) return trouble(NO_OTHER_NOTE, NO_OTHER_NOTE_TOLD);
	const won = lookBetween(note, other);
	const on = won !== undefined && won.to === note.ref ? other : note;
	const at = on === note ? other : note;
	const look = lookAsked(won, asked, at.ref, on !== note);
	const edges = [...(on.edges ?? []).filter((one) => one.to !== at.ref), look];
	try {
		const written = await api.updateNode(on.ref, { edges });
		return {
			...(await listedAnswer(api, written)),
			told: lineTold(asked),
			card: lineCard(note, other, asked),
			touched: [written.ref]
		};
	} catch (error) {
		return troubleWriting(error, NOT_LOOKED);
	}
}

function lineTold(asked: StyleEdgeArguments): string {
	const says = asked.label?.trim();
	if (says) return `The line says “${says}”.`;
	const sets = asked.direction !== undefined || asked.stroke !== undefined;
	return sets ? 'The line is drawn differently.' : 'Taken back off the line.';
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
async function styleNote(api: LocalApi, asked: StyleNoteArguments): Promise<ChatActDone> {
	const named = [asked.ring_weight, asked.ring_style, asked.mark_radius];
	if (!saysAnything(named, asked.off)) return trouble(NOTHING_DRAWN, NOTHING_DRAWN_TOLD);
	const note = await api.getNode(asked.note);
	if (!note) return trouble(NO_NOTE, NO_NOTE_TOLD);
	const appearance = markAsked(note.appearance, asked);
	try {
		const written = await api.updateNode(asked.note, { appearance });
		return {
			...(await listedAnswer(api, written)),
			told: named.some((one) => one !== undefined)
				? 'The mark is drawn differently.'
				: 'Taken back off the mark.',
			card: markCard(written, asked),
			touched: [written.ref]
		};
	} catch (error) {
		return troubleWriting(error, NOT_DRAWN);
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

async function deleteNote(api: LocalApi, asked: DeleteNoteArguments): Promise<ChatActDone> {
	const note = await api.getNode(asked.note);
	if (!note) return trouble(NO_NOTE, NO_NOTE_TOLD);
	const here = await notesHere(api);
	const going = beneath(here, note.ref);
	const about = await anchorsIn(api, note.ref);
	const binned = asListed(note, about);
	try {
		await api.deleteNode(asked.note);
	} catch (error) {
		return troubleWriting(error, NO_NOTE, NO_NOTE_TOLD);
	}
	return {
		said: JSON.stringify({ binned } satisfies NoteBinned),
		told:
			going.length === 0
				? 'In the bin. You can put it back.'
				: `In the bin, with ${notesSaid(going.length)} beneath it. You can put them back.`,
		card: binCard(note, about, going.length),
		...touchedBy([note.ref, ...going.map((one) => one.ref)])
	};
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

/** Every note under `ref`, which a move carries with it and a delete takes. */
function beneath(here: readonly NoteHere[], ref: OwnedRef): NodeView[] {
	const under = new Map<OwnedRef, NodeView[]>();
	for (const held of here) {
		const parent = held.note.parent;
		if (parent === undefined) continue;
		under.set(parent, [...(under.get(parent) ?? []), held.note]);
	}
	const going = new Map<OwnedRef, NodeView>();
	const walk = (of: OwnedRef): void => {
		for (const child of under.get(of) ?? []) {
			if (going.has(child.ref)) continue;
			going.set(child.ref, child);
			walk(child.ref);
		}
	};
	walk(ref);
	return [...going.values()];
}

/**
 * The notes an act left different, where it can name them all. Past the bound
 * it names none and the whole folder is read again, which is the cheaper truth
 * for a move or a delete that carried a subtree that big.
 */
function touchedBy(refs: readonly OwnedRef[]): { touched?: OwnedRef[] } {
	return refs.length > MOST_NOTES_TOUCHED ? {} : { touched: [...refs] };
}

/** What an act came to that the agent asked for and did not get: the words it
 *  reads, and the person's half of the same fact, where the two are not one
 *  sentence. Nothing was written. */
function trouble(said: string, told: string = said): ChatActDone {
	return { said, trouble: true, told, touched: [] };
}

/** Trouble a write threw, which may have left something behind — so nothing is
 *  named and the folder is read again. The store refuses in words meant for a
 *  person and both readers are given those; where it threw nothing in words,
 *  `told` is the person's half of `otherwise`. */
function troubleWriting(error: unknown, otherwise: string, told = otherwise): ChatActDone {
	const said = wordsFor(error);
	return said === undefined
		? { said: otherwise, trouble: true, told }
		: { said, trouble: true, told: said };
}

function shortly(told: string): string {
	return told.length <= CHAT_TOLD_MAX ? told : `${told.slice(0, CHAT_TOLD_MAX - 1)}…`;
}

/** A note as somebody cites it: the number they navigate by and what it is
 *  called. */
function heads(note: Pick<NodeView, 'address' | 'title'>): string {
	const title = note.title.trim() || A_NOTE;
	return note.address === undefined ? title : `${note.address} · ${title}`;
}

/** A note among the ones already read, as a card's row says it. */
function headingIn(here: readonly NoteHere[], ref: OwnedRef | undefined): string | undefined {
	if (ref === undefined) return undefined;
	const held = here.find((one) => one.note.ref === ref);
	return held && heads(held.note);
}

/** The notes at the other end of some lines, as the rows naming them read.
 *  A note that is not here is left out — there is nothing to call it. */
async function headingsOf(api: LocalApi, refs: readonly OwnedRef[]): Promise<string> {
	const held: string[] = [];
	for (const ref of refs) {
		const note = await api.getNode(ref);
		if (note) held.push(heads(note));
	}
	return held.join(', ');
}

function notesSaid(count: number): string {
	return count === 1 ? '1 note' : `${count.toLocaleString()} notes`;
}

function notesHereTold(count: number): string {
	return count === 0 ? 'Nothing written here yet.' : `${notesSaid(count)} here.`;
}

function notesFoundTold(count: number): string {
	return count === 0 ? 'Nothing here says that.' : `${notesSaid(count)} carry those words.`;
}

/** What a write lays out: the note as it stands or would, where it is, and
 *  what it carries. */
function writeCard(
	asked: WriteNoteArguments,
	note: NodeView | undefined,
	under: string | undefined
): ChatCard {
	const tags = [...new Set([...(note?.tags ?? []), ...tagsAmong(asked.tags ?? [])])];
	return chatCard('note', note ? heads(note) : asked.title?.trim() || asked.about, [
		...cardRow(CARD_ROWS.place, asked.about),
		...cardRow(CARD_ROWS.number, note?.address ?? asked.address),
		...cardRow(CARD_ROWS.tags, tags.join(', ')),
		...cardRow(CARD_ROWS.under, under),
		...cardRow(CARD_ROWS.sections, sectionHeadings(asked.sections))
	]);
}

function moveCard(
	note: NodeView,
	relation: MoveNoteArguments['relation'],
	to: NodeView | undefined,
	going: number,
	address: string | undefined
): ChatCard {
	return chatCard('note', heads(note), [
		...cardRow(relation === 'under' ? CARD_ROWS.under : CARD_ROWS.after, to && heads(to)),
		...cardRow(CARD_ROWS.number, address),
		...cardRow(CARD_ROWS.alsoAt, (note.aliases ?? []).join(', ')),
		...cardRow(CARD_ROWS.withIt, going === 0 ? undefined : notesSaid(going))
	]);
}

function tagCard(note: NodeView, on: readonly Tag[], off: readonly Tag[]): ChatCard {
	return chatCard('note', heads(note), [
		...cardRow(CARD_ROWS.on, on.join(', ')),
		...cardRow(CARD_ROWS.off, off.join(', '))
	]);
}

function numberCard(note: NodeView, address: string | undefined): ChatCard {
	return chatCard('note', heads(note), [
		...cardRow(CARD_ROWS.number, address ?? CARD_NONE),
		...cardRow(CARD_ROWS.alsoAt, (note.aliases ?? []).join(', '))
	]);
}

function linkCard(note: NodeView, to: string, off: string): ChatCard {
	return chatCard('line', heads(note), [
		...cardRow(CARD_ROWS.to, to),
		...cardRow(CARD_ROWS.off, off)
	]);
}

function lineCard(note: NodeView, other: NodeView, asked: StyleEdgeArguments): ChatCard {
	const gone = channelsOff(asked);
	const set = <T extends string>(
		channel: EdgeLookChannel,
		value: T | undefined,
		said: (held: T) => string
	) => (gone.has(channel) ? CARD_NONE : value === undefined ? undefined : said(value));
	return chatCard('line', `${heads(note)} → ${heads(other)}`, [
		...cardRow(
			CARD_ROWS.words,
			set('label', asked.label || undefined, (held) => held)
		),
		...cardRow(
			CARD_ROWS.arrow,
			set('direction', asked.direction, (held) => arrowSaid(held, note, other))
		),
		...cardRow(
			CARD_ROWS.line,
			set('stroke', asked.stroke, (held) => EDGE_STROKE_LABELS[held])
		)
	]);
}

/** Clearing the words is taking them off, whichever way it is asked. */
function channelsOff(asked: StyleEdgeArguments): Set<EdgeLookChannel> {
	const off = new Set<EdgeLookChannel>(asked.off ?? []);
	if (asked.label !== undefined && asked.label.trim() === '') off.add('label');
	return off;
}

/** Which end the arrowhead sits at, said against the note the act named rather
 *  than the note the look is stored on. */
function arrowSaid(direction: EdgeDirection, note: NodeView, other: NodeView): string {
	if (direction === 'both') return 'Both ends';
	return `Points at ${heads(direction === 'to' ? other : note)}`;
}

function markCard(note: NodeView, asked: StyleNoteArguments): ChatCard {
	const gone = new Set<MarkChannel>(asked.off ?? []);
	const set = <T extends string>(
		channel: MarkChannel,
		value: T | undefined,
		words: Record<T, string>
	) => (gone.has(channel) ? CARD_NONE : value === undefined ? undefined : words[value]);
	return chatCard('mark', heads(note), [
		...cardRow(RING, set('ring_weight', asked.ring_weight, RING_WEIGHT_LABELS)),
		...cardRow(RING_STYLE, set('ring_style', asked.ring_style, RING_STYLE_LABELS)),
		...cardRow(SIZE, set('mark_radius', asked.mark_radius, MARK_RADIUS_LABELS))
	]);
}

function binCard(note: NodeView, about: readonly string[], going: number): ChatCard {
	return chatCard('note', heads(note), [
		...cardRow(CARD_ROWS.place, about.join(', ')),
		...cardRow(CARD_ROWS.tags, [...note.tags].join(', ')),
		...cardRow(CARD_ROWS.withIt, going === 0 ? undefined : notesSaid(going))
	]);
}
