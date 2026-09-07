import type { Address, OwnedRef } from '@sloppy/types';
import { describe, expect, it } from 'vitest';
import { aimAt, aimSays, INDENT_PX, movesTo, runFor, type TreeBox } from './tree-drag.js';
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

// AI.md § "The Address Is the Protocol": the run appends, so a note carried
// into one takes the address after its greatest and nobody else is renumbered.
describe('where a note carried over the outline would land', () => {
	const ROWS = [
		row('1', 0),
		row('1a', 1, '1'),
		row('1a1', 2, '1a'),
		row('1b', 1, '1'),
		row('2', 0)
	];

	const carried = (address: string) => ({
		ref: held(address),
		address: address as Address
	});

	it('takes the address after the greatest in the run it springs into', () => {
		expect(movesTo(ROWS, carried('2'), { ...OUTLINE[0], relation: 'under' })).toEqual({
			says: 'Becomes 1c under 1 About 1',
			to: { ...OUTLINE[0], relation: 'under' }
		});
	});

	it('opens a run of its own under a note that has nothing under it', () => {
		expect(movesTo(ROWS, carried('2'), { ...OUTLINE[2], relation: 'under' })?.says).toBe(
			'Becomes 1a1a under 1a1 About 1a1'
		);
	});

	it('continues the run of the note it is set beside', () => {
		expect(movesTo(ROWS, carried('2'), { ...OUTLINE[1], relation: 'after' })?.says).toBe(
			'Becomes 1c beside 1a About 1a'
		);
	});

	// A branch is a run of its own, and the top of the tree is where it joins.
	it('numbers a note carried out to the top of the tree', () => {
		expect(movesTo(ROWS, carried('1a1'), { ...OUTLINE[3], relation: 'after' })?.says).toBe(
			'Becomes 3 beside 2 About 2'
		);
	});

	it('leaves a note at the end of the run it is already in where it is', () => {
		const stays = movesTo(ROWS, carried('1b'), { ...OUTLINE[1], relation: 'after' });
		expect(stays.says).toBe('Stays where it is');
		expect(stays.to).toBeUndefined();
	});

	it('refuses a note carried into its own branch', () => {
		const under = movesTo(ROWS, carried('1'), { ...OUTLINE[2], relation: 'under' });
		expect(under).toEqual({ says: 'A note cannot go inside itself' });
		expect(movesTo(ROWS, carried('1'), { ...OUTLINE[2], relation: 'after' })?.to).toBeUndefined();
		expect(movesTo(ROWS, carried('1'), { ...OUTLINE[0], relation: 'under' })?.to).toBeUndefined();
	});

	// The run a note is already in is one it can still be sent to the end of.
	it('lets a note be set beside itself, which sends it to the end of its run', () => {
		expect(movesTo(ROWS, carried('1a'), { ...OUTLINE[1], relation: 'after' })?.says).toBe(
			'Becomes 1c beside 1a About 1a'
		);
	});

	it('refuses a note carried onto a row of another graph', () => {
		expect(movesTo([], carried('2'), { ...OUTLINE[0], relation: 'under' })).toEqual({
			says: 'A note stays in the graph it was written in'
		});
	});

	it('has nowhere to put a note let go off the outline', () => {
		expect(movesTo(ROWS, carried('2'), null)).toEqual({
			says: 'Move over a note to put it there'
		});
	});
});
