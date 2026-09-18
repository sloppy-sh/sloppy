// Which look the canvas draws a line under, and which note the one a person
// sets here is written on — docs/ARCHITECTURE.md § "A look a person set on a
// line": either end may carry one, and the app writes only its own.

import type { NodeView } from '@sloppy/types';
import { describe, expect, it } from 'vitest';
import { lineBetween, looksOnCanvas } from './edge-look.js';
import { AT, node, ref } from './stores/fake-api.test-support.js';

const ELSE = 'did:syr:z6MkjRaGkPWv9pTYo1fkaJc34mW1Sev5T3g3kjDtiUsPFGFh';
const ONE = node(1, '1');
const TWO = node(2, '1a', { origin: ONE.ref, parent: ONE.ref, depth: 2 });

const looking = (note: NodeView, over: Partial<NodeView>): NodeView => ({
	...note,
	...over
});

describe('the looks a canvas is handed', () => {
	it('orients a look off the note it is stored on', () => {
		const looks = looksOnCanvas([
			looking(ONE, { edges: [{ to: TWO.ref, label: 'grew out of' }] }),
			TWO
		]);
		expect(looks).toEqual([{ from: ONE.ref, to: TWO.ref, label: 'grew out of' }]);
	});

	it('reads a pair off the other end where that is the end holding one', () => {
		const looks = looksOnCanvas([ONE, looking(TWO, { edges: [{ to: ONE.ref, direction: 'to' }] })]);
		expect(looks).toEqual([{ from: TWO.ref, to: ONE.ref, direction: 'to' }]);
	});

	// Two people each set one on the same line: the note written later wins, so
	// two readers of one pair read one look.
	it('draws one look on a pair both ends set one on', () => {
		const mine = looking(ONE, {
			edges: [{ to: TWO.ref, label: 'mine' }],
			updated_at: '2026-02-02T00:00:00.000Z'
		});
		const theirs = looking(TWO, {
			created_by: ELSE,
			edges: [{ to: ONE.ref, label: 'theirs' }],
			updated_at: '2026-03-03T00:00:00.000Z'
		});
		expect(looksOnCanvas([mine, theirs])).toEqual([
			{ from: theirs.ref, to: ONE.ref, label: 'theirs' }
		]);
	});

	it('leaves out a look on a note this canvas is not drawing', () => {
		const away = ref(9);
		expect(looksOnCanvas([looking(ONE, { edges: [{ to: away, label: 'about' }] })])).toEqual([]);
	});

	it('hands a canvas nobody has written a look on nothing', () => {
		expect(looksOnCanvas([ONE, TWO])).toEqual([]);
	});
});

describe('the note a look is written on', () => {
	it('is the note the reader came from where neither end carries one', () => {
		const line = lineBetween(TWO, ONE);
		expect(line.on.ref).toBe(TWO.ref);
		expect(line.other.ref).toBe(ONE.ref);
		expect(line.look).toBeUndefined();
	});

	// Editing the look a line is drawn under is editing the note carrying it,
	// whichever end the reader reached it from.
	it('is whichever end already carries the look on that pair', () => {
		const held = looking(ONE, { edges: [{ to: TWO.ref, stroke: 'dotted' }], updated_at: AT });
		const line = lineBetween(TWO, held);
		expect(line.on.ref).toBe(held.ref);
		expect(line.other.ref).toBe(TWO.ref);
		expect(line.look).toEqual({ to: TWO.ref, stroke: 'dotted' });
	});
});
