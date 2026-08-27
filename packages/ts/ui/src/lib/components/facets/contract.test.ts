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
		expect(changes).toEqual({ after: ['seed'], renames: [], bridge: ['seed'] });
	});
});
