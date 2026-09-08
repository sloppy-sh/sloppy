import type { Address, OwnedRef } from '@sloppy/types';
import { describe, expect, it } from 'vitest';
import { addressNesting, type NestingNote } from './address-nesting.js';

const DID = 'did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva';
const ref = (n: number) => `${DID}/01JSPREAD0000000000000${String(n).padStart(3, '0')}` as OwnedRef;

function note(n: number, address: string | null, over: Partial<NestingNote> = {}): NestingNote {
	return {
		ref: ref(n),
		...(address === null ? {} : { address: address as Address }),
		title: address ?? 'Untitled',
		...over
	};
}

/** `2` with `2c` under it, and `3` with `3a` under it. */
const TWO = note(1, '2');
const CELLS = note(2, '2c', { parent: TWO.ref, title: 'Cells' });
const THREE = note(3, '3');
const LANDING = note(4, '3a', { parent: THREE.ref, title: 'Method' });
const GRAPH = [TWO, CELLS, THREE, LANDING];

describe('what a number written on a note says about where it sits', () => {
	it('is written with no question where it springs from the note it already does', () => {
		expect(addressNesting(CELLS, '2d' as Address, GRAPH)).toEqual({ act: 'write' });
	});

	it('is written with no question on a branch given a whole number', () => {
		expect(addressNesting(TWO, '7' as Address, GRAPH)).toEqual({ act: 'write' });
	});

	it('offers to carry the note under the note it names', () => {
		expect(addressNesting(CELLS, '3a1' as Address, GRAPH)).toEqual({
			act: 'carry',
			under: LANDING,
			address: '3a1'
		});
	});

	it('offers to carry it under a note that number was carried away from, leaving the number to the run', () => {
		const carried = { ...LANDING, address: '5b' as Address, aliases: ['3a' as Address] };
		const answer = addressNesting(CELLS, '3a1' as Address, [TWO, CELLS, THREE, carried]);

		expect(answer).toEqual({ act: 'carry', under: carried, wasAt: '3a' });
	});

	it('reads a number the note already springs from through what its parent was at', () => {
		const moved = { ...TWO, address: '5' as Address, aliases: ['2' as Address] };
		expect(addressNesting(CELLS, '2d' as Address, [moved, CELLS, THREE, LANDING])).toEqual({
			act: 'write'
		});
	});

	it('offers to make a branch of a note given a whole number', () => {
		expect(addressNesting(CELLS, '5' as Address, GRAPH)).toEqual({
			act: 'branch',
			address: '5'
		});
	});

	it('says when nothing in the graph is at the number it springs from', () => {
		expect(addressNesting(CELLS, '4b1' as Address, GRAPH)).toEqual({
			act: 'nowhere',
			parent: '4b',
			address: '4b1'
		});
	});

	it('refuses a number that would make the note spring from itself', () => {
		expect(addressNesting(CELLS, '2c1' as Address, GRAPH)).toEqual({
			act: 'refuse',
			words: '2c1 would make this note spring from itself. Pick another number.'
		});
	});

	it('refuses a number that springs from a note under this one', () => {
		const under = note(5, '2c1', { parent: CELLS.ref });
		expect(addressNesting(CELLS, '2c1a' as Address, [...GRAPH, under])).toEqual({
			act: 'refuse',
			words:
				'2c1 springs from this note, so this note cannot spring from it. Pick a number outside it.'
		});
	});

	it('refuses one that springs from a note under this one by the genealogy alone', () => {
		const nameless = note(5, null, { parent: CELLS.ref });
		const deeper = { ...note(6, '9a'), parent: nameless.ref };
		const answer = addressNesting(CELLS, '9a1' as Address, [...GRAPH, nameless, deeper]);
		expect(answer.act).toBe('refuse');
	});

	it('writes what it cannot judge: a note whose parent this reader has not read', () => {
		expect(addressNesting(CELLS, '3a1' as Address, [THREE, LANDING])).toEqual({ act: 'write' });
	});

	it('leaves a number too big to read to the server', () => {
		const huge = `${'9'.repeat(20)}a1` as Address;
		expect(addressNesting(CELLS, huge, GRAPH)).toEqual({ act: 'write' });
	});
});
