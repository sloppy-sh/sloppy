import type { OwnedRef } from '@sloppy/types';
import { describe, expect, it } from 'vitest';
import type { FoundNote } from './palette.svelte';
import { type PaletteAct, reaches, rowsFor } from './palette-rows.js';

const A = 'did:syr:z6MkAda/01ARZ3NDEKTSV4RRFFQ69G5FAV' as OwnedRef;
const B = 'did:syr:z6MkAda/01ARZ3NDEKTSV4RRFFQ69G5FAW' as OwnedRef;

const ACTS: PaletteAct[] = [
	{ id: 'branch', label: 'New branch', says: '⌘ Return', group: 'Write' },
	{ id: 'choose', label: 'Choose notes', group: 'Graph' },
	{ id: 'export', label: 'Export this graph', group: 'Graph' },
	{ id: 'history', label: 'History', group: 'History' }
];

const note = (ref: OwnedRef, address: string, title: string): FoundNote => ({
	ref,
	address,
	title,
	graph: null,
	snippet: '',
	held: false
});

describe('what the typed words reach', () => {
	it('begins any word of the label, in any order', () => {
		expect(reaches('Choose notes', 'ch')).toBe(true);
		expect(reaches('Choose notes', 'notes ch')).toBe(true);
		expect(reaches('Choose notes', 'oose')).toBe(false);
		expect(reaches('Export this graph', 'GRAPH')).toBe(true);
		expect(reaches('History', '')).toBe(true);
	});
});

describe('the rows for what was typed', () => {
	it('is every act, in the order offered, while nothing is typed', () => {
		expect(rowsFor('', ACTS, [note(A, '1a', 'Cells')], null).map((row) => row.key)).toEqual([
			'act:branch',
			'act:choose',
			'act:export',
			'act:history'
		]);
	});

	it('puts the note an address resolves to first, then the acts begun, then the notes, then the rest', () => {
		const notes = [note(A, '1a', 'Cells'), note(B, '1b', 'Organs')];
		const rows = rowsFor('1a', ACTS, notes, A);
		expect(rows.map((row) => row.key)).toEqual(['note:' + A, 'note:' + B]);

		const typed = rowsFor('gr', ACTS, notes, null);
		expect(typed.map((row) => row.key)).toEqual(['act:export', 'note:' + A, 'note:' + B]);

		const within = rowsFor('ory', ACTS, [], null);
		expect(within.map((row) => row.key)).toEqual(['act:history']);
	});
});
