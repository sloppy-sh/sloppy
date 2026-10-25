// What a person reads of Sloppy's own acts in the chat — the page's half of
// docs/ARCHITECTURE.md § "Asking a tool to write the notes". What each act does
// to the notes is `acts.test.ts` in `@sloppy/local`.

import { containerApi, MemoryFiles } from '@sloppy/local';
import {
	CHAT_TOLD_MAX,
	ChatActDoneSchema,
	type ChatCard,
	type ChatToolCall,
	GraphReadSchema,
	NODE_TITLE_MAX,
	NoteWrittenSchema,
	type OwnedRef,
	splitOwnedRef
} from '@sloppy/types';
import { beforeEach, describe, expect, it } from 'vitest';
import { serveChatCall } from './chat-acts.js';

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

async function wrote(call: ChatToolCall): Promise<OwnedRef> {
	return NoteWrittenSchema.parse(JSON.parse(await answer(call))).note;
}

beforeEach(async () => {
	files = new MemoryFiles({ root: PROJECT, data: '/data' });
	await files.write(PARSER, new TextEncoder().encode('export const one = 1;\n'));
	await containerApi(files).openProject(PROJECT);
});

describe('what a person is told of a reading', () => {
	it('counts the tags here', async () => {
		await wrote(writes(PARSER, [ABOUT_THE_PARSER], { tags: ['reading', 'parsing'] }));

		const done = await serveChatCall(files, { call: 'c2', act: 'list_tags', arguments: {} });

		expect(done.told).toBe('2 tags here.');
		expect(done.touched).toEqual([]);
		expect(done.card).toBeUndefined();
	});

	it('counts what is in the bin, and says plainly when nothing is', async () => {
		const empty = await serveChatCall(files, { call: 'c1', act: 'list_bin', arguments: {} });
		const note = await wrote(writes(PARSER, [ABOUT_THE_PARSER]));
		await answer({ call: 'c2', act: 'delete_note', arguments: { note } });

		const one = await serveChatCall(files, { call: 'c3', act: 'list_bin', arguments: {} });

		expect(empty.told).toBe('Nothing in the bin.');
		expect(one.told).toBe('1 note in the bin.');
	});

	it('says nothing is offered on a note with no offers on it', async () => {
		const note = await wrote(writes(PARSER, [ABOUT_THE_PARSER]));

		const done = await serveChatCall(files, {
			call: 'c2',
			act: 'list_offers',
			arguments: { note }
		});

		expect(done.told).toBe('Nothing offered on it.');
	});

	it('says how many notes stand around a note read with its neighbours', async () => {
		const parser = await wrote(writes(PARSER, [ABOUT_THE_PARSER], { title: 'The parser' }));
		await wrote(writes(PLACES_FILE, [`## Why\n\nIt feeds [the parser](sloppy:${parser}).`]));

		const done = await serveChatCall(files, {
			call: 'c3',
			act: 'read_around',
			arguments: { note: parser, depth: 1 }
		});

		expect(done.told).toBe('1 · The parser, with 1 note around it.');
		expect(done.card).toBeUndefined();
		expect(done.touched).toEqual([]);
	});

	it('says how many notes a brief handed over, and how many around them', async () => {
		await wrote(writes(PARSER, [ABOUT_THE_PARSER], { title: 'The parser' }));

		const done = await serveChatCall(files, {
			call: 'c2',
			act: 'brief',
			arguments: { about: [PARSER], budget: 65536 }
		});
		const asked = await serveChatCall(files, {
			call: 'c3',
			act: 'brief',
			arguments: { budget: 65536 }
		});

		expect(done.told).toBe('1 note briefed, 0 around them.');
		expect(done.card).toBeUndefined();
		expect(asked.told).toBe('Nothing named to brief on.');
	});

	it('names the graph by what it is called', async () => {
		const done = await serveChatCall(files, { call: 'c1', act: 'read_graph', arguments: {} });

		expect(done.told).toBe(GraphReadSchema.parse(JSON.parse(done.said)).name);
	});
});

describe('what a person is told of a note taken back out of the bin', () => {
	it('says what came back with it, and lays the note out', async () => {
		const parser = await wrote(writes(PARSER, [ABOUT_THE_PARSER], { title: 'The parser' }));
		await wrote(writes(PLACES_FILE, ['## Why\n\nIt names places.'], { under: parser }));
		await answer({ call: 'c3', act: 'delete_note', arguments: { note: parser } });

		const done = await serveChatCall(files, {
			call: 'c4',
			act: 'restore_note',
			arguments: { note: parser }
		});

		expect(done.told).toBe('Back out of the bin, with 1 note beneath it.');
		expect(done.card?.heading).toContain('The parser');
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
		expect(rows(done.card)).toMatchObject({ Number: 'None', 'Also at': '1, 7' });
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
