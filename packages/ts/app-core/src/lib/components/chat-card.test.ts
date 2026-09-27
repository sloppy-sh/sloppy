// What a person reads before they allow an act: the card of what would land —
// docs/ARCHITECTURE.md § "Asking a tool to write the notes".

import 'fake-indexeddb/auto';
import { DELETED_KEPT_FOR_DAYS, type OwnedRef } from '@sloppy/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readCall } from '../chat-said.js';
import { DID, homeOf, node, ref, useFakeApi, VIEWER } from '../stores/fake-api.test-support.js';
import { nodes } from '../stores/nodes.svelte.js';
import { session } from '../stores/session.svelte.js';
import { askedShown } from './chat-card.js';

const HOME = homeOf(DID);
const PARSER = ref(1);
const VAULT = ref(2);

/** A note as the chat names one, which is how a card heads itself. */
function nameOf(note: OwnedRef): string | undefined {
	const held = nodes.get(note);
	if (!held) return undefined;
	return held.address === undefined ? held.title : `${held.address} · ${held.title}`;
}

function shown(act: string, args: unknown) {
	return askedShown(readCall('c1', act as never, args), nameOf);
}

/** A card's rows as `Label: value`, which is how they read down the card. */
function rows(act: string, args: unknown): string[] {
	return (shown(act, args)?.card.rows ?? []).map((row) => `${row.label}: ${row.value}`);
}

beforeEach(async () => {
	nodes.clear();
	const api = useFakeApi();
	api.on('GET /nodes', () => [
		node(1, '1', { title: 'The parser' }),
		node(2, '1a', { title: 'The vault' })
	]);
	session.adopt(VIEWER, 'a-session');
	await nodes.load({ graph: HOME });
});

afterEach(() => {
	nodes.clear();
	session.clear();
});

describe('a write, laid out before it happens', () => {
	it('heads itself with what the note would be called and says where it lands', () => {
		const card = shown('write_note', {
			about: 'src/parser.ts',
			title: 'The parser',
			sections: ['## Why\n\nBecause.', '## How\n\nLike this.'],
			tags: ['parser', 'lexing'],
			address: '1a1'
		})?.card;

		expect(card?.about).toBe('note');
		expect(card?.heading).toBe('The parser');
		expect(card?.rows.map((row) => `${row.label}: ${row.value}`)).toEqual([
			'Place: src/parser.ts',
			'Number: 1a1',
			'Tags: parser, lexing',
			'Sections: Why, How'
		]);
	});

	it('heads itself with the place, where the note is not being called anything new', () => {
		expect(
			shown('write_note', { about: 'src/parser.ts', sections: ['## Why\n\nBecause.'] })?.card
				.heading
		).toBe('src/parser.ts');
	});
});

describe('the rest of what an act would do', () => {
	it('says where a note lands and that its own notes go with it', () => {
		expect(rows('move_note', { note: VAULT, to: PARSER, relation: 'under' })).toEqual([
			'Under: 1 · The parser',
			'With it: Everything written under it'
		]);
	});

	it('names the tags that would come off beside the ones going on', () => {
		expect(rows('tag_note', { note: PARSER, tags: ['lexing'], off: ['reading'] })).toEqual([
			'On: lexing',
			'Off: reading'
		]);
	});

	it('says a number taken off as the note having none', () => {
		expect(rows('number_note', { note: PARSER })).toEqual(['Number: None']);
		expect(rows('number_note', { note: PARSER, address: '2b' })).toEqual(['Number: 2b']);
	});

	it('names the lines that would go beside the ones being drawn', () => {
		const held = shown('link_notes', { note: PARSER, to: [VAULT], off: [VAULT] });
		expect(held?.card.about).toBe('line');
		expect(held?.card.heading).toBe('1 · The parser');
		expect(held?.card.rows.map((row) => `${row.label}: ${row.value}`)).toEqual([
			'To: 1a · The vault',
			'Off: 1a · The vault'
		]);
	});

	it('reads a line by both its ends, and says which way the arrow points', () => {
		const held = shown('style_edge', {
			note: PARSER,
			to: VAULT,
			label: 'grew out of',
			direction: 'to'
		});
		expect(held?.card.heading).toBe('1 · The parser → 1a · The vault');
		expect(held?.card.rows.map((row) => `${row.label}: ${row.value}`)).toEqual([
			'Words: grew out of',
			'Arrow: Points at 1a · The vault'
		]);
	});

	it('says a look taken off a line as the line having none of it', () => {
		expect(
			rows('style_edge', { note: PARSER, to: VAULT, off: ['label', 'direction', 'stroke'] })
		).toEqual(['Words: None', 'Arrow: None', 'Line: None']);
	});

	it('says how a mark is drawn in the words the look controls use', () => {
		const held = shown('style_note', {
			note: PARSER,
			ring_weight: 'heavy',
			off: ['mark_radius']
		});
		expect(held?.card.about).toBe('mark');
		expect(held?.card.rows.map((row) => `${row.label}: ${row.value}`)).toEqual([
			'Ring: Heavy',
			'Size: None'
		]);
	});

	it('names what a delete takes with it beside the card, which is the half nobody gets back', () => {
		const held = shown('delete_note', { note: PARSER });
		expect(held?.card.heading).toBe('1 · The parser');
		expect(held?.cost).toContain('everything written under it');
		expect(held?.cost).toContain(`${DELETED_KEPT_FOR_DAYS} days`);
	});
});

describe('a call this build cannot read', () => {
	it('draws no card at all, so nothing is laid out that was not understood', () => {
		expect(askedShown(null, nameOf)).toBeNull();
		expect(shown('read_note', { note: PARSER })).toBeNull();
	});
});
