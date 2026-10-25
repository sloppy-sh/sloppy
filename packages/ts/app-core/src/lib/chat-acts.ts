/**
 * What a person reads of one of Sloppy's own acts in the chat: the line and the
 * card beside what `performChatCall` in `@sloppy/local` did and answered the
 * agent — docs/ARCHITECTURE.md § "Asking a tool to write the notes".
 */

import {
	type ActAnswer,
	type ActFacts,
	type ActRefusal,
	type Files,
	performChatCall
} from '@sloppy/local';
import {
	A_NOTE,
	CARD_NONE,
	CARD_ROWS,
	CHAT_TOLD_MAX,
	type ChatActDone,
	type ChatCard,
	type ChatToolCall,
	type EdgeDirection,
	type EdgeLookChannel,
	type MarkChannel,
	type MoveNoteArguments,
	type NodeView,
	type StyleEdgeArguments,
	type StyleNoteArguments,
	type Tag,
	type WriteNoteArguments,
	cardRow,
	chatCard,
	sectionHeadings,
	tagsAmong
} from '@sloppy/types';
import {
	EDGE_STROKE_LABELS,
	MARK_RADIUS_LABELS,
	RING_STYLE_LABELS,
	RING_WEIGHT_LABELS
} from '@sloppy/ui';

/** The person's half of what the agent was told: the same fact, without the
 *  sentence telling an agent what to call next. */
const REFUSED_TOLD: Record<Exclude<ActRefusal, 'too_much'>, string> = {
	no_note: 'That note is not here.',
	no_other_note: 'The note at the other end is not here.',
	no_parent: 'There is no note here to write that one under.',
	nothing_written: 'Nothing to write.',
	nothing_tagged: 'No tags named.',
	nothing_linked: 'No lines named.',
	nothing_drawn: 'Nothing named to draw.',
	not_to_itself: 'A note draws no line to itself.',
	no_graph: 'There is no graph here.',
	nothing_asked: 'Nothing named to brief on.'
};

const TOO_MUCH_TOLD: Partial<Record<ChatToolCall['act'], string>> = {
	list_notes: 'Too many notes here to read at once.',
	search_notes: 'Too many notes carry those words.',
	read_note: 'That note is too long to read in one go.',
	read_around: 'That note is too long to read in one go.',
	brief: 'That brief is too long to hand over in one go.',
	list_tags: 'Too many tags here to read at once.',
	list_bin: 'Too much in the bin to read at once.',
	list_offers: 'Too many offers on it to read at once.'
};

const RING = 'Ring';
const RING_STYLE = 'Ring style';
const SIZE = 'Size';

/**
 * One of Sloppy's own acts, done and answered. The arguments arrived parsed;
 * `said` is what the agent reads and the rest is the person's.
 *
 * `reading` is a folder beside the project, served by `placeApi` in
 * `@sloppy/local` — so nothing an act does there lands.
 */
export async function serveChatCall(
	files: Files,
	call: ChatToolCall,
	reading = false
): Promise<ChatActDone> {
	const done = await performChatCall(files, call, reading);
	const card = done.facts && cardFor(call, done.facts);
	return {
		said: done.said,
		...(done.trouble === undefined ? {} : { trouble: done.trouble }),
		told: shortly(toldOf(call, done)),
		...(card === undefined ? {} : { card }),
		...(done.touched === undefined ? {} : { touched: done.touched })
	};
}

function toldOf(call: ChatToolCall, done: ActAnswer): string {
	if (done.refused === 'too_much') return TOO_MUCH_TOLD[call.act] ?? done.said;
	if (done.refused !== undefined) return REFUSED_TOLD[done.refused];
	if (done.facts === undefined) return done.said;
	return factsTold(call, done.facts);
}

function factsTold(call: ChatToolCall, facts: ActFacts): string {
	switch (facts.act) {
		case 'list_notes':
			return facts.count === 0 ? 'Nothing written here yet.' : `${notesSaid(facts.count)} here.`;
		case 'search_notes':
			return facts.count === 0
				? 'Nothing here says that.'
				: `${notesSaid(facts.count)} carry those words.`;
		case 'list_tags':
			if (facts.count === 0) return 'No tags here yet.';
			return facts.count === 1 ? '1 tag here.' : `${facts.count.toLocaleString()} tags here.`;
		case 'list_bin':
			return facts.count === 0 ? 'Nothing in the bin.' : `${notesSaid(facts.count)} in the bin.`;
		case 'list_offers':
			if (facts.count === 0) return 'Nothing offered on it.';
			return facts.count === 1 ? '1 offer on it.' : `${facts.count.toLocaleString()} offers on it.`;
		case 'read_note':
			return heads(facts.note);
		case 'read_graph':
			return facts.name;
		case 'read_around':
			return facts.count === 0
				? `${heads(facts.note)}, with nothing around it.`
				: `${heads(facts.note)}, with ${notesSaid(facts.count)} around it.`;
		case 'brief':
			return `${notesSaid(facts.count)} briefed, ${facts.around.toLocaleString()} around them.`;
		case 'write_note':
			return facts.done === 'offered' ? 'Offered on a note somebody else wrote.' : 'Written.';
		case 'move_note':
			return facts.beneath === 0
				? 'Carried.'
				: `Carried, with ${notesSaid(facts.beneath)} beneath it.`;
		case 'tag_note':
			return taggedTold(facts.on.length > 0, facts.off.length > 0);
		case 'number_note': {
			const address = argumentsOf(call, 'number_note')?.address;
			return address === undefined ? numberOffTold(facts.note) : `Numbered ${address}.`;
		}
		case 'link_notes':
			return linedTold(facts.to.length > 0, facts.off.length > 0);
		case 'style_edge':
			return lineTold(argumentsOf(call, 'style_edge'));
		case 'style_note': {
			const asked = argumentsOf(call, 'style_note');
			const sets = [asked?.ring_weight, asked?.ring_style, asked?.mark_radius];
			return sets.some((one) => one !== undefined)
				? 'The mark is drawn differently.'
				: 'Taken back off the mark.';
		}
		case 'delete_note':
			return facts.beneath === 0
				? 'In the bin. You can put it back.'
				: `In the bin, with ${notesSaid(facts.beneath)} beneath it. You can put them back.`;
		case 'restore_note':
			return facts.beneath === 0
				? 'Back out of the bin.'
				: `Back out of the bin, with ${notesSaid(facts.beneath)} beneath it.`;
	}
}

/** What an act lays out for the person, where it changed something worth
 *  laying out. */
function cardFor(call: ChatToolCall, facts: ActFacts): ChatCard | undefined {
	switch (facts.act) {
		case 'write_note': {
			const asked = argumentsOf(call, 'write_note');
			return asked && writeCard(asked, facts.note, facts.under && heads(facts.under));
		}
		case 'move_note': {
			const asked = argumentsOf(call, 'move_note');
			return asked && moveCard(facts.note, asked.relation, facts.to, facts.beneath);
		}
		case 'tag_note':
			return tagCard(facts.note, facts.on, facts.off);
		case 'number_note':
			return numberCard(facts.note, argumentsOf(call, 'number_note')?.address);
		case 'link_notes':
			return linkCard(facts.note, headings(facts.to), headings(facts.off));
		case 'style_edge': {
			const asked = argumentsOf(call, 'style_edge');
			return asked && lineCard(facts.note, facts.other, asked);
		}
		case 'style_note': {
			const asked = argumentsOf(call, 'style_note');
			return asked && markCard(facts.note, asked);
		}
		case 'delete_note':
		case 'restore_note':
			return binCard(facts.note, facts.about, facts.beneath);
		default:
			return undefined;
	}
}

/** The arguments of the call, where it is the act named — which it always is
 *  for the facts that act answered with. */
function argumentsOf<A extends ChatToolCall['act']>(
	call: ChatToolCall,
	act: A
): ArgumentsOf[A] | undefined {
	return call.act === act ? (call.arguments as ArgumentsOf[A]) : undefined;
}

type ArgumentsOf = { [Call in ChatToolCall as Call['act']]: Call['arguments'] };

function taggedTold(on: boolean, off: boolean): string {
	if (!on) return 'Tags taken off.';
	return off ? 'Tagged, and tags taken off.' : 'Tagged.';
}

/** A number taken off a note still leads to it, which is the half somebody
 *  would otherwise go looking for. */
function numberOffTold(note: NodeView): string {
	const led = note.aliases ?? [];
	return led.length === 0
		? 'The number is off it.'
		: `The number is off it. ${led.join(', ')} still leads here.`;
}

function linedTold(drawn: boolean, taken: boolean): string {
	if (!drawn) return 'Lines taken off.';
	return taken ? 'Lines drawn, and lines taken off.' : 'Lines drawn.';
}

function lineTold(asked: StyleEdgeArguments | undefined): string {
	const says = asked?.label?.trim();
	if (says) return `The line says “${says}”.`;
	const sets = asked?.direction !== undefined || asked?.stroke !== undefined;
	return sets ? 'The line is drawn differently.' : 'Taken back off the line.';
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

function headings(notes: readonly NodeView[]): string {
	return notes.map(heads).join(', ');
}

function notesSaid(count: number): string {
	return count === 1 ? '1 note' : `${count.toLocaleString()} notes`;
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
	going: number
): ChatCard {
	return chatCard('note', heads(note), [
		...cardRow(relation === 'under' ? CARD_ROWS.under : CARD_ROWS.after, to && heads(to)),
		...cardRow(CARD_ROWS.number, note.address),
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
