import { describe, expect, it } from 'vitest';
import { type DrawnVersion, foldRuns } from './commit-graph.js';

const WROTE = 'While you were writing';

function version(id: string, message: string, refs: string[] = []): DrawnVersion {
	return { id, message, when: '1 Jan 2026', parents: [], refs };
}

const held = (ids: string[], messages: string[]) =>
	ids.map((id, at) => version(id, messages[at] ?? WROTE));

describe('a run of versions nobody wrote a message for', () => {
	it('folds into the first of them, saying how many it stands for', () => {
		const { drawn, holding } = foldRuns(
			held(['a', 'b', 'c', 'd', 'e'], ['A thought', WROTE, WROTE, WROTE, 'Another thought']),
			WROTE,
			new Set()
		);

		expect(drawn.map((one) => one.id)).toEqual(['a', 'b', 'e']);
		expect(holding.get('b')).toBe(3);
		expect(holding.has('a')).toBe(false);
	});

	it('leaves one of them alone, because one is one version', () => {
		const { drawn, holding } = foldRuns(
			held(['a', 'b', 'c'], ['A thought', WROTE, 'Another thought']),
			WROTE,
			new Set()
		);

		expect(drawn.map((one) => one.id)).toEqual(['a', 'b', 'c']);
		expect(holding.size).toBe(0);
	});

	it('draws every one of a run somebody has opened', () => {
		const { drawn, holding } = foldRuns(
			held(['a', 'b', 'c', 'd'], ['A thought', WROTE, WROTE, WROTE]),
			WROTE,
			new Set(['b'])
		);

		expect(drawn.map((one) => one.id)).toEqual(['a', 'b', 'c', 'd']);
		expect(holding.size).toBe(0);
	});

	// A version a line points at is one somebody looks for by name.
	it('folds no run that carries a version a line points at', () => {
		const versions = held(['a', 'b', 'c', 'd'], ['A thought', WROTE, WROTE, WROTE]);
		versions[2] = version('c', WROTE, ['main']);

		const { drawn, holding } = foldRuns(versions, WROTE, new Set());

		expect(drawn.map((one) => one.id)).toEqual(['a', 'b', 'c', 'd']);
		expect(holding.size).toBe(0);
	});

	it('folds each run of a history that has several', () => {
		const { drawn, holding } = foldRuns(
			held(['a', 'b', 'c', 'd', 'e', 'f'], ['One', WROTE, WROTE, 'Two', WROTE, WROTE]),
			WROTE,
			new Set()
		);

		expect(drawn.map((one) => one.id)).toEqual(['a', 'b', 'd', 'e']);
		expect([...holding.entries()]).toEqual([
			['b', 2],
			['e', 2]
		]);
	});
});
