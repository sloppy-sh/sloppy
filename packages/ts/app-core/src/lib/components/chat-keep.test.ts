// An answer kept as a note — what it is called, where it belongs and the
// sections it is written in. docs/ARCHITECTURE.md § "Asking a tool to write
// the notes".

import { MAX_SECTIONS_PER_WRITE, type ChatTurn } from '@sloppy/types';
import { describe, expect, it } from 'vitest';
import { noteFromAnswer, placeForAnswer } from './chat-keep.js';

const AT = '2026-09-27T00:00:00.000Z';

function turn(blocks: ChatTurn['blocks']): ChatTurn {
	return { from: 'agent', blocks, at: AT };
}

describe('what a kept answer is called and written in', () => {
	it('takes its title from the heading the answer opens with, and keeps it out of the writing', () => {
		const held = noteFromAnswer('# How the parser reads\n\n## Why\n\nBecause.', 'src/parser.ts');

		expect(held?.title).toBe('How the parser reads');
		expect(held?.sections).toEqual(['## Why\n\nBecause.']);
	});

	it('gives an answer written in nothing but prose one section under its own title', () => {
		const held = noteFromAnswer('The parser hands the lexer tokens.\n\nThen it folds them.', 'a/b');

		expect(held?.title).toBe('The parser hands the lexer tokens');
		expect(held?.sections).toEqual([
			'## The parser hands the lexer tokens\n\nThe parser hands the lexer tokens.\n\nThen it folds them.'
		]);
	});

	it('carries what an answer says before its first heading, under the title', () => {
		const held = noteFromAnswer('# A guide\n\nStart here.\n\n## The parser\n\nIt reads.', 'a/b');

		expect(held?.sections).toEqual(['## A guide\n\nStart here.', '## The parser\n\nIt reads.']);
	});

	it('leaves a heading inside a fence where it was written', () => {
		const held = noteFromAnswer('# A guide\n\n```sh\n## not a section\n```\n', 'a/b');

		expect(held?.sections).toEqual(['## A guide\n\n```sh\n## not a section\n```']);
	});

	it('keeps the whole of a long answer, folding what runs past one write into the last section', () => {
		const many = Array.from({ length: MAX_SECTIONS_PER_WRITE + 3 }, (_, at) => `## ${at}\n\nx`);
		const held = noteFromAnswer(many.join('\n\n'), 'a/b');

		expect(held?.sections).toHaveLength(MAX_SECTIONS_PER_WRITE);
		expect(held?.sections.at(-1)).toContain(`## ${MAX_SECTIONS_PER_WRITE + 2}`);
	});

	it('is nothing at all where the answer says nothing', () => {
		expect(noteFromAnswer('   \n\n ', 'a/b')).toBeNull();
	});
});

describe('where a kept answer belongs', () => {
	it('is the first place the answer itself names', () => {
		expect(
			placeForAnswer('The work happens in `packages/ts/app-core/src/lib/chat-acts.ts`.', [])
		).toBe('packages/ts/app-core/src/lib/chat-acts.ts');
	});

	it('reads a place written as prose as readily as one written in code', () => {
		expect(placeForAnswer('Start at src/parser.ts and work down.', [])).toBe('src/parser.ts');
	});

	it('is not a turn of phrase that happens to carry a slash', () => {
		expect(placeForAnswer('Either one and/or the other.', [])).toBeUndefined();
	});

	it('falls back to the newest place the conversation named', () => {
		const turns = [
			turn([{ kind: 'tool_call', call: 'c1', tool: 'Read', arguments: { file: 'src/old.ts' } }]),
			turn([
				{
					kind: 'tool_call',
					call: 'c2',
					tool: 'write_note',
					act: 'write_note',
					arguments: { about: 'src/parser.ts', sections: [] }
				}
			])
		];

		expect(placeForAnswer('Nothing here names a place.', turns)).toBe('src/parser.ts');
	});

	it('is nowhere at all where neither the answer nor the chat has named one', () => {
		expect(placeForAnswer('Nothing here names a place.', [])).toBeUndefined();
	});
});
