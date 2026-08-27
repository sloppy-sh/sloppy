import { describe, expect, it } from 'vitest';
import { valueChanges } from './contract.js';

describe('what a draft asks of a dimension', () => {
	it('keeps the values in the order they were written', () => {
		const { after } = valueChanges([], [{ now: 'seed' }, { now: 'growing' }, { now: 'settled' }]);
		expect(after).toEqual(['seed', 'growing', 'settled']);
	});

	it('trims and drops the blanks an empty row leaves', () => {
		const { after } = valueChanges([], [{ now: '  seed  ' }, { now: '   ' }, { now: 'growing' }]);
		expect(after).toEqual(['seed', 'growing']);
	});

	it('keeps one of a value written twice', () => {
		const { after } = valueChanges([], [{ now: 'seed' }, { now: 'seed' }]);
		expect(after).toEqual(['seed']);
	});

	it('reads an edited row as a rename, not a swap', () => {
		const changes = valueChanges(['seed', 'growing'], [{ was: 'seed', now: 'sprout' }]);
		expect(changes.renames).toEqual([{ from: 'seed', to: 'sprout' }]);
		expect(changes.after).toEqual(['sprout']);
	});

	it('reads a new row as an addition, whatever it is called', () => {
		const changes = valueChanges(['seed'], [{ was: 'seed', now: 'seed' }, { now: 'growing' }]);
		expect(changes.renames).toEqual([]);
		expect(changes.after).toEqual(['seed', 'growing']);
	});

	it('carries both names while a rename is in flight, so nothing is dropped', () => {
		const changes = valueChanges(
			['seed', 'growing'],
			[
				{ was: 'seed', now: 'sprout' },
				{ was: 'growing', now: 'growing' }
			]
		);
		expect(changes.bridge).toEqual(['seed', 'growing', 'sprout']);
		expect(changes.bridge).toEqual(expect.arrayContaining(changes.after));
	});

	it('leaves a value the dimension never had out of the bridge', () => {
		const changes = valueChanges([], [{ was: 'ghost', now: 'sprout' }]);
		expect(changes.renames).toEqual([]);
		expect(changes.bridge).toEqual(['sprout']);
	});

	it('says nothing changed when nothing did', () => {
		const changes = valueChanges(['seed'], [{ was: 'seed', now: 'seed' }]);
		expect(changes).toEqual({
			after: ['seed'],
			renames: [],
			bridge: ['seed'],
			settled: ['seed'],
			merges: []
		});
	});

	it('lets go of the old name once the notes are off it', () => {
		const changes = valueChanges(
			['seed', 'growing'],
			[
				{ was: 'seed', now: 'sprout' },
				{ was: 'growing', now: 'growing' }
			]
		);
		expect(changes.settled).toEqual(['sprout', 'growing']);
	});

	it('holds on to a removed value the renames do not empty', () => {
		const changes = valueChanges(
			['seed', 'growing', 'settled'],
			[
				{ was: 'seed', now: 'sprout' },
				{ was: 'growing', now: 'growing' }
			]
		);
		expect(changes.settled).toEqual(['sprout', 'growing', 'settled']);
		expect(changes.after).toEqual(['sprout', 'growing']);
	});

	it('keeps both names of a trade, since each is carried by the other half', () => {
		const changes = valueChanges(
			['red', 'blue'],
			[
				{ was: 'red', now: 'blue' },
				{ was: 'blue', now: 'red' }
			]
		);
		expect(changes.settled).toEqual(['blue', 'red']);
	});

	it('reads two values traded for each other as two renames, not a merge', () => {
		const changes = valueChanges(
			['red', 'blue'],
			[
				{ was: 'red', now: 'blue' },
				{ was: 'blue', now: 'red' }
			]
		);
		expect(changes.renames).toEqual([
			{ from: 'red', to: 'blue' },
			{ from: 'blue', to: 'red' }
		]);
		expect(changes.merges).toEqual([]);
		expect(changes.after).toEqual(['blue', 'red']);
	});

	it('reads a chain of renames as a chain, not a merge', () => {
		const changes = valueChanges(
			['a', 'b'],
			[
				{ was: 'a', now: 'b' },
				{ was: 'b', now: 'c' }
			]
		);
		expect(changes.renames).toEqual([
			{ from: 'a', to: 'b' },
			{ from: 'b', to: 'c' }
		]);
		expect(changes.merges).toEqual([]);
	});
});

describe('a draft that puts two values under one name', () => {
	it('names the merge when a value is typed onto one that stays', () => {
		const changes = valueChanges(
			['inkling', 'working', 'settled'],
			[
				{ was: 'inkling', now: 'inkling' },
				{ was: 'working', now: 'settled' },
				{ was: 'settled', now: 'settled' }
			]
		);
		expect(changes.merges).toEqual([{ into: 'settled', from: ['working'] }]);
		expect(changes.after).toEqual(['inkling', 'settled']);
	});

	it('names the merge when the value being landed on was removed from the list', () => {
		const changes = valueChanges(['a', 'b'], [{ was: 'a', now: 'b' }]);
		expect(changes.merges).toEqual([{ into: 'b', from: ['a'] }]);
	});

	it('names the merge when two values are typed onto a third', () => {
		const changes = valueChanges(
			['a', 'b'],
			[
				{ was: 'a', now: 'c' },
				{ was: 'b', now: 'c' }
			]
		);
		expect(changes.merges).toEqual([{ into: 'c', from: ['a', 'b'] }]);
		expect(changes.renames).toEqual([
			{ from: 'a', to: 'c' },
			{ from: 'b', to: 'c' }
		]);
	});

	it('keeps both names on the dimension while the notes are moved', () => {
		const changes = valueChanges(
			['working', 'settled'],
			[
				{ was: 'working', now: 'settled' },
				{ was: 'settled', now: 'settled' }
			]
		);
		expect(changes.bridge).toEqual(expect.arrayContaining(['working', 'settled']));
	});
});
