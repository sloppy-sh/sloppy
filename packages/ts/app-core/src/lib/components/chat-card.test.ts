// What a person reads before they keep an answer as a note: the card of what
// would land — docs/ARCHITECTURE.md § "Asking a tool to write the notes".

import 'fake-indexeddb/auto';
import type { OwnedRef } from '@sloppy/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readCall } from '../chat-said.js';
import { DID, homeOf, node, ref, useFakeApi, VIEWER } from '../stores/fake-api.test-support.js';
import { nodes } from '../stores/nodes.svelte.js';
import { session } from '../stores/session.svelte.js';
import { askedShown } from './chat-card.js';

const HOME = homeOf(DID);
const PARSER = ref(1);

/** A note as the chat names one, which is how a card heads itself. */
function nameOf(note: OwnedRef): string | undefined {
	const held = nodes.get(note);
	if (!held) return undefined;
	return held.address === undefined ? held.title : `${held.address} · ${held.title}`;
}

function shown(act: string, args: unknown) {
	return askedShown(readCall('c1', act as never, args), nameOf);
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

describe('a write, laid out before it is kept', () => {
	it('heads itself with what the note would be called and says where it lands', () => {
		const card = shown('write_note', {
			about: 'src/parser.ts',
			title: 'The parser',
			sections: ['## Why\n\nBecause.', '## How\n\nLike this.'],
			tags: ['parser', 'lexing'],
			address: '1a1'
		});

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
			shown('write_note', { about: 'src/parser.ts', sections: ['## Why\n\nBecause.'] })?.heading
		).toBe('src/parser.ts');
	});
});

describe('a call this build cannot read', () => {
	it('draws no card at all, so nothing is laid out that was not understood', () => {
		expect(askedShown(null, nameOf)).toBeNull();
		expect(shown('read_note', { note: PARSER })).toBeNull();
		expect(shown('delete_note', { note: PARSER })).toBeNull();
	});
});
