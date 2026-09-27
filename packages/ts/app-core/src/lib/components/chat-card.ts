/**
 * The card standing in front of the answer somebody is keeping as a note: what
 * would land, in the words it reads in once it has. docs/ARCHITECTURE.md
 * § "Asking a tool to write the notes".
 *
 * A call is composed from what an agent wrote, so nothing here is drawn that
 * has not been read against the act's own shape first — `readCall` in
 * `chat-said.ts`.
 */

import {
	CARD_ROWS,
	cardRow,
	chatCard,
	sectionHeadings,
	type ChatCard,
	type ChatToolCall
} from '@sloppy/types';
import type { NameOf } from '../chat-said.js';

const ANOTHER = 'another note';

/** The card for the note somebody is about to keep, or `null` for a call that
 *  would not write one — which is drawn by nobody. */
export function askedShown(call: ChatToolCall | null, nameOf: NameOf): ChatCard | null {
	if (call?.act !== 'write_note') return null;
	const { about, title, tags, address, under, sections } = call.arguments;
	return chatCard('note', title ?? about, [
		...cardRow(CARD_ROWS.place, about),
		...cardRow(CARD_ROWS.number, address),
		...cardRow(CARD_ROWS.tags, (tags ?? []).join(', ')),
		...cardRow(CARD_ROWS.under, under === undefined ? undefined : (nameOf(under) ?? ANOTHER)),
		...cardRow(CARD_ROWS.sections, sectionHeadings(sections))
	]);
}
