import { describe, expect, it } from 'vitest';
import { byNotebook } from './notebooks.js';

const ALICE = 'did:syr:z6MkpTHR8VNsBxYAAWHut2Geadd9jSLuFvdmsZ2mFmZjMxYZ';
const BOB = 'did:syr:z6MkjchhfUsD6mmvni8mCdXHw216Xrm9bQe2mBH1P5RDjVJG';

/** A row as a peer surface holds one: an address, and where it is read. */
interface Row {
	address: string;
	whose?: string;
	graph?: string;
	notebook?: string;
}

const where = (row: Row) => ({ whose: row.whose, graph: row.graph, notebook: row.notebook });

const grouped = (rows: Row[]) =>
	byNotebook(rows, where, 'unnamed').map((group) => ({
		title: group.title,
		addresses: group.rows.map((row) => row.address)
	}));

describe('rows by the notebook their addresses are read in', () => {
	it('keeps one author’s two notebooks apart, though both are rooted at 1a', () => {
		expect(
			grouped([
				{ address: '1a', whose: ALICE, graph: `${ALICE}/g1`, notebook: 'The thesis' },
				{ address: '1a', whose: ALICE, graph: `${ALICE}/g2`, notebook: 'The garden' }
			])
		).toEqual([
			{ title: 'The thesis', addresses: ['1a'] },
			{ title: 'The garden', addresses: ['1a'] }
		]);
	});

	it('keeps two people’s notebooks apart even where neither travelled with a name', () => {
		const groups = grouped([
			{ address: '1a', whose: ALICE },
			{ address: '1a', whose: BOB }
		]);

		expect(groups).toHaveLength(2);
		expect(groups.every((group) => group.title === 'unnamed')).toBe(true);
	});

	it('holds a notebook to one group, in the order its rows arrived', () => {
		expect(
			grouped([
				{ address: '1', whose: ALICE, graph: `${ALICE}/g1`, notebook: 'The thesis' },
				{ address: '2', whose: ALICE, graph: `${ALICE}/g2`, notebook: 'The garden' },
				{ address: '3', whose: ALICE, graph: `${ALICE}/g1`, notebook: 'The thesis' }
			])
		).toEqual([
			{ title: 'The thesis', addresses: ['1', '3'] },
			{ title: 'The garden', addresses: ['2'] }
		]);
	});

	it('names a group after the notebook and never after what keys it', () => {
		const [group] = byNotebook(
			[{ address: '1a', whose: ALICE, graph: `${ALICE}/g1`, notebook: 'The thesis' }],
			where,
			'unnamed'
		);

		expect(group.title).toBe('The thesis');
		expect(group.title).not.toContain(ALICE);
	});
});
