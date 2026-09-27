// Sloppy's own acts, done against a project's container — the page's half of
// docs/ARCHITECTURE.md § "Asking a tool to write the notes".

import { LocalApi, MemoryFiles } from '@sloppy/local';
import {
	type ChatToolCall,
	ListedNoteSchema,
	NoteReadSchema,
	NotesFoundSchema,
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
const PLACES_FILE = 'src/places.ts';
const READING_DOC = 'docs/reading.md';

let files: MemoryFiles;

async function answer(call: ChatToolCall): Promise<string> {
	const said = await serveChatCall(files, call);
	expect(said.trouble).toBeUndefined();
	return said.said;
}

function writes(
	about: string,
	sections: string[],
	beside: { title?: string; tags?: string[]; under?: OwnedRef } = {}
): ChatToolCall {
	return { call: 'c1', act: 'write_note', arguments: { about, sections, ...beside } };
}

/** The ref of the note a write left, which is what every act after it names. */
async function wrote(call: ChatToolCall): Promise<OwnedRef> {
	return NoteWrittenSchema.parse(JSON.parse(await answer(call))).note;
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

	it('hangs a note under the one the agent named', async () => {
		const folder = await wrote(writes('src', ['## Why\n\nEverything the compiler reads.']));
		const elsewhere = await wrote(
			writes(READING_DOC, ['## Why\n\nWhat somebody new reads first.'], { title: 'Reading' })
		);

		const under = await wrote(
			writes(PLACES_FILE, ['## Why\n\nWhere each name was written.'], { under: elsewhere })
		);

		const notes = NotesListedSchema.parse(
			JSON.parse(await answer({ call: 'c4', act: 'list_notes', arguments: {} }))
		).notes;
		expect(notes.find((one) => one.note === under)?.parent).toBe(elsewhere);
		expect(notes.find((one) => one.note === elsewhere)?.parent).toBe(folder);
	});

	it('hangs a note under the note about the folder above it where the agent names none', async () => {
		const folder = await wrote(writes('src', ['## Why\n\nEverything the compiler reads.']));

		const note = await wrote(writes(PARSER, [ABOUT_THE_PARSER], { title: 'The parser' }));

		const notes = NotesListedSchema.parse(
			JSON.parse(await answer({ call: 'c4', act: 'list_notes', arguments: {} }))
		).notes;
		expect(notes.find((one) => one.note === note)?.parent).toBe(folder);
	});

	it('answers a write under a note that is not there with words the agent can act on', async () => {
		const said = await serveChatCall(
			files,
			writes(PARSER, [ABOUT_THE_PARSER], { under: `${SOMEBODY}/01J0000000000000000000000A` })
		);

		expect(said.trouble).toBe(true);
		expect(said.said).toContain('no note');
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
	it('puts tags on beside the ones already there', async () => {
		const written = await wrote(writes(PARSER, [ABOUT_THE_PARSER], { tags: ['reading'] }));

		const listed = ListedNoteSchema.parse(
			JSON.parse(
				await answer({
					call: 'c2',
					act: 'tag_note',
					arguments: { note: written, tags: ['parser'] }
				})
			)
		);

		expect([...listed.tags].sort()).toEqual(['parser', 'reading']);
	});

	it('takes off the tag named and leaves the ones it was not asked about', async () => {
		const written = await wrote(
			writes(PARSER, [ABOUT_THE_PARSER], { tags: ['reading', 'parser', 'lexing'] })
		);

		const listed = ListedNoteSchema.parse(
			JSON.parse(
				await answer({
					call: 'c2',
					act: 'tag_note',
					arguments: { note: written, off: ['reading'] }
				})
			)
		);

		expect([...listed.tags].sort()).toEqual(['lexing', 'parser']);
	});

	it('puts one on and takes another off in the one act', async () => {
		const written = await wrote(writes(PARSER, [ABOUT_THE_PARSER], { tags: ['reading'] }));

		const listed = ListedNoteSchema.parse(
			JSON.parse(
				await answer({
					call: 'c2',
					act: 'tag_note',
					arguments: { note: written, tags: ['parser'], off: ['reading'] }
				})
			)
		);

		expect([...listed.tags]).toEqual(['parser']);
	});

	it('says a tagging that would change nothing changed nothing', async () => {
		const written = await wrote(writes(PARSER, [ABOUT_THE_PARSER], { tags: ['reading'] }));

		const said = await serveChatCall(files, {
			call: 'c2',
			act: 'tag_note',
			arguments: { note: written }
		});

		expect(said.trouble).toBe(true);
	});
});

describe('looking through the notes', () => {
	const SEEDS = 'src/seeds.ts';

	async function twoNotes(): Promise<{ parser: OwnedRef; seeds: OwnedRef }> {
		const parser = await wrote(
			writes(PARSER, [`## Why\n\nThe lexer hands it tokens, one at a time.`], {
				title: 'The parser'
			})
		);
		const seeds = await wrote(
			writes(SEEDS, [`## Why\n\nA seed keeps its own clock underground.`], { title: 'Seeds' })
		);
		return { parser, seeds };
	}

	it('reaches a note by what it SAYS, and answers something to cite it by', async () => {
		const { parser } = await twoNotes();

		const found = NotesFoundSchema.parse(
			JSON.parse(
				await answer({ call: 'c3', act: 'search_notes', arguments: { words: 'lexer tokens' } })
			)
		);

		expect(found.found.map((one) => one.note)).toEqual([parser]);
		expect(found.found[0].title).toBe('The parser');
		expect(found.found[0].snippet).toContain('hands it tokens');
	});

	it('says so plainly where nothing here carries the words', async () => {
		await twoNotes();

		const found = NotesFoundSchema.parse(
			JSON.parse(
				await answer({ call: 'c3', act: 'search_notes', arguments: { words: 'quantum gravity' } })
			)
		);

		expect(found.found).toEqual([]);
	});
});

describe('carrying a note somewhere else', () => {
	/** A folder note with two notes under it, numbered the way a person would
	 *  number them, so a move has a run to join and a number to leave behind. */
	async function numbered(): Promise<{ folder: OwnedRef; parser: OwnedRef; reading: OwnedRef }> {
		const api = containerApi(files);
		const folder = await wrote(writes('src', ['## Why\n\nEverything the compiler reads.']));
		const parser = await wrote(writes(PARSER, [ABOUT_THE_PARSER], { title: 'The parser' }));
		const reading = await wrote(
			writes(READING_DOC, ['## Why\n\nWhat somebody new reads first.'], { title: 'Reading' })
		);
		await api.setAddress(folder, '1');
		await api.setAddress(parser, '1a');
		await api.setAddress(reading, '1b');
		return { folder, parser, reading };
	}

	async function listed(call: string): Promise<Map<OwnedRef, { parent?: OwnedRef }>> {
		const notes = NotesListedSchema.parse(
			JSON.parse(await answer({ call, act: 'list_notes', arguments: {} }))
		).notes;
		return new Map(notes.map((one) => [one.note, one]));
	}

	it('hangs the note under the one it really sprang out of, and says where it now sits', async () => {
		const { parser, reading } = await numbered();

		const moved = ListedNoteSchema.parse(
			JSON.parse(
				await answer({
					call: 'c4',
					act: 'move_note',
					arguments: { note: reading, to: parser, relation: 'under' }
				})
			)
		);

		expect(moved.note).toBe(reading);
		expect(moved.parent).toBe(parser);
		expect(moved.address).toBe('1a1');
		expect((await listed('c5')).get(reading)?.parent).toBe(parser);
	});

	it('leaves the number it was at leading to it, so a citation still lands', async () => {
		const { parser, reading } = await numbered();
		await answer({
			call: 'c4',
			act: 'move_note',
			arguments: { note: reading, to: parser, relation: 'under' }
		});

		const found = NotesFoundSchema.parse(
			JSON.parse(await answer({ call: 'c5', act: 'search_notes', arguments: { words: '1b' } }))
		);

		expect(found.found.map((one) => one.note)).toEqual([reading]);
	});

	it('puts the note after another where that is what it continues', async () => {
		const { folder, parser, reading } = await numbered();
		const deeper = await wrote(
			writes(PLACES_FILE, ['## Why\n\nWhere each name was written.'], {
				title: 'Places',
				under: parser
			})
		);

		const moved = ListedNoteSchema.parse(
			JSON.parse(
				await answer({
					call: 'c5',
					act: 'move_note',
					arguments: { note: deeper, to: reading, relation: 'after' }
				})
			)
		);

		expect(moved.parent).toBe(folder);
	});

	it('answers a move of a note that is not there with words the agent can act on', async () => {
		const { parser } = await numbered();

		const said = await serveChatCall(files, {
			call: 'c4',
			act: 'move_note',
			arguments: {
				note: `${SOMEBODY}/01J0000000000000000000000A`,
				to: parser,
				relation: 'under'
			}
		});

		expect(said.trouble).toBe(true);
		expect(said.said).toContain('no note');
	});

	it('hands back what the graph refused rather than going quiet', async () => {
		const { parser } = await numbered();

		const said = await serveChatCall(files, {
			call: 'c4',
			act: 'move_note',
			arguments: { note: parser, to: parser, relation: 'under' }
		});

		expect(said.trouble).toBe(true);
		expect(said.said).not.toBe('');
	});
});
