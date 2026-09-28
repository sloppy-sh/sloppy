// Which notes the code has moved under, for the marks on the canvas —
// DESIGN.md § "What the code left behind". A note the person has read against
// the code answers; one nobody has read says nothing; and beside no project
// nothing is worked out at all.

import { MemoryFiles } from '@sloppy/local';
import type { NodeView, OwnedRef } from '@sloppy/types';
import { digestOf } from '@sloppy/vault';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { codeDrift } from './code-drift.svelte.js';
import { node, ref } from './fake-api.test-support.js';

const PROJECT = '/home/ada/garden';
const PARSER = ref(1);
const GUIDE = ref(2);

const PARSED = 'export const one = 1;\n';
const said = (text: string) => new TextEncoder().encode(text);

let files: MemoryFiles;

async function wrote(at: string, text: string): Promise<void> {
	await files.write(at, said(text));
}

/** A note pointing at `at` and read against what that file said then. */
async function readAgainst(of: OwnedRef, at: string, text: string): Promise<NodeView> {
	const which = of === PARSER ? 1 : 2;
	return {
		...node(which, `${which}`),
		ref: of,
		read_against: [{ path: at, digest: await digestOf(said(text)) }]
	} as NodeView;
}

/** Every read is a fresh one, so nothing is answered out of the last pass. */
let reads = 0;
const read = (notes: readonly NodeView[], project: MemoryFiles | undefined) =>
	codeDrift.read(notes, project, ++reads);

beforeEach(() => {
	files = new MemoryFiles({ root: PROJECT, store: new Map(), data: '/data' });
});

afterEach(() => {
	codeDrift.clear();
});

describe('the notes the code has moved under', () => {
	it('names a note whose file says something else now', async () => {
		await wrote('src/parser.ts', `${PARSED}// and more\n`);
		const parser = await readAgainst(PARSER, 'src/parser.ts', PARSED);

		await read([parser], files);

		expect([...codeDrift.moved]).toEqual([PARSER]);
	});

	it('says nothing about a note whose file still says the same', async () => {
		await wrote('src/parser.ts', PARSED);
		const parser = await readAgainst(PARSER, 'src/parser.ts', PARSED);

		await read([parser], files);

		expect([...codeDrift.moved]).toEqual([]);
	});

	// Unread is not stale.
	it('says nothing about a note nobody has read against the code', async () => {
		await wrote('src/parser.ts', `${PARSED}// and more\n`);

		await read([node(1, '1')], files);

		expect([...codeDrift.moved]).toEqual([]);
	});

	it('names a note whose file the project has not got any more', async () => {
		const parser = await readAgainst(PARSER, 'src/parser.ts', PARSED);

		await read([parser], files);

		expect([...codeDrift.moved]).toEqual([PARSER]);
	});

	// Not moved, and not up to date either.
	it('works nothing out where the project is not open beside the notes', async () => {
		await wrote('src/parser.ts', `${PARSED}// and more\n`);
		const parser = await readAgainst(PARSER, 'src/parser.ts', PARSED);

		await read([parser], undefined);

		expect([...codeDrift.moved]).toEqual([]);
	});

	it('answers one note at a time for the surface reading one', async () => {
		await wrote('src/parser.ts', `${PARSED}// and more\n`);
		await wrote('docs/guide.md', '# Guide\n');
		const parser = await readAgainst(PARSER, 'src/parser.ts', PARSED);
		const guide = await readAgainst(GUIDE, 'docs/guide.md', '# Guide\n');

		expect(await codeDrift.under(parser.read_against, files, ++reads)).toEqual(['src/parser.ts']);
		expect(await codeDrift.under(guide.read_against, files, reads)).toEqual([]);
		expect(await codeDrift.under(undefined, files, reads)).toEqual([]);
		expect(await codeDrift.under(parser.read_against, undefined, reads)).toEqual([]);
	});

	it('reads the files again once somebody has read the code themselves', async () => {
		await wrote('src/parser.ts', `${PARSED}// and more\n`);
		const parser = await readAgainst(PARSER, 'src/parser.ts', PARSED);
		await read([parser], files);
		expect([...codeDrift.moved]).toEqual([PARSER]);

		// The same folder read, so only the act says the last pass is spent.
		const held = reads;
		const now = await readAgainst(PARSER, 'src/parser.ts', `${PARSED}// and more\n`);
		await wrote('src/parser.ts', `${PARSED}// and more still\n`);
		codeDrift.again();
		await codeDrift.read([now], files, held);

		expect([...codeDrift.moved]).toEqual([PARSER]);
	});

	it('lets go of what it read out of another folder', async () => {
		await wrote('src/parser.ts', `${PARSED}// and more\n`);
		await read([await readAgainst(PARSER, 'src/parser.ts', PARSED)], files);

		codeDrift.clear();

		expect([...codeDrift.moved]).toEqual([]);
	});
});
