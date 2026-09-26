/**
 * What a tool is asked for, and how what it answers is read back. The format a
 * note is written in is `.sloppy/AGENT.md` in the project itself, which the
 * tool is told to read: there is one copy of that text and it is not here —
 * docs/ARCHITECTURE.md § "Asking a tool to write the notes".
 */

import { MAX_PLACES_PER_RUN, type DocumentingIntent, type ProposedPlace } from '@sloppy/types';

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
}

/** A note a run was handed back, before it is written anywhere. */
export interface SaidNote {
	title?: string;
	sections: string[];
}

const HEAD = `The notes for this project are a Sloppy graph kept in the .sloppy folder beside the code.
Read .sloppy/AGENT.md before anything else: it is the format they are written in and the rules you are held to here.

The app is asking you for this rather than a person at a terminal, so write no file and change nothing in this project.`;

function askedFor(intent: DocumentingIntent): string {
	return `What the maintainer asked for:\n${intent.said === '' ? 'Nothing in particular.' : intent.said}`;
}

/** `written` are the places the notes already reach, so that nothing proposes a
 *  second note about a file that has one. */
export function surveyPrompt(intent: DocumentingIntent, written: readonly string[]): string {
	return [
		HEAD,
		askedFor(intent),
		`Read the project and propose the places worth a note — a folder, or a file — each with one short sentence saying why. Propose at most ${MAX_PLACES_PER_RUN}, and propose each place once. Nothing is written from this: the maintainer settles the list first.`,
		written.length === 0
			? 'Nothing here has a note yet.'
			: `These already have a note, so propose one again only where the note about it should change:\n${written.map((path) => `- ${path}`).join('\n')}`,
		'Answer with JSON and nothing else, in this shape:\n\n{"places":[{"path":"src/parser","reason":"Everything the reader does is here."}]}\n\nEvery path is from the project root and spelled with /.'
	].join('\n\n');
}

/** `standing` is the note already about this place, shown as a note file reads
 *  so that a tool reads back what it would write. */
export function notePrompt(
	intent: DocumentingIntent,
	place: ProposedPlace,
	standing?: NoteAsWritten
): string {
	return [
		HEAD,
		askedFor(intent),
		[
			`Write the note about: ${place.path}`,
			...(place.reason === undefined ? [] : [`Why it was proposed: ${place.reason}`]),
			`Point the note at the code it is about: a code: link to ${place.path}.`
		].join('\n'),
		standing === undefined ? 'There is no note about this place yet.' : asItReads(standing),
		'Answer with JSON and nothing else, in this shape:\n\n{"title":"What the reader does","sections":["## What it does\\n\\nIt reads a file and hands back the sections, in order."]}\n\nEach section is one section of the note, in markdown, and opens with a `## ` heading. An empty "sections" list is a place you found nothing worth saying about, which is an answer.'
	].join('\n\n');
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
		held.push({
			path,
			...(typeof reason === 'string' && reason.trim() !== '' ? { reason: reason.trim() } : {})
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
	return {
		...(typeof title === 'string' && title.trim() !== '' ? { title: title.trim() } : {}),
		sections: sections as string[]
	};
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
