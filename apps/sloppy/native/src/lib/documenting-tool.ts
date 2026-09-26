/**
 * What a tool is asked for, and how what it answers is read back. The format a
 * note is written in is `.sloppy/AGENT.md` in the project itself, which the
 * tool is told to read: there is one copy of that text and it is not here —
 * docs/ARCHITECTURE.md § "Writing the notes in four steps".
 */

import {
	MAX_PLACES_PER_RUN,
	MAX_TAGS_PER_NODE,
	type DocumentingIntent,
	type ProposedPlace,
	type Tag
} from '@sloppy/types';

/** One section of a note that is already there, as a note file spells it. */
export interface WrittenSection {
	/** The section's own id, which `<!-- block … -->` names. */
	id: string;
	markdown: string;
}

export interface NoteAsWritten {
	title: string;
	sections: WrittenSection[];
}

/** A place a survey proposed, before it is held to `ProposedPlaceSchema`. */
export interface SaidPlace {
	path: string;
	reason?: string;
	tags?: string[];
}

/** A note a run was handed back, before it is written anywhere. */
export interface SaidNote {
	title?: string;
	sections: string[];
	/** The scopes it says this note belongs to. Only the ones the person
	 *  allowed go on; the rest stand as a suggestion beside the result. */
	tags?: string[];
}

const HEAD = `The notes for this project are a Sloppy graph kept in the .sloppy folder beside the code.
Read .sloppy/AGENT.md before anything else: it is the format they are written in and the rules you are held to here.

The app is asking you for this rather than a person at a terminal, so write no file and change nothing in this project.`;

/** What a tag is for here, which is the one thing a tool gets wrong on its
 *  own: it reaches for a word about ITSELF rather than about the code. */
const TAGS = `A tag names what a note is ABOUT — the system or the scope it belongs to — so that picking one out picks out everything about that system wherever it sits. Lowercase, a word or a short phrase. Never a tag about how the note came to be written, or about you.`;

/** The words this graph already classifies by, so that a second name for one
 *  scope is not invented beside the first. */
function alreadyUsed(vocabulary: readonly Tag[]): string {
	return vocabulary.length === 0
		? 'Nothing here is tagged yet, so the tags you give are the first.'
		: `Tags already used here, and the ones to reach for first:\n${vocabulary.map((tag) => `- ${tag}`).join('\n')}`;
}

function askedFor(intent: DocumentingIntent): string {
	return `What the maintainer asked for:\n${intent.said === '' ? 'Nothing in particular.' : intent.said}`;
}

/** `written` are the places the notes already reach, so that nothing proposes a
 *  second note about a file that has one. */
export function surveyPrompt(
	intent: DocumentingIntent,
	written: readonly string[],
	vocabulary: readonly Tag[] = []
): string {
	return [
		HEAD,
		askedFor(intent),
		`Read the project and propose the places worth a note — a folder, or a file — each with one short sentence saying why. Propose at most ${MAX_PLACES_PER_RUN}, and propose each place once. Nothing is written from this: the maintainer settles the list first.`,
		written.length === 0
			? 'Nothing here has a note yet.'
			: `These already have a note, so propose one again only where the note about it should change:\n${written.map((path) => `- ${path}`).join('\n')}`,
		`Tag each place with the system it belongs to, so that the notes about one system can be picked out together however far apart they sit. ${TAGS} At most ${MAX_TAGS_PER_NODE} per place, and fewer is better: the maintainer sees them beside each place and takes off the ones they do not want.`,
		alreadyUsed(vocabulary),
		'Answer with JSON and nothing else, in this shape:\n\n{"places":[{"path":"src/parser","reason":"Everything the reader does is here.","tags":["parsing"]}]}\n\nEvery path is from the project root and spelled with /.'
	].join('\n\n');
}

/** `standing` is the note already about this place, shown as a note file reads
 *  so that a tool reads back what it would write. */
export function notePrompt(
	intent: DocumentingIntent,
	place: ProposedPlace,
	standing?: NoteAsWritten,
	vocabulary: readonly Tag[] = []
): string {
	const settled = place.tags ?? [];
	return [
		HEAD,
		askedFor(intent),
		[
			`Write the note about: ${place.path}`,
			...(place.reason === undefined ? [] : [`Why it was proposed: ${place.reason}`]),
			`Point the note at the code it is about: a code: link to ${place.path}.`
		].join('\n'),
		standing === undefined ? 'There is no note about this place yet.' : asItReads(standing),
		[
			settled.length === 0
				? 'No tag has been allowed on this note.'
				: `These tags are allowed on this note and go on it: ${settled.join(', ')}.`,
			`Name any other system this note belongs to that reading the code has shown you. ${TAGS} Those go no further than the maintainer, who decides whether each one goes on, so name a scope rather than repeating what is allowed already.`
		].join(' '),
		alreadyUsed(vocabulary),
		answerShape(standing)
	].join('\n\n');
}

/** What a note is answered with. A note that is already there keeps the title
 *  it has, so one is not asked for where nothing could be done with it. */
function answerShape(standing: NoteAsWritten | undefined): string {
	const sections =
		'"sections":["## What it does\\n\\nIt reads a file and hands back the sections, in order."],"tags":["parsing"]';
	const shape = standing ? `{${sections}}` : `{"title":"What the reader does",${sections}}`;
	return `Answer with JSON and nothing else, in this shape:\n\n${shape}\n\nEach section is one section of the note, in markdown, and opens with a \`## \` heading. An empty "sections" list is a place you found nothing worth saying about, which is an answer.`;
}

function asItReads(standing: NoteAsWritten): string {
	const body = standing.sections
		.map((section) => `<!-- block ${section.id} -->\n${section.markdown}`)
		.join('\n');
	return `There is already a note here, titled "${standing.title}". This is what it says now:\n\n${body}\n\nWrite the note as it should now read. A section you open with a heading that is already there replaces that section; one under a heading nobody has used goes after the rest; a section you leave out stays as it is.`;
}

/** The places a survey answered with, or nothing where its answer could not be
 *  read at all. */
export function placesSaid(said: string): SaidPlace[] | undefined {
	const places = field(answerIn(said), 'places');
	if (!Array.isArray(places)) return undefined;
	const held: SaidPlace[] = [];
	for (const one of places) {
		const path = field(one, 'path');
		if (typeof path !== 'string') return undefined;
		const reason = field(one, 'reason');
		const tags = wordsIn(field(one, 'tags'));
		held.push({
			path,
			...(typeof reason === 'string' && reason.trim() !== '' ? { reason: reason.trim() } : {}),
			...(tags.length === 0 ? {} : { tags })
		});
	}
	return held;
}

/** The note a run was handed back, or nothing where the answer could not be
 *  read at all. */
export function noteSaid(said: string): SaidNote | undefined {
	const answer = answerIn(said);
	const sections = field(answer, 'sections');
	if (!Array.isArray(sections) || sections.some((one) => typeof one !== 'string')) return undefined;
	const title = field(answer, 'title');
	const tags = wordsIn(field(answer, 'tags'));
	return {
		...(typeof title === 'string' && title.trim() !== '' ? { title: title.trim() } : {}),
		...(tags.length === 0 ? {} : { tags }),
		sections: sections as string[]
	};
}

/** The strings in what was answered where a list of words was asked for. A
 *  tool that answered with something else there answered with no words, which
 *  is an answer; whether each one is a tag is `tagsAmong`'s to say. */
function wordsIn(held: unknown): string[] {
	return Array.isArray(held) ? held.filter((one) => typeof one === 'string') : [];
}

function field(held: unknown, name: string): unknown {
	return typeof held === 'object' && held !== null
		? (held as Record<string, unknown>)[name]
		: undefined;
}

/** The JSON in what a tool said, wherever in it that sits: a tool that fenced
 *  its answer or wrote a line around it still answered. */
function answerIn(said: string): unknown {
	for (const held of candidates(said)) {
		try {
			return JSON.parse(held);
		} catch {
			continue;
		}
	}
	return undefined;
}

function* candidates(said: string): Generator<string> {
	const text = said.trim();
	yield text;
	for (const fenced of [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].reverse()) {
		yield fenced[1];
	}
	const opens = text.indexOf('{');
	const closes = text.lastIndexOf('}');
	if (opens !== -1 && closes > opens) yield text.slice(opens, closes + 1);
}
