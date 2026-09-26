import type { DocumentingAccess } from '@sloppy/app-core';
import { LocalApi, MemoryFiles, type Files } from '@sloppy/local';
import type { BlockDocument, DocumentingProgress, OwnedRef } from '@sloppy/types';
import { beforeEach, describe, expect, it } from 'vitest';
import { tauriDocumenting, type Lines } from './documenting';

const PROJECT = '/work/compiler';
const PARSER = 'src/parser.ts';

/** What the stand-in tool answered, in the order the acts take them. A string
 *  is what it said; `stopped` is a run somebody ended; an `Error` is one that
 *  could not go on, whose message `src-tauri` hands over as it stands. */
type Answer = string | { stopped: true } | Error;

let store: Map<string, Uint8Array>;
let here: string[];
let answers: Answer[];
let asks: { tool: string; root: string; prompt: string }[];
let stops: number;
/** Held here, a tool is still reading, which is what lets a test ask for a
 *  second thing while the first is underway. */
let gate: Promise<void> | undefined;

function device(): Files {
	return new MemoryFiles({ store, data: '/data' });
}

/** The store the person writes through, which is the app's own identity. */
function theirs(): LocalApi {
	return new LocalApi(device().at(PROJECT));
}

const call = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
	const held = args ?? {};
	switch (command) {
		case 'documenting_tools':
			return here as T;
		case 'documenting_ask': {
			asks.push({
				tool: held.tool as string,
				root: held.root as string,
				prompt: held.prompt as string
			});
			if (gate) await gate;
			const answer = answers.shift();
			if (answer === undefined) throw 'nothing left to answer with';
			if (answer instanceof Error) throw answer.message;
			if (typeof answer !== 'string') return { stopped: true } as T;
			const said = held.said as Lines;
			for (const line of answer.split('\n')) said.onmessage(line);
			return { stopped: false } as T;
		}
		case 'documenting_stop':
			stops += 1;
			return undefined as T;
	}
	throw new Error(`no such command: ${command}`);
};

function documenting(): DocumentingAccess {
	return tauriDocumenting(
		async () => ({ root: PROJECT, files: device() }),
		call,
		() => ({ onmessage: () => {} })
	);
}

/** A section pointing at one file in the project, which is what makes a note
 *  the note about it. */
function about(heading: string, path: string): BlockDocument {
	return {
		type: 'doc',
		content: [
			{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: heading }] },
			{
				type: 'paragraph',
				content: [
					{ type: 'text', text: path, marks: [{ type: 'link', attrs: { href: `code:${path}` } }] }
				]
			}
		]
	};
}

/** A note the person wrote, which a run may only offer a change to. */
async function theirNote(title: string, path: string): Promise<OwnedRef> {
	const api = theirs();
	const note = await api.createNode({ from: { relation: 'free' }, title, tags: [] });
	await api.createBlock({ node: note.ref, content: about('What it does', path) });
	return note.ref;
}

async function sectionsOf(ref: OwnedRef): Promise<BlockDocument[]> {
	return (await theirs().listBlocks(ref)).map((block) => block.content);
}

async function until(held: () => boolean): Promise<void> {
	for (let at = 0; at < 200 && !held(); at++) {
		await new Promise((resolve) => setTimeout(resolve, 1));
	}
	if (!held()) throw new Error('it never happened');
}

beforeEach(async () => {
	store = new Map();
	here = ['claude_code'];
	answers = [];
	asks = [];
	stops = 0;
	gate = undefined;
	await new LocalApi(device()).openProject(PROJECT);
});

describe('the tools this device can reach', () => {
	it('answers only the ones it knows', async () => {
		here = ['claude_code', 'something_else'];

		expect(await documenting().tools()).toEqual(['claude_code']);
	});

	it('answers none where the device has none', async () => {
		here = [];

		expect(await documenting().tools()).toEqual([]);
	});

	it('says what to install where a survey is asked for anyway', async () => {
		here = [];

		await expect(documenting().survey({ said: '' })).rejects.toThrow(
			'Sloppy has nothing on this computer to read the project with. Install Claude Code and try again.'
		);
	});

	it('says which one is missing where somebody chose it', async () => {
		here = [];

		await expect(documenting().survey({ said: '', tool: 'claude_code' })).rejects.toThrow(
			'Claude Code is not on this computer. Install it and try again.'
		);
	});
});

describe('a survey', () => {
	it('proposes the places the tool read, in the project it is about', async () => {
		answers = ['{"places":[{"path":"src/parser.ts","reason":"The reader."}]}'];

		const places = await documenting().survey({ said: 'Say what the reader does' });

		expect(places).toEqual([{ path: 'src/parser.ts', reason: 'The reader.' }]);
		expect(asks[0].root).toBe(PROJECT);
		expect(asks[0].prompt).toContain('Say what the reader does');
		expect(asks[0].prompt).toContain('.sloppy/AGENT.md');
	});

	it('reads an answer the tool wrapped in a fence', async () => {
		answers = ['Here is what I found:\n\n```json\n{"places":[{"path":"src"}]}\n```\n'];

		expect(await documenting().survey({ said: '' })).toEqual([{ path: 'src' }]);
	});

	it('names the note a place already has', async () => {
		const note = await theirNote('The reader', PARSER);
		answers = [`{"places":[{"path":"${PARSER}","reason":"It has moved."}]}`];

		const places = await documenting().survey({ said: '' });

		expect(places).toEqual([{ path: PARSER, reason: 'It has moved.', note }]);
	});

	it('tells the tool what already has a note', async () => {
		await theirNote('The reader', PARSER);
		answers = ['{"places":[]}'];

		await documenting().survey({ said: '' });

		expect(asks[0].prompt).toContain(`- ${PARSER}`);
	});

	it('proposes each place once', async () => {
		answers = ['{"places":[{"path":"src"},{"path":"src","reason":"again"},{"path":"docs"}]}'];

		expect(await documenting().survey({ said: '' })).toEqual([{ path: 'src' }, { path: 'docs' }]);
	});

	it('refuses a place that is not in this project', async () => {
		answers = ['{"places":[{"path":"../elsewhere/secrets.ts"}]}'];

		await expect(documenting().survey({ said: '' })).rejects.toThrow(
			'That place is outside this project.'
		);
	});

	it('refuses an answer it cannot read rather than proposing none', async () => {
		answers = ['I had a look but I would rather not.'];

		await expect(documenting().survey({ said: '' })).rejects.toThrow(
			'Sloppy could not read what came back.'
		);
	});

	it('proposes none where somebody stopped it', async () => {
		answers = [{ stopped: true }];

		expect(await documenting().survey({ said: '' })).toEqual([]);
	});

	it('hands on what the tool said about its own trouble', async () => {
		answers = [new Error('Sign in to keep going.')];

		await expect(documenting().survey({ said: '' })).rejects.toThrow('Sign in to keep going.');
	});
});

describe('a run', () => {
	const said = (title: string, body: string) =>
		JSON.stringify({ title, sections: [`## What it does\n\n${body}`] });

	it('writes a note where the place has none', async () => {
		answers = [said('The reader', `It reads [${PARSER}](code:${PARSER}).`)];
		const told: DocumentingProgress[] = [];

		const done = await documenting().run(
			{ intent: { said: '' }, places: [{ path: PARSER }] },
			(progress) => told.push(progress)
		);

		expect(done.stage).toBe('done');
		expect(done.places).toEqual([
			{ path: PARSER, note: { ref: expect.any(String), done: 'written' } }
		]);
		const note = await theirs().getNode(done.places[0].note!.ref);
		expect(note?.title).toBe('The reader');
		expect(told.map((one) => one.stage)).toEqual(['reading', 'writing', 'done']);
		expect(told[1].at).toBe(PARSER);
		expect(told[2].at).toBeUndefined();
	});

	it('offers a change rather than writing over what a person wrote', async () => {
		const note = await theirNote('The reader', PARSER);
		answers = [said('The reader', 'It reads a file and hands back the sections.')];

		const done = await documenting().run(
			{ intent: { said: '' }, places: [{ path: PARSER, note }] },
			() => {}
		);

		expect(done.places).toEqual([{ path: PARSER, note: { ref: note, done: 'offered' } }]);
		const sections = await sectionsOf(note);
		expect(JSON.stringify(sections)).not.toContain('hands back the sections');
	});

	it('shows the tool the note that is already there', async () => {
		const note = await theirNote('The reader', PARSER);
		answers = [said('The reader', 'Now it does more.')];

		await documenting().run({ intent: { said: '' }, places: [{ path: PARSER, note }] }, () => {});

		expect(asks[0].prompt).toContain('There is already a note here, titled "The reader"');
		expect(asks[0].prompt).toContain('## What it does');
	});

	it('finds the note about a place the person added themselves', async () => {
		const note = await theirNote('The reader', PARSER);
		answers = [said('The reader', 'Now it does more.')];

		const done = await documenting().run(
			{ intent: { said: '' }, places: [{ path: PARSER }] },
			() => {}
		);

		expect(done.places[0].note?.ref).toBe(note);
	});

	it('leaves nothing at a place the tool had nothing to say about', async () => {
		answers = ['{"sections":[]}'];

		const done = await documenting().run(
			{ intent: { said: '' }, places: [{ path: PARSER }] },
			() => {}
		);

		expect(done).toEqual({ stage: 'done', places: [{ path: PARSER }] });
	});

	it('writes each place in the order the plan stands in', async () => {
		answers = [said('One', 'a'), said('Two', 'b')];

		const done = await documenting().run(
			{ intent: { said: '' }, places: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }] },
			() => {}
		);

		expect(done.places.map((one) => one.path)).toEqual(['src/a.ts', 'src/b.ts']);
		expect(asks.map((one) => one.prompt.includes('Write the note about: src/a.ts'))).toEqual([
			true,
			false
		]);
	});

	it('keeps what it wrote where a place could not be written about', async () => {
		answers = [said('One', 'a'), new Error('Sign in to keep going.')];

		const done = await documenting().run(
			{ intent: { said: '' }, places: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }] },
			() => {}
		);

		expect(done.stage).toBe('stopped');
		expect(done.trouble).toBe('Sign in to keep going.');
		expect(done.places.map((one) => one.path)).toEqual(['src/a.ts']);
	});

	it('says nothing about why where somebody stopped it', async () => {
		answers = [said('One', 'a'), { stopped: true }];

		const done = await documenting().run(
			{ intent: { said: '' }, places: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }] },
			() => {}
		);

		expect(done.stage).toBe('stopped');
		expect(done.trouble).toBeUndefined();
		expect(done.places.map((one) => one.path)).toEqual(['src/a.ts']);
	});

	it('refuses a plan naming a place twice rather than writing two notes', async () => {
		await expect(
			documenting().run(
				{ intent: { said: '' }, places: [{ path: PARSER }, { path: PARSER }] },
				() => {}
			)
		).rejects.toThrow('That list names a place twice.');
		expect(asks).toEqual([]);
	});

	it('writes a new note under the one about the folder it is in', async () => {
		const over = await theirNote('The compiler', 'src');
		answers = [said('The reader', 'It reads.')];

		const done = await documenting().run(
			{ intent: { said: '' }, places: [{ path: PARSER }] },
			() => {}
		);

		const note = await theirs().getNode(done.places[0].note!.ref);
		expect(note?.parent).toBe(over);
	});

	it("writes a new note under the one this project's notes hang under", async () => {
		const top = await theirNote('The compiler', 'README.md');
		answers = [said('The reader', 'It reads.')];

		const done = await documenting().run(
			{ intent: { said: '' }, places: [{ path: PARSER }] },
			() => {}
		);

		const note = await theirs().getNode(done.places[0].note!.ref);
		expect(note?.parent).toBe(top);
	});

	it('opens a branch where two branches of notes already point at code', async () => {
		await theirNote('The compiler', 'README.md');
		await theirNote('The garden', 'docs/garden.md');
		answers = [said('The reader', 'It reads.')];

		const done = await documenting().run(
			{ intent: { said: '' }, places: [{ path: PARSER }] },
			() => {}
		);

		const note = await theirs().getNode(done.places[0].note!.ref);
		expect(note?.parent).toBeUndefined();
	});

	/** A note that is there keeps its title, so the answer shape does not ask
	 *  for one the write would drop. */
	it('asks a note that is already there for its sections and not its title', async () => {
		const note = await theirNote('The reader', PARSER);
		answers = [said('The reader', 'Now it does more.')];

		await documenting().run({ intent: { said: '' }, places: [{ path: PARSER, note }] }, () => {});

		expect(asks[0].prompt).toContain('{"sections":');
		expect(asks[0].prompt).not.toContain('"title"');
	});
});

describe('one thing at a time', () => {
	it('refuses a second act while one is underway', async () => {
		const access = documenting();
		answers = ['{"places":[]}'];
		let letGo!: () => void;
		gate = new Promise<void>((resolve) => (letGo = resolve));

		const one = access.survey({ said: 'first' });
		await until(() => asks.length === 1);
		await expect(access.survey({ said: 'second' })).rejects.toThrow(
			'Sloppy is already reading this project.'
		);

		letGo();
		expect(await one).toEqual([]);
	});

	it('lets another be asked for the moment a stop resolves', async () => {
		const access = documenting();
		answers = [{ stopped: true }, '{"places":[]}'];
		let letGo!: () => void;
		gate = new Promise<void>((resolve) => (letGo = resolve));

		const one = access.survey({ said: 'first' });
		await until(() => asks.length === 1);
		const stopping = access.stop();
		letGo();
		await stopping;

		expect(stops).toBe(1);
		expect(await one).toEqual([]);
		expect(await access.survey({ said: 'second' })).toEqual([]);
	});

	it('is not a failure where nothing is underway', async () => {
		await documenting().stop();

		expect(stops).toBe(0);
	});

	it('ends a run between places rather than starting the next', async () => {
		const access = documenting();
		answers = [
			JSON.stringify({ title: 'One', sections: ['## What it does\n\na'] }),
			JSON.stringify({ title: 'Two', sections: ['## What it does\n\nb'] })
		];
		let done: DocumentingProgress | undefined;
		const running = access
			.run(
				{ intent: { said: '' }, places: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }] },
				(progress) => {
					if (progress.at === 'src/b.ts') void access.stop();
				}
			)
			.then((progress) => (done = progress));

		await running;

		expect(done?.stage).toBe('stopped');
		expect(done?.places.map((one) => one.path)).toEqual(['src/a.ts']);
		expect(asks).toHaveLength(1);
	});

	/** A stop that lands while a run is reading the notes for a place must not
	 *  pay for that place's tool anyway. */
	it('starts nothing for the place it was stopped on', async () => {
		const access = documenting();
		answers = [JSON.stringify({ title: 'One', sections: ['## What it does\n\na'] })];
		let done: DocumentingProgress | undefined;

		await access
			.run(
				{ intent: { said: '' }, places: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }] },
				(progress) => {
					if (progress.at === 'src/a.ts') void access.stop();
				}
			)
			.then((progress) => (done = progress));

		expect(done?.stage).toBe('stopped');
		expect(done?.places).toEqual([]);
		expect(asks).toEqual([]);
	});
});
