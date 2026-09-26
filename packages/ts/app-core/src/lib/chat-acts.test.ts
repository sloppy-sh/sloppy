// Sloppy's own acts, done against a project's container — the page's half of
// docs/ARCHITECTURE.md § "Asking a tool to write the notes".

import { LocalApi, MemoryFiles } from '@sloppy/local';
import {
	type ChatToolCall,
	ListedNoteSchema,
	NoteReadSchema,
	NotesListedSchema,
	NoteWrittenSchema,
	type OwnedRef
} from '@sloppy/types';
import { beforeEach, describe, expect, it } from 'vitest';
import { containerApi, serveChatCall } from './chat-acts.js';

const PROJECT = '/work/compiler';
const SOMEBODY = 'did:syr:z6MkrAnotherPersonWritingHereAAAAAAAAAAAAAAAA';
const PARSER = 'src/parser.ts';
const ABOUT_THE_PARSER = `## Why\n\nIt reads [${PARSER}](code:${PARSER}) whole.`;

let files: MemoryFiles;

async function answer(call: ChatToolCall): Promise<string> {
	const said = await serveChatCall(files, call);
	expect(said.trouble).toBeUndefined();
	return said.said;
}

function writes(
	about: string,
	sections: string[],
	beside: { title?: string; tags?: string[] } = {}
): ChatToolCall {
	return { call: 'c1', act: 'write_note', arguments: { about, sections, ...beside } };
}

/** The container as somebody else's writing left it: a note nobody here wrote,
 *  which is what an offer rather than an overwrite rests on. */
async function theirNote(): Promise<OwnedRef> {
	const theirs = new LocalApi(containerApi(files).files, { writer: SOMEBODY });
	const note = await theirs.createNode({ from: { relation: 'free' }, title: 'The parser' });
	await theirs.createBlock({
		node: note.ref,
		content: {
			type: 'doc',
			content: [
				{
					type: 'paragraph',
					content: [
						{
							type: 'text',
							text: PARSER,
							marks: [{ type: 'link', attrs: { href: `code:${PARSER}` } }]
						}
					]
				}
			]
		}
	});
	return note.ref;
}

beforeEach(async () => {
	files = new MemoryFiles({ root: PROJECT, data: '/data' });
	await files.write(PARSER, new TextEncoder().encode('export const one = 1;\n'));
	await containerApi(files).openProject(PROJECT);
});

describe('the notes a project has', () => {
	it('are none where nothing has been written', async () => {
		const said = await answer({ call: 'c1', act: 'list_notes', arguments: {} });

		expect(NotesListedSchema.parse(JSON.parse(said)).notes).toEqual([]);
	});

	it('carry what a note is called, what it is tagged and what it is about', async () => {
		await answer(writes(PARSER, [ABOUT_THE_PARSER], { title: 'The parser', tags: ['reading'] }));

		const listed = NotesListedSchema.parse(
			JSON.parse(await answer({ call: 'c2', act: 'list_notes', arguments: {} }))
		);

		expect(listed.notes).toHaveLength(1);
		expect(listed.notes[0].title).toBe('The parser');
		expect(listed.notes[0].tags).toEqual(['reading']);
		expect(listed.notes[0].about).toEqual([PARSER]);
	});
});

describe('writing a note', () => {
	it('starts one where the place has none, and says so', async () => {
		const written = NoteWrittenSchema.parse(
			JSON.parse(await answer(writes(PARSER, [ABOUT_THE_PARSER], { title: 'The parser' })))
		);

		expect(written.done).toBe('written');
		const read = NoteReadSchema.parse(
			JSON.parse(await answer({ call: 'c2', act: 'read_note', arguments: { note: written.note } }))
		);
		expect(read.title).toBe('The parser');
		expect(read.sections[0].markdown).toContain('It reads');
	});

	it('writes onto the note that points at the place rather than a second one', async () => {
		const first = NoteWrittenSchema.parse(
			JSON.parse(await answer(writes(PARSER, [ABOUT_THE_PARSER])))
		);
		const again = NoteWrittenSchema.parse(
			JSON.parse(
				await answer(writes(PARSER, [`## Why\n\nIt reads [${PARSER}](code:${PARSER}) twice.`]))
			)
		);

		expect(again.note).toBe(first.note);
		expect(again.done).toBe('written');
		const listed = NotesListedSchema.parse(
			JSON.parse(await answer({ call: 'c3', act: 'list_notes', arguments: {} }))
		);
		expect(listed.notes).toHaveLength(1);
	});

	it('holds the place a note it started is about, so the next write lands on it', async () => {
		const first = NoteWrittenSchema.parse(
			JSON.parse(
				await answer(writes(PARSER, ['## Why\n\nBecause it is bounded.'], { title: 'The parser' }))
			)
		);
		const again = NoteWrittenSchema.parse(
			JSON.parse(await answer(writes(PARSER, ['## How\n\nBy one table.'])))
		);

		expect(again.note).toBe(first.note);
		const listed = NotesListedSchema.parse(
			JSON.parse(await answer({ call: 'c3', act: 'list_notes', arguments: {} }))
		);
		expect(listed.notes).toHaveLength(1);
		expect(listed.notes[0].title).toBe('The parser');
		expect(listed.notes[0].about).toEqual([PARSER]);
	});

	// A project's container is an open graph, so the store would let this land.
	// The rule that makes it an offer is the writer's own — `writeOnto`.
	it('offers a change on a note somebody else has written in', async () => {
		const theirs = await theirNote();

		const written = NoteWrittenSchema.parse(
			JSON.parse(await answer(writes(PARSER, ['## Why\n\nBecause it is bounded.'])))
		);

		expect(written.note).toBe(theirs);
		expect(written.done).toBe('offered');
	});

	it('answers a read of a note that is not there with words the agent can act on', async () => {
		const said = await serveChatCall(files, {
			call: 'c1',
			act: 'read_note',
			arguments: { note: `${SOMEBODY}/01J0000000000000000000000A` }
		});

		expect(said.trouble).toBe(true);
		expect(said.said).toContain('no note');
	});
});

describe('tagging a note', () => {
	it('puts tags on and takes none off', async () => {
		const written = NoteWrittenSchema.parse(
			JSON.parse(await answer(writes(PARSER, [ABOUT_THE_PARSER], { tags: ['reading'] })))
		);

		const listed = ListedNoteSchema.parse(
			JSON.parse(
				await answer({
					call: 'c2',
					act: 'tag_note',
					arguments: { note: written.note, tags: ['parser'] }
				})
			)
		);

		expect([...listed.tags].sort()).toEqual(['parser', 'reading']);
	});
});
