import type { Address, OwnedRef } from '@sloppy/types';
import { describe, expect, it } from 'vitest';
import { aimAt, aimSays, INDENT_PX, runFor, type TreeBox } from './tree-drag.js';
import type { TreeRow } from './walk.js';

const DID = 'did:syr:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK';

const held = (address: string): OwnedRef => `${DID}/${address}` as OwnedRef;

/** Rows 44 tall from the top of the outline, each set in 20 by its depth. */
function box(address: string, at: number, depth: number, title = `About ${address}`): TreeBox {
	return {
		on: held(address),
		address: address as Address,
		title,
		top: at * 44,
		bottom: at * 44 + 44,
		left: 10 + depth * 20
	};
}

const OUTLINE = [box('1', 0, 0), box('1a', 1, 1), box('1a1', 2, 2), box('2', 3, 0)];

function row(address: string, depth: number, parent?: string): TreeRow {
	return {
		kind: 'note',
		note: {
			ref: held(address),
			address: address as Address,
			parent: parent === undefined ? undefined : held(parent),
			title: `About ${address}`,
			tags: [],
			published: false
		},
		depth,
		children: 0,
		under: 0,
		open: true,
		at: 1,
		of: 1
	};
}

describe('where a drop would put the note', () => {
	it('writes under the row the pointer is indented past', () => {
		expect(aimAt(OUTLINE, 10 + INDENT_PX, 20)).toMatchObject({
			on: held('1'),
			relation: 'under'
		});
	});

	it('writes beside the row the pointer is level with', () => {
		expect(aimAt(OUTLINE, 12, 20)).toMatchObject({ on: held('1'), relation: 'after' });
	});

	// A row set further in takes its own indent with it, so the same x is level
	// with a deep row and past a shallow one.
	it('reads the indent against the row itself, not against the outline', () => {
		expect(aimAt(OUTLINE, 40, 60)).toMatchObject({ on: held('1a'), relation: 'after' });
		expect(aimAt(OUTLINE, 40, 20)).toMatchObject({ on: held('1'), relation: 'under' });
	});

	it('aims at nothing above the first row, where there is no note to write against', () => {
		expect(aimAt(OUTLINE, 60, -10)).toBeNull();
		expect(aimAt([], 60, 20)).toBeNull();
	});

	it('aims at the last row below the end of the outline', () => {
		expect(aimAt(OUTLINE, 12, 900)).toMatchObject({ on: held('2'), relation: 'after' });
	});

	it('says the outcome with the address a person cites', () => {
		expect(aimSays({ ...OUTLINE[0], relation: 'under' })).toBe('Write under 1 About 1');
		expect(aimSays({ ...OUTLINE[3], relation: 'after' })).toBe('Write beside 2 About 2');
	});

	it('says Untitled where the note has no title yet', () => {
		expect(aimSays({ ...box('3', 0, 0, ''), relation: 'under' })).toBe('Write under 3 Untitled');
	});
});

describe('the run a drop would join', () => {
	const ROWS = [
		row('1', 0),
		row('1a', 1, '1'),
		row('1a1', 2, '1a'),
		row('1b', 1, '1'),
		row('2', 0)
	];

	it('is the children of the row a note is written under', () => {
		expect([...runFor(ROWS, { ...OUTLINE[0], relation: 'under' })]).toEqual([
			held('1'),
			held('1a'),
			held('1b')
		]);
	});

	it('is the row alone where nothing is drawn under it yet', () => {
		expect([...runFor(ROWS, { ...OUTLINE[2], relation: 'under' })]).toEqual([held('1a1')]);
	});

	it('is the siblings of the row a note is written beside, on both sides of it', () => {
		expect([...runFor(ROWS, { ...OUTLINE[1], relation: 'after' })]).toEqual([
			held('1a'),
			held('1b')
		]);
	});

	it('never reaches out of the run into the one above it', () => {
		const run = runFor(ROWS, { ...OUTLINE[1], relation: 'after' });
		expect(run.has(held('1'))).toBe(false);
		expect(run.has(held('2'))).toBe(false);
	});

	it('lights nothing for a row that is not drawn', () => {
		expect(runFor([], { ...OUTLINE[0], relation: 'under' }).size).toBe(0);
	});
});
