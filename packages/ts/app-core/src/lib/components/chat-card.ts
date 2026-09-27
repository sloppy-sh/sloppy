/**
 * The card standing in front of an act that would write: what would land, in
 * the words it reads in once it has. docs/ARCHITECTURE.md § "Asking a tool to
 * write the notes".
 *
 * A call arrives from a program, so nothing here is drawn that has not been
 * read against the act's own shape first — `readCall` in `chat-said.ts`.
 */

import {
	cardRow,
	chatCard,
	type ChatCard,
	type ChatToolCall,
	type EdgeDirection,
	type EdgeLookChannel,
	type MarkChannel,
	type OwnedRef
} from '@sloppy/types';
import {
	EDGE_STROKE_LABELS,
	MARK_RADIUS_LABELS,
	RING_STYLE_LABELS,
	RING_WEIGHT_LABELS
} from '@sloppy/ui';
import type { NameOf } from '../chat-said.js';
import { deletionCost } from '../deletion.js';

/** A note the surface asking has never seen, which is every note the agent is
 *  about to start. */
const A_NOTE = 'A note';
const ANOTHER = 'another note';

/** A channel taken back off reads as what the graph draws without it. */
const NONE = 'None';

/** What a question puts in front of the person. */
export interface AskedShown {
	card: ChatCard;
	/** What allowing it costs that a row cannot hold — the half they would want
	 *  back. Absent is an act that takes nothing away. */
	cost?: string;
}

/**
 * The card for one act, or `null` for a call that does not fit the act it
 * names — which is asked about in the plainest words there are instead.
 */
export function askedShown(call: ChatToolCall | null, nameOf: NameOf): AskedShown | null {
	const named = (note: OwnedRef, otherwise: string) => nameOf(note) ?? otherwise;
	switch (call?.act) {
		case 'write_note': {
			const { about, title, tags, address, under, sections } = call.arguments;
			return {
				card: chatCard('note', title ?? about, [
					...cardRow('Place', about),
					...cardRow('Number', address),
					...cardRow('Tags', (tags ?? []).join(', ')),
					...cardRow('Under', under === undefined ? undefined : named(under, ANOTHER)),
					...cardRow('Sections', headingsIn(sections))
				])
			};
		}
		case 'move_note': {
			const { note, to, relation, address } = call.arguments;
			return {
				card: chatCard('note', named(note, A_NOTE), [
					...cardRow(relation === 'under' ? 'Under' : 'After', named(to, ANOTHER)),
					...cardRow('Number', address),
					...cardRow('With it', 'Everything written under it')
				])
			};
		}
		case 'tag_note': {
			const { note, tags, off } = call.arguments;
			return {
				card: chatCard('note', named(note, A_NOTE), [
					...cardRow('On', (tags ?? []).join(', ')),
					...cardRow('Off', (off ?? []).join(', '))
				])
			};
		}
		case 'number_note': {
			const { note, address } = call.arguments;
			return {
				card: chatCard('note', named(note, A_NOTE), [...cardRow('Number', address ?? NONE)])
			};
		}
		case 'link_notes': {
			const { note, to, off } = call.arguments;
			const others = (refs: readonly OwnedRef[] | undefined) =>
				(refs ?? []).map((one) => named(one, ANOTHER)).join(', ');
			return {
				card: chatCard('line', named(note, A_NOTE), [
					...cardRow('To', others(to)),
					...cardRow('Off', others(off))
				])
			};
		}
		case 'style_edge': {
			const { note, to, label, direction, stroke, off } = call.arguments;
			const here = named(note, A_NOTE);
			const there = named(to, ANOTHER);
			const gone = new Set<EdgeLookChannel>(off ?? []);
			return {
				card: chatCard('line', `${here} → ${there}`, [
					...cardRow('Words', gone.has('label') || label === '' ? NONE : label),
					...cardRow(
						'Arrow',
						gone.has('direction')
							? NONE
							: direction === undefined
								? undefined
								: arrowSays(direction, here, there)
					),
					...cardRow(
						'Line',
						gone.has('stroke')
							? NONE
							: stroke === undefined
								? undefined
								: EDGE_STROKE_LABELS[stroke]
					)
				])
			};
		}
		case 'style_note': {
			const { note, ring_weight, ring_style, mark_radius, off } = call.arguments;
			const gone = new Set<MarkChannel>(off ?? []);
			const set = <T extends string>(
				channel: MarkChannel,
				value: T | undefined,
				words: Record<T, string>
			) => (gone.has(channel) ? NONE : value === undefined ? undefined : words[value]);
			return {
				card: chatCard('mark', named(note, A_NOTE), [
					...cardRow('Ring', set('ring_weight', ring_weight, RING_WEIGHT_LABELS)),
					...cardRow('Ring style', set('ring_style', ring_style, RING_STYLE_LABELS)),
					...cardRow('Size', set('mark_radius', mark_radius, MARK_RADIUS_LABELS))
				])
			};
		}
		case 'delete_note': {
			const { note } = call.arguments;
			return { card: chatCard('note', named(note, A_NOTE), []), cost: deletionCost([note]) };
		}
		default:
			return null;
	}
}

function arrowSays(direction: EdgeDirection, here: string, there: string): string {
	if (direction === 'both') return 'Both ends';
	return `Points at ${direction === 'to' ? there : here}`;
}

/** The sections a write names, as somebody reads them off the note afterwards:
 *  each one's heading, and nothing where they are written without one. */
function headingsIn(sections: readonly string[]): string {
	return sections
		.map((markdown) => {
			const first = markdown.split('\n', 1)[0].trim();
			return first.startsWith('## ') ? first.slice(3).trim() : '';
		})
		.filter((heading) => heading !== '')
		.join(', ');
}
