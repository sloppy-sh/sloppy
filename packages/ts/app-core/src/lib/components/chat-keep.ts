/**
 * An answer kept as a note: what it is called, where it belongs and the
 * sections it is written in, read off the answer itself —
 * docs/ARCHITECTURE.md § "Asking a tool to write the notes". It goes through
 * `write_note` like anything else the chat writes, so what this composes is
 * that act's arguments and nothing more.
 */

import {
	CHAT_SECTION_MAX,
	insideProject,
	MAX_SECTIONS_PER_WRITE,
	NODE_TITLE_MAX,
	type ChatTurn,
	type WriteNoteArguments
} from '@sloppy/types';

/** What an answer with no heading of its own is called, cut to what a title
 *  holds. */
const TITLE_MAX = 80;

/** A fence opens and closes a run of lines that is not markdown, so a heading
 *  inside one is part of what somebody wrote rather than a section of it. */
const FENCE = /^\s*(?:```|~~~)/;

const HEADING = /^##\s+(.*)$/;
const TOP_HEADING = /^#\s+(.*)$/;

/** A place as somebody writes one in prose: `packages/ts/types/src/chat.ts`,
 *  or a folder deep enough that it is plainly one. */
const BACKTICKED = /`([^`\n]+)`/g;
const PATHLIKE = /(?:^|[\s(,[])([A-Za-z0-9_@+][A-Za-z0-9_.@+-]*(?:\/[A-Za-z0-9_.@+-]+)+)/g;

/**
 * The note an answer becomes. `null` where there is nothing in it to write,
 * which is an answer of whitespace.
 */
export function noteFromAnswer(said: string, about: string): WriteNoteArguments | null {
	const body = said.trim();
	if (body === '') return null;
	const { title, sections } = sectionsOf(body);
	return { about, title, sections };
}

/**
 * Where a kept answer belongs: the first place the answer itself names, and
 * failing that the last place the conversation was about. Absent is a chat
 * that has named nowhere in the project, where there is nothing to hang a note
 * off.
 */
export function placeForAnswer(said: string, turns: readonly ChatTurn[]): string | undefined {
	return placeNamedIn(said) ?? placeInTurns(turns);
}

/** The first place a piece of writing names, preferring one it set in code. */
function placeNamedIn(said: string): string | undefined {
	for (const pattern of [BACKTICKED, PATHLIKE]) {
		pattern.lastIndex = 0;
		for (const found of said.matchAll(pattern)) {
			const held = found[1].trim();
			if (readsAsPlace(held)) return held;
		}
	}
	return undefined;
}

/** The newest place any act or tool in the conversation named. */
function placeInTurns(turns: readonly ChatTurn[]): string | undefined {
	for (let turn = turns.length - 1; turn >= 0; turn -= 1) {
		const blocks = turns[turn].blocks;
		for (let at = blocks.length - 1; at >= 0; at -= 1) {
			const block = blocks[at];
			if (block.kind !== 'tool_call') continue;
			const place = placeAmong(block.arguments);
			if (place !== undefined) return place;
		}
	}
	return undefined;
}

function placeAmong(args: unknown): string | undefined {
	if (typeof args !== 'object' || args === null || Array.isArray(args)) return undefined;
	for (const held of Object.values(args as Record<string, unknown>)) {
		if (typeof held === 'string' && readsAsPlace(held.trim())) return held.trim();
	}
	return undefined;
}

/**
 * Whether a word is somewhere in this project rather than a turn of phrase.
 * `insideProject` takes `and/or` as readily as a path, so a place is one that
 * names a file or is nested deeply enough to be nothing else.
 */
function readsAsPlace(held: string): boolean {
	if (!held.includes('/') || !insideProject(held)) return false;
	const segments = held.split('/');
	return segments.length > 2 || segments[segments.length - 1].includes('.');
}

/** An answer as a note's title and its sections, each opening with the heading
 *  `write_note` reads a section by. */
function sectionsOf(body: string): { title: string; sections: string[] } {
	const lines = body.split('\n');
	let fenced = false;
	let title: string | undefined;
	const lead: string[] = [];
	const sections: string[][] = [];
	for (const line of lines) {
		if (FENCE.test(line)) fenced = !fenced;
		const heading = fenced ? null : HEADING.exec(line);
		if (heading) {
			sections.push([line]);
			continue;
		}
		const top =
			fenced || title !== undefined || sections.length > 0 ? null : TOP_HEADING.exec(line);
		if (top) {
			title = top[1].trim();
			continue;
		}
		(sections[sections.length - 1] ?? lead).push(line);
	}
	const called = title ?? firstWordsOf(lead, sections);
	const opening = lead.join('\n').trim();
	const written = [
		...(opening === '' ? [] : [`## ${called}\n\n${opening}`]),
		...sections.map((section) => section.join('\n').trim())
	];
	return { title: called.slice(0, NODE_TITLE_MAX), sections: heldTo(written) };
}

/** What an answer with no heading of its own is called: the first thing it
 *  says, as far as a title reaches. */
function firstWordsOf(lead: readonly string[], sections: readonly string[][]): string {
	const said = [...lead, ...sections.flat()]
		.map((line) =>
			line
				.replace(/^#+\s*/, '')
				.replace(/[*_`>]/g, '')
				.trim()
		)
		.find((line) => line !== '');
	if (said === undefined || said === '') return 'A note from the chat';
	const stop = said.search(/[.!?](\s|$)/);
	const held = (stop === -1 ? said : said.slice(0, stop)).trim();
	return held.length > TITLE_MAX ? `${held.slice(0, TITLE_MAX - 1).trimEnd()}…` : held;
}

/** Held to what one write carries, the rest folded into the last section so
 *  that keeping an answer keeps the whole of it. */
function heldTo(sections: readonly string[]): string[] {
	const kept =
		sections.length <= MAX_SECTIONS_PER_WRITE
			? [...sections]
			: [
					...sections.slice(0, MAX_SECTIONS_PER_WRITE - 1),
					sections.slice(MAX_SECTIONS_PER_WRITE - 1).join('\n\n')
				];
	return kept.map((section) => section.slice(0, CHAT_SECTION_MAX)).filter((one) => one !== '');
}
