// Sloppy's own acts, done against a project's container — the page's half of
// docs/ARCHITECTURE.md § "Asking a tool to write the notes".

import { AGENT_FILE, LocalApi, MemoryFiles } from '@sloppy/local';
import {
	CHAT_TOLD_MAX,
	ChatActDoneSchema,
	type ChatCard,
	type ChatToolCall,
	ListedNoteSchema,
	NODE_TITLE_MAX,
	NoteBinnedSchema,
	NoteReadSchema,
	NotesFoundSchema,
	NotesListedSchema,
	NoteWrittenSchema,
	type OwnedRef,
	splitOwnedRef
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
	ChatActDoneSchema.parse(said);
	return said.said;
}

function writes(
	about: string,
	sections: string[],
	beside: { title?: string; tags?: string[]; under?: OwnedRef; address?: string } = {}
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

describe('numbering a note', () => {
	it('writes the number a person cites it by, and takes it off again', async () => {
		const note = await wrote(writes(PARSER, [ABOUT_THE_PARSER], { title: 'The parser' }));

		const numbered = ListedNoteSchema.parse(
			JSON.parse(
				await answer({ call: 'c2', act: 'number_note', arguments: { note, address: '7' } })
			)
		);
		const bare = ListedNoteSchema.parse(
			JSON.parse(await answer({ call: 'c3', act: 'number_note', arguments: { note } }))
		);

		expect(numbered.address).toBe('7');
		expect(bare.address).toBeUndefined();
	});

	it('leaves the number it gave up leading to it, so a citation still lands', async () => {
		const note = await wrote(writes(PARSER, [ABOUT_THE_PARSER], { title: 'The parser' }));
		await answer({ call: 'c2', act: 'number_note', arguments: { note, address: '7' } });
		await answer({ call: 'c3', act: 'number_note', arguments: { note, address: '8' } });

		const found = NotesFoundSchema.parse(
			JSON.parse(await answer({ call: 'c4', act: 'search_notes', arguments: { words: '7' } }))
		);

		expect(found.found.map((one) => one.note)).toEqual([note]);
	});

	it('hands back what the graph refused, rather than numbering it anyway', async () => {
		const folder = await wrote(writes('src', ['## Why\n\nEverything the compiler reads.']));
		const note = await wrote(writes(PARSER, [ABOUT_THE_PARSER], { title: 'The parser' }));
		await answer({ call: 'c2', act: 'number_note', arguments: { note: folder, address: '1' } });

		const said = await serveChatCall(files, {
			call: 'c3',
			act: 'number_note',
			arguments: { note, address: '1' }
		});

		expect(said.trouble).toBe(true);
		expect(said.said).not.toBe('');
		expect((await containerApi(files).getNode(note))?.address).toBeUndefined();
	});

	it('answers a numbering of a note that is not there with words the agent can act on', async () => {
		const said = await serveChatCall(files, {
			call: 'c1',
			act: 'number_note',
			arguments: { note: `${SOMEBODY}/01J0000000000000000000000A`, address: '1' }
		});

		expect(said.trouble).toBe(true);
		expect(said.said).toContain('no note');
	});
});

describe('drawing a line between two notes', () => {
	/** Two notes, and a line the person drew by hand between the second and a
	 *  third, which no act below names. */
	async function drawn(): Promise<{ parser: OwnedRef; seeds: OwnedRef; theirs: OwnedRef }> {
		const parser = await wrote(writes(PARSER, [ABOUT_THE_PARSER], { title: 'The parser' }));
		const seeds = await wrote(writes(PLACES_FILE, ['## Why\n\nWhere each name was.'], {}));
		const theirs = await wrote(writes(READING_DOC, ['## Why\n\nRead this first.'], {}));
		await containerApi(files).updateNode(parser, { links: [theirs] });
		return { parser, seeds, theirs };
	}

	it('draws the line, and leaves the one already there alone', async () => {
		const { parser, seeds, theirs } = await drawn();

		const listed = ListedNoteSchema.parse(
			JSON.parse(
				await answer({ call: 'c4', act: 'link_notes', arguments: { note: parser, to: [seeds] } })
			)
		);

		expect([...(listed.links ?? [])].sort()).toEqual([seeds, theirs].sort());
	});

	it('takes the line named off, and no other', async () => {
		const { parser, seeds, theirs } = await drawn();
		await answer({ call: 'c4', act: 'link_notes', arguments: { note: parser, to: [seeds] } });

		const listed = ListedNoteSchema.parse(
			JSON.parse(
				await answer({ call: 'c5', act: 'link_notes', arguments: { note: parser, off: [seeds] } })
			)
		);

		expect(listed.links).toEqual([theirs]);
	});

	it('answers a line to a note that is not there without drawing any of them', async () => {
		const { parser, seeds } = await drawn();

		const said = await serveChatCall(files, {
			call: 'c4',
			act: 'link_notes',
			arguments: { note: parser, to: [seeds, `${SOMEBODY}/01J0000000000000000000000A`] }
		});

		expect(said.trouble).toBe(true);
		expect((await containerApi(files).getNode(parser))?.links).not.toContain(seeds);
	});

	it('draws no line from a note to itself', async () => {
		const { parser } = await drawn();

		const said = await serveChatCall(files, {
			call: 'c4',
			act: 'link_notes',
			arguments: { note: parser, to: [parser] }
		});

		expect(said.trouble).toBe(true);
	});

	it('says a linking that would change nothing changed nothing', async () => {
		const { parser } = await drawn();

		const said = await serveChatCall(files, {
			call: 'c4',
			act: 'link_notes',
			arguments: { note: parser }
		});

		expect(said.trouble).toBe(true);
	});
});

describe('what a line reads as', () => {
	async function twoNotes(): Promise<{ parser: OwnedRef; seeds: OwnedRef }> {
		const parser = await wrote(writes(PARSER, [ABOUT_THE_PARSER], { title: 'The parser' }));
		const seeds = await wrote(writes(PLACES_FILE, ['## Why\n\nWhere each name was.'], {}));
		return { parser, seeds };
	}

	it('writes the words on the line, and reads them back off the note', async () => {
		const { parser, seeds } = await twoNotes();

		await answer({
			call: 'c4',
			act: 'style_edge',
			arguments: { note: parser, to: seeds, label: 'grew out of', direction: 'to' }
		});

		const read = NoteReadSchema.parse(
			JSON.parse(await answer({ call: 'c5', act: 'read_note', arguments: { note: parser } }))
		);
		expect(read.edges).toEqual([{ to: seeds, label: 'grew out of', direction: 'to' }]);
	});

	it('leaves the line with one look, whichever end of it the agent names', async () => {
		const { parser, seeds } = await twoNotes();
		await answer({
			call: 'c4',
			act: 'style_edge',
			arguments: { note: parser, to: seeds, label: 'grew out of' }
		});

		await answer({
			call: 'c5',
			act: 'style_edge',
			arguments: { note: seeds, to: parser, stroke: 'dashed', direction: 'to' }
		});

		const api = containerApi(files);
		expect((await api.getNode(seeds))?.edges).toBeUndefined();
		// The arrowhead turns with the end the look is written on, so it still
		// points at the note the agent named.
		expect((await api.getNode(parser))?.edges).toEqual([
			{ to: seeds, label: 'grew out of', direction: 'from', stroke: 'dashed' }
		]);
	});

	it('takes the channels named back off and leaves the rest of the look', async () => {
		const { parser, seeds } = await twoNotes();
		await answer({
			call: 'c4',
			act: 'style_edge',
			arguments: { note: parser, to: seeds, label: 'grew out of', stroke: 'dotted' }
		});

		await answer({
			call: 'c5',
			act: 'style_edge',
			arguments: { note: parser, to: seeds, off: ['label'] }
		});

		expect((await containerApi(files).getNode(parser))?.edges).toEqual([
			{ to: seeds, stroke: 'dotted' }
		]);
	});

	it('leaves the line drawn as the graph draws it where every channel comes off', async () => {
		const { parser, seeds } = await twoNotes();
		await answer({
			call: 'c4',
			act: 'style_edge',
			arguments: { note: parser, to: seeds, label: 'grew out of', stroke: 'dotted' }
		});

		await answer({
			call: 'c5',
			act: 'style_edge',
			arguments: { note: parser, to: seeds, off: ['label', 'direction', 'stroke'] }
		});

		expect((await containerApi(files).getNode(parser))?.edges).toBeUndefined();
	});

	it('answers a look on a line to a note that is not there', async () => {
		const { parser } = await twoNotes();

		const said = await serveChatCall(files, {
			call: 'c4',
			act: 'style_edge',
			arguments: {
				note: parser,
				to: `${SOMEBODY}/01J0000000000000000000000A`,
				label: 'grew out of'
			}
		});

		expect(said.trouble).toBe(true);
	});

	it('says a look that names no channel changed nothing', async () => {
		const { parser, seeds } = await twoNotes();

		const said = await serveChatCall(files, {
			call: 'c4',
			act: 'style_edge',
			arguments: { note: parser, to: seeds }
		});

		expect(said.trouble).toBe(true);
	});
});

describe('how a note is drawn', () => {
	it('sets the channels named and leaves the picture its author put on the mark', async () => {
		const note = await wrote(writes(PARSER, [ABOUT_THE_PARSER], { title: 'The parser' }));
		await containerApi(files).updateNode(note, { appearance: { preview: 'up1' } });

		await answer({
			call: 'c2',
			act: 'style_note',
			arguments: { note, ring_weight: 'heavy', ring_style: 'dashed' }
		});

		expect((await containerApi(files).getNode(note))?.appearance).toEqual({
			preview: 'up1',
			ring_weight: 'heavy',
			ring_style: 'dashed'
		});
	});

	it('draws the mark at the step it names, over the fine size a person set', async () => {
		const note = await wrote(writes(PARSER, [ABOUT_THE_PARSER], { title: 'The parser' }));
		await containerApi(files).updateNode(note, { appearance: { mark_scale: 1.9 } });

		await answer({
			call: 'c2',
			act: 'style_note',
			arguments: { note, mark_radius: 'small' }
		});

		expect((await containerApi(files).getNode(note))?.appearance).toEqual({
			mark_radius: 'small'
		});
	});

	it('leaves the note unstyled where every channel it carries comes off', async () => {
		const note = await wrote(writes(PARSER, [ABOUT_THE_PARSER], { title: 'The parser' }));
		await answer({
			call: 'c2',
			act: 'style_note',
			arguments: { note, ring_weight: 'heavy', mark_radius: 'large' }
		});

		await answer({
			call: 'c3',
			act: 'style_note',
			arguments: { note, off: ['ring_weight', 'ring_style', 'mark_radius'] }
		});

		expect((await containerApi(files).getNode(note))?.appearance).toBeUndefined();
	});

	it('says a look that names no channel changed nothing', async () => {
		const note = await wrote(writes(PARSER, [ABOUT_THE_PARSER], { title: 'The parser' }));

		const said = await serveChatCall(files, {
			call: 'c2',
			act: 'style_note',
			arguments: { note }
		});

		expect(said.trouble).toBe(true);
	});
});

describe('putting a note in the bin', () => {
	it('answers the note as it stood, and the notes here no longer hold it', async () => {
		const note = await wrote(writes(PARSER, [ABOUT_THE_PARSER], { title: 'The parser' }));

		const binned = NoteBinnedSchema.parse(
			JSON.parse(await answer({ call: 'c2', act: 'delete_note', arguments: { note } }))
		);

		expect(binned.binned.note).toBe(note);
		expect(binned.binned.title).toBe('The parser');
		const listed = NotesListedSchema.parse(
			JSON.parse(await answer({ call: 'c3', act: 'list_notes', arguments: {} }))
		);
		expect(listed.notes.map((one) => one.note)).not.toContain(note);
	});

	it('leaves it where a person can take it back out', async () => {
		const note = await wrote(writes(PARSER, [ABOUT_THE_PARSER], { title: 'The parser' }));
		await answer({ call: 'c2', act: 'delete_note', arguments: { note } });

		const api = containerApi(files);
		expect((await api.deletedBranches()).map((one) => one.ref)).toContain(note);
		await api.restoreBranch(note);
		expect((await api.getNode(note))?.title).toBe('The parser');
	});

	it('answers a note that is not there with words the agent can act on', async () => {
		const said = await serveChatCall(files, {
			call: 'c1',
			act: 'delete_note',
			arguments: { note: `${SOMEBODY}/01J0000000000000000000000A` }
		});

		expect(said.trouble).toBe(true);
		expect(said.said).toContain('no note');
	});
});

describe('the number a note is written or carried at', () => {
	it('leaves a written note with none where the write names none', async () => {
		const folder = await wrote(writes('src', ['## Why\n\nEverything the compiler reads.']));
		const note = await wrote(writes(PARSER, [ABOUT_THE_PARSER], { title: 'The parser' }));

		const api = containerApi(files);
		expect((await api.getNode(folder))?.address).toBeUndefined();
		expect((await api.getNode(note))?.address).toBeUndefined();
	});

	it('numbers a note the write names one for', async () => {
		const folder = await wrote(writes('src', ['## Why\n\nEverything the compiler reads.']));
		await answer({ call: 'c2', act: 'number_note', arguments: { note: folder, address: '1' } });

		const note = await wrote(
			writes(PARSER, [ABOUT_THE_PARSER], { title: 'The parser', address: '1a' })
		);

		expect((await containerApi(files).getNode(note))?.address).toBe('1a');
	});

	it('hands back what the graph refused a number, and writes no note', async () => {
		await wrote(writes('src', ['## Why\n\nEverything the compiler reads.']));

		const said = await serveChatCall(
			files,
			writes(PARSER, [ABOUT_THE_PARSER], { title: 'The parser', address: '1a' })
		);

		expect(said.trouble).toBe(true);
		expect(said.said).not.toBe('');
		const listed = NotesListedSchema.parse(
			JSON.parse(await answer({ call: 'c3', act: 'list_notes', arguments: {} }))
		);
		expect(listed.notes).toHaveLength(1);
	});

	it('numbers the note a write lands on, where the write names a number', async () => {
		const folder = await wrote(writes('src', ['## Why\n\nEverything the compiler reads.']));
		await answer({ call: 'c2', act: 'number_note', arguments: { note: folder, address: '1' } });
		const note = await wrote(writes(PARSER, [ABOUT_THE_PARSER], { title: 'The parser' }));

		await answer(writes(PARSER, ['## How\n\nBy one table.'], { address: '1a' }));

		expect((await containerApi(files).getNode(note))?.address).toBe('1a');
	});

	it('writes nothing where the graph refuses the number a write names', async () => {
		const folder = await wrote(writes('src', ['## Why\n\nEverything the compiler reads.']));
		await answer({ call: 'c2', act: 'number_note', arguments: { note: folder, address: '1' } });
		const note = await wrote(writes(PARSER, [ABOUT_THE_PARSER], { title: 'The parser' }));

		// Numbered by the rule when it was written, under a folder note at 1.
		expect((await containerApi(files).getNode(note))?.address).toBe('1a');

		const said = await serveChatCall(
			files,
			writes(PARSER, ['## How\n\nBy one table.'], { address: '1' })
		);

		expect(said.trouble).toBe(true);
		const read = NoteReadSchema.parse(
			JSON.parse(await answer({ call: 'c4', act: 'read_note', arguments: { note } }))
		);
		expect(read.sections.map((one) => one.markdown).join('')).not.toContain('By one table');
		expect(read.address).toBe('1a');
	});

	it('carries a note to the number the move names', async () => {
		const folder = await wrote(writes('src', ['## Why\n\nEverything the compiler reads.']));
		const parser = await wrote(writes(PARSER, [ABOUT_THE_PARSER], { title: 'The parser' }));
		const api = containerApi(files);
		await api.setAddress(folder, '1');
		await api.setAddress(parser, '1a');
		const reading = await wrote(writes(READING_DOC, ['## Why\n\nRead this first.'], {}));

		const moved = ListedNoteSchema.parse(
			JSON.parse(
				await answer({
					call: 'c4',
					act: 'move_note',
					arguments: { note: reading, to: parser, relation: 'under', address: '1a4' }
				})
			)
		);

		expect(moved.address).toBe('1a4');
	});
});

describe('what a person reads of an act', () => {
	/** The rows of a card, by what each one is labelled. */
	function rows(card: ChatCard | undefined): Record<string, string> {
		return Object.fromEntries((card?.rows ?? []).map((row) => [row.label, row.value]));
	}

	it('lays a write out: what it is called, where it is, and what it carries', async () => {
		const done = await serveChatCall(
			files,
			writes(PARSER, [ABOUT_THE_PARSER], { title: 'The parser', tags: ['reading'] })
		);

		expect(done.told).toBe('Written.');
		expect(done.card?.about).toBe('note');
		expect(done.card?.heading).toContain('The parser');
		expect(rows(done.card)).toMatchObject({ Place: PARSER, Tags: 'reading', Sections: 'Why' });
	});

	it('lays out what a tagging puts on and what it takes off', async () => {
		const note = await wrote(
			writes(PARSER, [ABOUT_THE_PARSER], { title: 'The parser', tags: ['reading'] })
		);

		const done = await serveChatCall(files, {
			call: 'c2',
			act: 'tag_note',
			arguments: { note, tags: ['parser'], off: ['reading'] }
		});

		expect(done.told).toBe('Tagged, and tags taken off.');
		expect(rows(done.card)).toMatchObject({ On: 'parser', Off: 'reading' });
	});

	it('names no note by its ref, wherever a card names one', async () => {
		const note = await wrote(writes(PARSER, [ABOUT_THE_PARSER], { title: 'The parser' }));

		const done = await serveChatCall(files, {
			call: 'c2',
			act: 'number_note',
			arguments: { note, address: '7' }
		});

		const card = JSON.stringify(done.card);
		expect(card).not.toContain(splitOwnedRef(note).localId);
		expect(card).toContain('7');
	});

	it('says a delete takes what is under it, and that it can be put back', async () => {
		const folder = await wrote(writes('src', ['## Why\n\nEverything the compiler reads.']));
		const parser = await wrote(writes(PARSER, [ABOUT_THE_PARSER], { title: 'The parser' }));

		const done = await serveChatCall(files, {
			call: 'c3',
			act: 'delete_note',
			arguments: { note: folder }
		});

		expect(done.told).toContain('1 note');
		expect(done.told).toContain('put them back');
		expect(rows(done.card)).toMatchObject({ 'With it': '1 note' });
		expect([...(done.touched ?? [])].sort()).toEqual([folder, parser].sort());
	});

	it('names every note a move carried, so the canvas reads those and no more', async () => {
		const reading = await wrote(writes(READING_DOC, ['## Why\n\nRead this first.']));
		const folder = await wrote(writes('src', ['## Why\n\nEverything the compiler reads.']));
		const parser = await wrote(writes(PARSER, [ABOUT_THE_PARSER], { title: 'The parser' }));

		const done = await serveChatCall(files, {
			call: 'c4',
			act: 'move_note',
			arguments: { note: folder, to: reading, relation: 'after' }
		});

		expect(done.told).toContain('Carried');
		expect([...(done.touched ?? [])].sort()).toEqual([folder, parser].sort());
	});

	it('leaves nothing to read again where an act only read', async () => {
		await wrote(writes(PARSER, [ABOUT_THE_PARSER], { title: 'The parser' }));

		const done = await serveChatCall(files, { call: 'c2', act: 'list_notes', arguments: {} });

		expect(done.touched).toEqual([]);
		expect(done.told).toBe('1 note here.');
		expect(done.card).toBeUndefined();
	});

	it('says a number taken off still leads to the note it was on', async () => {
		const note = await wrote(writes(PARSER, [ABOUT_THE_PARSER], { title: 'The parser' }));
		await answer({ call: 'c2', act: 'number_note', arguments: { note, address: '7' } });

		const done = await serveChatCall(files, {
			call: 'c3',
			act: 'number_note',
			arguments: { note }
		});

		expect(done.told).toContain('7 still leads here');
		expect(rows(done.card)).toMatchObject({ Number: 'None', 'Also at': '7' });
	});

	it('holds the line to a line, whatever the notes are called', async () => {
		const long = 'The parser, '.repeat(48).slice(0, NODE_TITLE_MAX);
		const note = await wrote(writes(PARSER, [ABOUT_THE_PARSER], { title: long }));

		const read = await serveChatCall(files, { call: 'c2', act: 'read_note', arguments: { note } });

		expect(long.length).toBe(NODE_TITLE_MAX);
		expect(read.told?.length).toBeLessThanOrEqual(CHAT_TOLD_MAX);
		expect(ChatActDoneSchema.safeParse(read).success).toBe(true);
	});

	it('holds the line to a line, however many numbers led to a note', async () => {
		const note = await wrote(writes(PARSER, [ABOUT_THE_PARSER], { title: 'The parser' }));
		for (let at = 1; at <= 60; at += 1) {
			await answer({ call: 'c2', act: 'number_note', arguments: { note, address: `${at}` } });
		}

		const off = await serveChatCall(files, {
			call: 'c3',
			act: 'number_note',
			arguments: { note }
		});

		expect(off.told?.length).toBeLessThanOrEqual(CHAT_TOLD_MAX);
		expect(ChatActDoneSchema.safeParse(off).success).toBe(true);
	});

	it('tells the person what happened without the words written for the agent', async () => {
		const done = await serveChatCall(files, {
			call: 'c1',
			act: 'read_note',
			arguments: { note: `${SOMEBODY}/01J0000000000000000000000A` }
		});

		expect(done.told).toBe('That note is not here.');
		expect(done.said).toContain('ref');
		expect(done.touched).toEqual([]);
	});
});

describe('a place beside the project', () => {
	const PLACE = '/work/lexer';
	const PLAIN = '/work/scratch';

	/** One device's disk, so the project and the folders beside it sit on it
	 *  together. */
	let device: Map<string, Uint8Array>;
	let place: MemoryFiles;

	/** An act against `at` served the way a place is served. */
	function reads(at: MemoryFiles, call: ChatToolCall) {
		return serveChatCall(at, call, true);
	}

	beforeEach(async () => {
		device = new Map();
		place = new MemoryFiles({ root: PLACE, data: '/data/other', store: device });
		await place.write(PARSER, new TextEncoder().encode('export const two = 2;\n'));
		await containerApi(place).openProject(PLACE);
		await serveChatCall(place, writes(PARSER, [ABOUT_THE_PARSER], { title: 'The lexer' }));
	});

	it('answers the notes it holds, and nothing is written in it', async () => {
		// Gone, the two files a project of this device's own carries: a read that
		// put them back would be a write in somebody else's repository.
		await place.remove('.sloppy/.gitignore');
		await place.remove(`.sloppy/${AGENT_FILE}`);
		const before = [...device.keys()].sort();

		const said = await reads(place, { call: 'c1', act: 'list_notes', arguments: {} });

		expect(NotesListedSchema.parse(JSON.parse(said.said)).notes).toHaveLength(1);
		expect([...device.keys()].sort()).toEqual(before);
	});

	it('writes nothing into a folder holding no notes, and says there are none', async () => {
		const plain = new MemoryFiles({ root: PLAIN, data: '/data/other', store: device });
		await plain.write(PARSER, new TextEncoder().encode('export const three = 3;\n'));
		const before = [...device.keys()].sort();

		await expect(reads(plain, { call: 'c1', act: 'list_notes', arguments: {} })).rejects.toThrow(
			'There are no notes in that folder'
		);

		expect([...device.keys()].sort()).toEqual(before);
	});

	it('refuses an act that would write, whatever routed it here', async () => {
		const before = [...device.keys()].sort();

		const done = await reads(place, writes(PARSER, [ABOUT_THE_PARSER]));

		expect(done.trouble).toBe(true);
		expect(done.said).toContain('can only be read');
		expect([...device.keys()].sort()).toEqual(before);
	});
});
