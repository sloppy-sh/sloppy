// The chats a device holds: one kept per thread, picked up again on another
// run, each writing into a draft of its own, and each reading the places the
// person added to it. docs/ARCHITECTURE.md § "Asking a tool to write the
// notes".

import 'fake-indexeddb/auto';
import { DeviceThreads, MemoryFiles, MemoryHistory } from '@sloppy/local';
import {
	draftBranch,
	MAX_TURNS_PER_SESSION,
	MOST_PLACES,
	ulid,
	type ChatActDone,
	type ChatAgent,
	type ChatEvent,
	type ChatToolAnswer,
	type ChatThread,
	type ChatToolCall,
	type ChatTurn,
	type ContextUsage,
	type OwnedRef,
	type StandingDraft,
	type Ulid
} from '@sloppy/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initRuntime, type ChatAccess, type ChatAsked } from '../runtime.js';
import { seamSettledAgain } from '../seam.svelte.js';
import { chat } from './chat.svelte.js';
import { chatDraft } from './chat-draft.svelte.js';
import { ref } from './fake-api.test-support.js';
import { prefs } from './prefs.svelte.js';
import { whatHappened } from './what-happened.svelte.js';

const ROOT = '/work/compiler';
const COPIES = '/data/drafts';
const PLACE = '/work/lexer';
/** A second folder whose own name is the first's, which is what two projects
 *  holding a `lexer` looks like. */
const ALSO = '/work/old/lexer';
const ELSEWHERE = '/somebody/else';

/** Which folder each of Sloppy's own acts was served against, newest last, and
 *  whether it was served by the store that only reads one. */
const served = vi.hoisted(() => ({ roots: [] as string[], reading: [] as boolean[] }));

vi.mock('../chat-acts.js', () => ({
	serveChatCall: (files: { root: string }, _call: unknown, reading = false) => {
		served.roots.push(files.root);
		served.reading.push(reading);
		return Promise.resolve({ said: '{}', touched: [] } as ChatActDone);
	}
}));

let store: Map<string, Uint8Array>;

function folder(): MemoryFiles {
	return new MemoryFiles({ root: ROOT, store, data: '/data' });
}

/** The platform's half of the drafts: one copy per thread, each with a history
 *  of its own whose first version is the folder as the draft found it. */
const copies = new Map<Ulid, { draft: StandingDraft; history: MemoryHistory }>();
const discarded: Ulid[] = [];

function copyFiles(id: Ulid): MemoryFiles {
	return new MemoryFiles({ root: `${COPIES}/${id}`, store, data: '/data' });
}

const drafts = {
	standing: async () => [...copies.values()].map((one) => one.draft),
	start: async (id: Ulid) => {
		const held = copies.get(id);
		if (held) return held.draft;
		const root = `${COPIES}/${id}`;
		const history = new MemoryHistory(copyFiles(id), { author: 'Ada' });
		const began = await history.commit('The notes as the draft found them');
		copies.set(id, {
			draft: { id, root, vault: root, branch: draftBranch(id), from: began?.id ?? 'v0' },
			history
		});
		return copies.get(id)?.draft as StandingDraft;
	},
	discard: async (draft: StandingDraft) => {
		discarded.push(draft.id);
		copies.delete(draft.id);
	},
	files: (draft: StandingDraft) => copyFiles(draft.id),
	history: (draft: StandingDraft) => {
		const held = copies.get(draft.id);
		if (!held) throw new Error('no draft');
		return held.history;
	}
};

/** The agent, as the shell carries one: what it was asked for, and the two
 *  channels back into the page. */
class Stub implements ChatAccess {
	asked: ChatAsked[] = [];
	closed = 0;
	detail: ('summary' | 'full')[] = [];
	/** The session the agent answers with, which is the one it was asked for
	 *  unless this says otherwise. */
	answersAs: string | null = null;
	said: string[] = [];
	#hear: ((event: ChatEvent) => void) | null = null;
	#serve: ((call: ChatToolCall) => Promise<ChatToolAnswer>) | null = null;

	readonly drafts = drafts;

	/** The agents this device reaches, which is one until a test gives it the
	 *  second a conversation can be moved to. */
	offers: ChatAgent[] = ['claude_code'];

	agents(): Promise<ChatAgent[]> {
		return Promise.resolve([...this.offers]);
	}

	open(
		asked: ChatAsked,
		hear: (event: ChatEvent) => void,
		serve: (call: ChatToolCall) => Promise<ChatToolAnswer>
	): Promise<void> {
		this.asked.push(asked);
		this.#hear = hear;
		this.#serve = serve;
		return Promise.resolve();
	}

	say(said: string): Promise<void> {
		this.said.push(said);
		return Promise.resolve();
	}

	stop(): Promise<void> {
		return Promise.resolve();
	}

	close(): Promise<void> {
		this.closed += 1;
		return Promise.resolve();
	}

	context(detail: 'summary' | 'full'): Promise<void> {
		this.detail.push(detail);
		return Promise.resolve();
	}

	/** The agent saying what it is, which is the first thing a turn hears. */
	begins(): void {
		const last = this.asked.at(-1);
		this.#hear?.({
			event: 'started',
			session: this.answersAs ?? last?.thread.session ?? `s-${this.asked.length}`,
			model: 'opus',
			tools: ['write_note']
		});
	}

	tell(event: ChatEvent): void {
		this.#hear?.(event);
	}

	serve(call: ChatToolCall): Promise<ChatToolAnswer> {
		if (!this.#serve) throw new Error('nothing is serving');
		return this.#serve(call);
	}
}

let stub: Stub;
let graph: OwnedRef;

function shell(): void {
	initRuntime({
		apiHost: () => 'http://api.test',
		mode: () => 'local',
		chat: stub,
		threads: new DeviceThreads(folder()),
		project: async () => folder(),
		// A shell serves only the folders somebody picked; here that is /work.
		placeFiles: (root) => (root.startsWith('/work/') ? folder().at(root) : undefined)
	});
	seamSettledAgain();
}

/** What somebody says, the agent saying which conversation answered, the answer
 *  itself, and the turn ending — which is where a thread is kept. The words of
 *  a turn that opens a session wait on the agent saying what it is, so a test
 *  cannot say the one before the other. */
async function aTurn(words: string): Promise<void> {
	const saying = chat.say(words);
	await settled();
	stub.begins();
	await saying;
	stub.tell({ event: 'block', at: 0, block: { kind: 'said', said: 'Noted.' } });
	stub.tell({ event: 'ended', spent: { sent: 100, answered: 20 } });
	await settled();
}

/** Another turn in the session already standing, which says what it is once
 *  and not again — so a test can tell what reaches a standing conversation
 *  apart from what reaches one beginning. */
async function another(words: string): Promise<void> {
	await chat.say(words);
	stub.tell({ event: 'ended' });
	await settled();
}

/** The chat being read let go of and read again, which is how the agent comes
 *  to be going on from its own conversation rather than one Sloppy opened. */
async function pickedUpAgain(): Promise<Ulid> {
	const id = chat.current?.id as Ulid;
	await chat.startThread();
	await chat.openThread(id);
	return id;
}

/** The thread is kept without anybody waiting on it, so this is how a test
 *  reads what was kept. */
async function settled(): Promise<void> {
	for (let turn = 0; turn < 20; turn += 1) await new Promise((wake) => setTimeout(wake));
}

async function kept(): Promise<DeviceThreads> {
	return new DeviceThreads(folder());
}

const FULL: ContextUsage = {
	total: 30,
	limit: 100,
	compactsAt: 80,
	at: '2026-10-06T10:00:00.000Z',
	parts: [
		{ name: 'System prompt', tokens: 10, kind: 'used' },
		{ name: 'Messages', tokens: 20, kind: 'used' },
		{ name: 'Free space', tokens: 55, kind: 'free' },
		{ name: 'Deferred tools', tokens: 400, kind: 'deferred' }
	]
};

beforeEach(async () => {
	localStorage.clear();
	prefs.init();
	whatHappened.clear();
	store = new Map();
	copies.clear();
	discarded.length = 0;
	served.roots.length = 0;
	served.reading.length = 0;
	stub = new Stub();
	chat.clear();
	chatDraft.clear();
	shell();
	graph = ref(1);
	await chat.opened(graph);
	await chat.lookForAgents();
});

afterEach(() => {
	chat.clear();
	chatDraft.clear();
	initRuntime({
		apiHost: () => '',
		mode: () => 'hosted',
		chat: undefined,
		threads: undefined,
		project: undefined,
		placeFiles: undefined
	});
	seamSettledAgain();
	localStorage.clear();
});

describe('a chat this device keeps', () => {
	it('takes an id and its name from the first thing said', async () => {
		expect(chat.current).toBe(null);

		await aTurn('Why is the parser two passes?\nAnd the lexer?');

		expect(chat.current?.name).toBe('Why is the parser two passes?');
		expect(chat.threads.map((one) => one.id)).toEqual([chat.current?.id]);
		expect((await (await kept()).list()).map((one) => one.name)).toEqual([
			'Why is the parser two passes?'
		]);
	});

	it('keeps the name a person gave it, where its first turn never landed', async () => {
		await aTurn('Why two passes?');
		const id = chat.current?.id as Ulid;
		await chat.rename('How the parser reads a note');
		// A turn whose end never arrived wrote nothing down, so what another run
		// finds is a named chat with nothing said in it.
		await (await kept()).write({ ...(chat.current as ChatThread), turns: [] });
		chat.clear();
		chatDraft.clear();
		await chat.opened(graph);

		const saying = chat.say('And the lexer?');
		await settled();
		stub.begins();
		await saying;

		expect(chat.current?.id).toBe(id);
		expect(chat.current?.name).toBe('How the parser reads a note');
		expect((await (await kept()).list()).map((one) => one.name)).toEqual([
			'How the parser reads a note'
		]);
	});

	it('keeps what was said and what it spent, and is picked up again on another run', async () => {
		await aTurn('Why two passes?');
		const id = chat.current?.id;

		// What another run of the app finds: nothing in memory, everything on
		// the device.
		chat.clear();
		chatDraft.clear();
		await chat.opened(graph);

		expect(chat.current?.id).toBe(id);
		expect(chat.turns.map((one) => one.from)).toEqual(['person', 'agent']);
		expect(chat.spent.session).toEqual({ sent: 100, answered: 20 });
		expect(chat.current?.session).toBe('s-1');
	});

	it('is the newest of several, and begins another that is kept beside it', async () => {
		await aTurn('About the parser');
		const first = chat.current?.id;
		chat.startThread();
		expect(chat.current).toBe(null);
		expect(chat.turns).toEqual([]);
		await aTurn('About the lexer');
		const second = chat.current?.id;

		expect(chat.threads.map((one) => one.id)).toEqual([second, first]);
		expect(await (await kept()).list()).toHaveLength(2);
	});

	it('is written down the first time something is said, and not for a file put in front of it', async () => {
		expect(await chat.attach([new File(['a picture'], 'the board.png')])).toBe(null);

		// Somewhere for the file to land, and nothing on the device yet.
		expect(chat.current).not.toBe(null);
		expect(chat.threads).toEqual([]);
		expect(await (await kept()).list()).toEqual([]);

		await aTurn('What is this?');

		expect((await (await kept()).list()).map((one) => one.id)).toEqual([chat.current?.id]);
	});

	it('takes the draft of a chat nothing was said in away with it', async () => {
		await chat.attach([new File(['a picture'], 'the board.png')]);
		const id = chat.current?.id as Ulid;
		expect(copies.has(id)).toBe(true);

		await chat.startThread();

		expect(discarded).toEqual([id]);
		expect(await (await kept()).list()).toEqual([]);
	});

	it('lets its oldest turns go past the bound, in what is read, kept and copied alike', async () => {
		await aTurn('The first thing');
		const id = chat.current?.id as Ulid;
		const many: ChatTurn[] = Array.from({ length: MAX_TURNS_PER_SESSION }, (_, at) => ({
			from: 'person',
			blocks: [{ kind: 'said', said: `turn ${at}` }],
			at: '2026-10-06T10:00:00.000Z'
		}));
		await (await kept()).write({ ...(chat.current as ChatThread), turns: many });
		chat.clear();
		chatDraft.clear();
		await chat.opened(graph);

		await aTurn('The last thing');

		const copied = chat.copyAsMarkdown();
		const held = (await (await kept()).read(id))?.turns ?? [];
		expect(chat.turns).toHaveLength(MAX_TURNS_PER_SESSION);
		expect(held).toEqual(chat.turns);
		expect(copied).toContain('The last thing');
		expect(copied).toContain('turn 511');
		expect(copied).not.toContain('turn 0\n');
		expect(copied).not.toContain('turn 1\n');
	});

	it('is not begun again while the agent is answering', async () => {
		const saying = chat.say('Why two passes?');
		await settled();
		const id = chat.current?.id;

		await chat.startThread();

		expect(chat.current?.id).toBe(id);
		expect(chat.trouble).toBe('The assistant is still answering. Stop it first.');
		stub.begins();
		await saying;
	});

	it('is called something else where a person says so, and Untitled where they say nothing', async () => {
		await aTurn('About the parser');

		await chat.rename('  Two passes, and why  ');
		expect(chat.current?.name).toBe('Two passes, and why');

		await chat.rename('');
		expect(chat.current?.name).toBe('Untitled');
		expect((await (await kept()).read(chat.current?.id ?? ''))?.name).toBe('Untitled');
	});

	it('is read again with the turns it was left with, and never while the agent is answering', async () => {
		await aTurn('About the parser');
		const first = chat.current?.id as Ulid;
		chat.startThread();
		await aTurn('About the lexer');
		const second = chat.current?.id as Ulid;

		await chat.openThread(first);
		expect(chat.current?.id).toBe(first);
		expect(chat.turns.some((turn) => JSON.stringify(turn).includes('About the parser'))).toBe(true);

		const saying = chat.say('And the emitter?');
		await settled();
		expect(chat.running).toBe(true);
		await chat.openThread(second);
		expect(chat.current?.id).toBe(first);
		expect(chat.trouble).toBe('The assistant is still answering. Stop it first.');
		stub.begins();
		await saying;
	});
});

describe('a chat put aside', () => {
	it('goes under its own heading, and the one before it is read instead', async () => {
		await aTurn('About the parser');
		const first = chat.current?.id;
		chat.startThread();
		await aTurn('About the lexer');
		const second = chat.current?.id as Ulid;

		const closed = stub.closed;
		await chat.archive();

		expect(chat.archived.map((one) => one.id)).toEqual([second]);
		expect(chat.threads.map((one) => one.id)).toEqual([first]);
		expect(chat.current?.id).toBe(first);
		// The session ran for the chat that was put aside, so it went with it.
		expect(stub.closed).toBe(closed + 1);
	});

	it('comes back out when somebody asks', async () => {
		await aTurn('About the parser');
		const id = chat.current?.id as Ulid;
		await chat.archive();
		expect(chat.threads).toEqual([]);

		await chat.putBack(id);

		expect(chat.archived).toEqual([]);
		expect(chat.threads.map((one) => one.id)).toEqual([id]);
		expect((await (await kept()).read(id))?.archived_at).toBeUndefined();
	});
});

describe('deleting a chat', () => {
	/** A chat with something written into its draft. */
	async function wroteSomething(): Promise<Ulid> {
		await chat.say('Write about the parser');
		await stub.serve({
			call: 'c1',
			act: 'write_note',
			arguments: { about: 'src/parse.ts', sections: [] }
		} as ChatToolCall);
		stub.begins();
		stub.tell({ event: 'ended' });
		await settled();
		return chat.current?.id as Ulid;
	}

	it('throws its draft away with it where that is the answer', async () => {
		const id = await wroteSomething();
		expect(copies.has(id)).toBe(true);

		expect(await chat.remove(id, 'discard')).toBe(true);

		expect(discarded).toEqual([id]);
		expect(chat.threads).toEqual([]);
		expect(chat.current).toBe(null);
		expect(await (await kept()).read(id)).toBeUndefined();
	});

	it('leaves the thread standing over its own draft where the draft could not go', async () => {
		const id = await wroteSomething();
		const refuses = vi.spyOn(drafts, 'discard').mockRejectedValue(new Error('no'));
		try {
			expect(await chat.remove(id, 'discard')).toBe(false);
		} finally {
			refuses.mockRestore();
		}

		// Neither half went, so nothing is left that nothing points at.
		expect(copies.has(id)).toBe(true);
		expect(chat.threads.map((one) => one.id)).toEqual([id]);
		expect(await (await kept()).read(id)).not.toBeUndefined();
	});

	it('reads the one before it afterwards', async () => {
		await aTurn('About the parser');
		const first = chat.current?.id;
		chat.startThread();
		await aTurn('About the lexer');
		const second = chat.current?.id as Ulid;

		expect(await chat.remove(second, 'discard')).toBe(true);

		expect(chat.current?.id).toBe(first);
		expect(chat.threads.map((one) => one.id)).toEqual([first]);
	});

	it('is not done to any chat\u2019s draft while a turn is writing into one', async () => {
		const id = await wroteSomething();
		chat.startThread();
		await chat.say('About the lexer');

		expect(await chat.remove(id, 'discard')).toBe(false);
		expect(chat.trouble).toBe('The assistant is still answering. Stop it first.');
		expect(discarded).toEqual([]);
		expect(chat.threads.map((one) => one.id)).toContain(id);
	});

	it('says nothing is there for a chat this device does not hold', async () => {
		expect(await chat.remove(ulid(), 'discard')).toBe(false);
		expect(chat.trouble).toBe("That thread isn't here any more.");
	});

	it('leaves the chat being read with its own draft in hand', async () => {
		const first = await wroteSomething();
		chat.startThread();
		const second = await wroteSomething();
		expect(chatDraft.standing?.id).toBe(second);

		expect(await chat.remove(first, 'discard')).toBe(true);

		expect(discarded).toEqual([first]);
		expect(chatDraft.standing?.id).toBe(second);
		expect(chat.current?.id).toBe(second);
	});

	it('leaves it with its own draft in hand where the delete was refused too', async () => {
		const first = await wroteSomething();
		chat.startThread();
		const second = await wroteSomething();

		const refuses = vi.spyOn(drafts, 'discard').mockRejectedValue(new Error('no'));
		try {
			expect(await chat.remove(first, 'discard')).toBe(false);
		} finally {
			refuses.mockRestore();
		}

		// Which is what the next thing they throw away is thrown away from.
		expect(chatDraft.standing?.id).toBe(second);
		expect(chat.current?.id).toBe(second);
		expect(chat.threads.map((one) => one.id)).toEqual([second, first]);
	});
});

describe('the places a chat reads besides its own project', () => {
	it('is given to the agent with the chat it opened for', async () => {
		await chat.addPlace({ root: PLACE, name: 'lexer' });
		await aTurn('What does the lexer do?');

		const asked = stub.asked.at(-1);
		expect(asked?.thread.id).toBe(chat.current?.id);
		expect(asked?.thread.places).toEqual([{ root: PLACE, name: 'lexer' }]);
		expect(chat.current?.places).toEqual([{ root: PLACE, name: 'lexer' }]);
	});

	it('is refused for a folder this device will not read', async () => {
		await chat.addPlace({ root: ELSEWHERE, name: 'theirs' });

		expect(chat.places).toEqual([]);
		expect(chat.trouble).toBe('Sloppy cannot read that folder from here. Choose another.');
	});

	it('is not added twice', async () => {
		await chat.addPlace({ root: PLACE, name: 'lexer' });
		await chat.addPlace({ root: PLACE, name: 'again' });
		expect(chat.places).toEqual([{ root: PLACE, name: 'lexer' }]);

		await chat.removePlace(PLACE);
		expect(chat.places).toEqual([]);
	});

	it('stops at the most one chat reads, and says so', async () => {
		for (let at = 0; at <= MOST_PLACES; at += 1)
			await chat.addPlace({ root: `/work/p${at}`, name: `p${at}` });

		expect(chat.places).toHaveLength(MOST_PLACES);
		expect(chat.places.map((one) => one.root)).not.toContain(`/work/p${MOST_PLACES}`);
		expect(chat.trouble).toBe(`A thread reads ${MOST_PLACES} places besides its own project.`);
	});

	it('is held apart from a place already called the same thing', async () => {
		await chat.addPlace({ root: PLACE, name: 'lexer', graph: ref(2) });
		await chat.addPlace({ root: ALSO, name: 'lexer', graph: ref(3) });

		expect(chat.places).toEqual([
			{ root: PLACE, name: 'lexer', graph: ref(2) },
			{ root: ALSO, name: 'old/lexer', graph: ref(3) }
		]);

		// Which is the whole of the point: each name reaches its own folder.
		await chat.say('What did the old lexer do?');
		stub.begins();
		await stub.serve({
			call: 'c1',
			act: 'list_notes',
			arguments: { in: 'old/lexer' }
		} as ChatToolCall);
		await stub.serve({ call: 'c2', act: 'list_notes', arguments: { in: 'lexer' } } as ChatToolCall);

		expect(served.roots).toEqual([ALSO, PLACE]);
	});

	it('leaves the chat readable where the folder it names is called something far too long', async () => {
		await aTurn('Why two passes?');
		const id = chat.current?.id as Ulid;

		await chat.addPlace({
			root: PLACE,
			name: 'The lexer, and every reason it was written the way it was. '.repeat(10)
		});

		chat.clear();
		chatDraft.clear();
		await chat.opened(graph);

		expect(chat.current?.id).toBe(id);
		expect(chat.places.map((one) => one.root)).toEqual([PLACE]);
	});

	it('is not changed while the agent is answering', async () => {
		await chat.say('What does the parser do?');

		await chat.addPlace({ root: PLACE, name: 'lexer' });

		expect(chat.places).toEqual([]);
		expect(chat.trouble).toBe('The assistant is still answering. Stop it first.');
	});

	it('is not named in the words to a conversation the brief opened, which carries it already', async () => {
		await chat.addPlace({ root: PLACE, name: 'lexer' });

		await aTurn('What does the lexer do?');

		expect(stub.asked.at(-1)?.thread.places).toEqual([{ root: PLACE, name: 'lexer' }]);
		expect(stub.said.at(-1)).toBe('What does the lexer do?');
	});

	it('is named in the words to one the brief never reached, once, until it begins again', async () => {
		await chat.addPlace({ root: PLACE, name: 'lexer' });
		await aTurn('What does the lexer do?');
		const id = await pickedUpAgain();

		await aTurn('And the parser?');
		expect(stub.said.at(-1)).toContain('Places you may also read, by name: lexer.');

		await another('And the emitter?');
		expect(stub.said.at(-1)).toBe('And the emitter?');

		// Summarised and begun again, so what it was told went with the rest.
		stub.begins();
		await another('And the printer?');
		expect(stub.said.at(-1)).toContain('Places you may also read, by name: lexer.');
		expect(id).toBe(chat.current?.id);
	});

	it('is not named to a conversation with none to name', async () => {
		await chat.addPlace({ root: PLACE, name: 'lexer' });
		await aTurn('What does the lexer do?');
		await pickedUpAgain();
		await chat.removePlace(PLACE);

		await aTurn('And the parser?');

		expect(stub.said.at(-1)).toBe('And the parser?');
	});

	it('picks the conversation up again when it changes under a standing one', async () => {
		await aTurn('What does the parser do?');
		expect(stub.closed).toBe(0);

		await chat.addPlace({ root: PLACE, name: 'lexer' });

		expect(stub.closed).toBe(1);
		expect(chat.says).toBe(
			'The next thing you say starts the assistant again, so it can read what you changed.'
		);
		await aTurn('And the lexer?');
		expect(stub.asked.at(-1)?.thread.places).toEqual([{ root: PLACE, name: 'lexer' }]);
	});
});

describe('where one of Sloppy’s own acts is served', () => {
	beforeEach(async () => {
		await chat.addPlace({ root: PLACE, name: 'lexer', graph: ref(2) });
		await chat.addPlace({ root: ALSO, name: 'just files' });
		await chat.say('Read the notes');
		stub.begins();
	});

	it('is this chat’s own draft where the act names no place, and is written in', async () => {
		await stub.serve({ call: 'c1', act: 'list_notes', arguments: {} } as ChatToolCall);

		expect(served.roots).toEqual([`${COPIES}/${chat.current?.id}`]);
		expect(served.reading).toEqual([false]);
	});

	it('is the place where a reading act names one, by a store that only reads it', async () => {
		await stub.serve({
			call: 'c2',
			act: 'list_notes',
			arguments: { in: 'lexer' }
		} as ChatToolCall);

		expect(served.roots).toEqual([PLACE]);
		expect(served.reading).toEqual([true]);
	});

	it('is the draft for a writing act whatever it names', async () => {
		await stub.serve({
			call: 'c3',
			act: 'write_note',
			arguments: { about: 'src/parse.ts', sections: [], in: 'lexer' }
		} as ChatToolCall);

		expect(served.roots).toEqual([`${COPIES}/${chat.current?.id}`]);
		expect(served.reading).toEqual([false]);
	});

	it('is nowhere for a place this chat does not read, and the agent is told so', async () => {
		await expect(
			stub.serve({
				call: 'c4',
				act: 'read_note',
				arguments: { note: ref(2), in: 'runtime' }
			} as ChatToolCall)
		).resolves.toMatchObject({
			said: expect.stringContaining('There is no place here by that name'),
			trouble: true
		});
		expect(served.roots).toEqual([]);
	});

	it('is nowhere for a place that holds no notes, so nothing starts a graph in it', async () => {
		await expect(
			stub.serve({
				call: 'c5',
				act: 'list_notes',
				arguments: { in: 'just files' }
			} as ChatToolCall)
		).resolves.toMatchObject({
			said: expect.stringContaining('There are no notes in that place'),
			trouble: true
		});
		expect(served.roots).toEqual([]);
	});
});

describe('how full the window is', () => {
	it('is what the agent said, with what is held aside kept out of the bar', async () => {
		await chat.say('Why two passes?');
		stub.begins();

		stub.tell({ event: 'context', usage: FULL });

		expect(chat.context?.total).toBe(30);
		expect(chat.context?.limit).toBe(100);
		expect(chat.context?.parts).toEqual(FULL.parts);
	});

	it('follows the fill between breakdowns, keeping the last one standing', async () => {
		await chat.say('Why two passes?');
		stub.begins();
		stub.tell({ event: 'context', usage: FULL });

		stub.tell({
			event: 'context',
			usage: { total: 44, limit: 100, at: '2026-10-06T10:05:00.000Z', parts: [] }
		});

		expect(chat.context?.total).toBe(44);
		expect(chat.context?.parts).toEqual(FULL.parts);
	});

	it('is asked for on the same channel the agent answers everything on', async () => {
		await chat.askContext('full');
		expect(stub.detail).toEqual([]);

		await chat.say('Why two passes?');
		stub.begins();
		await chat.askContext('full');

		expect(stub.detail).toEqual(['full']);
		expect(chat.asksContext).toBe(true);
	});

	it('is nothing again once the session it was said about is gone', async () => {
		await aTurn('Why two passes?');
		stub.tell({ event: 'context', usage: FULL });
		expect(chat.context).not.toBe(null);

		chat.startThread();

		expect(chat.context).toBe(null);
	});
});

describe('picking a chat up where it was left', () => {
	it('asks the agent for the session it was opened as', async () => {
		await aTurn('Why two passes?');
		const id = chat.current?.id as Ulid;
		chat.startThread();

		await chat.openThread(id);
		const saying = chat.say('And the lexer?');
		await settled();
		stub.begins();
		await saying;

		expect(stub.asked.at(-1)?.thread.session).toBe('s-1');
		// The conversation is the agent's own, so nothing is handed to it again.
		expect(stub.said.at(-1)).toBe('And the lexer?');
	});

	it('says so, and hands over what was said with the words that opened it, where the agent answered as another', async () => {
		await aTurn('Why two passes?');
		const id = chat.current?.id as Ulid;
		chat.startThread();
		await chat.openThread(id);
		stub.answersAs = 'another-session';

		const before = stub.said.length;
		const saying = chat.say('And the lexer?');
		await settled();
		// Which conversation answered is what says whether this one has to be
		// handed over, so nothing has gone to the agent until it is said.
		expect(stub.said).toHaveLength(before);
		stub.begins();
		await saying;

		expect(chat.says).toBe('The assistant is going on from a summary of this thread.');
		expect(chat.current?.session).toBe('another-session');
		expect(stub.said.at(-1)).toContain('Why two passes?');
		expect(stub.said.at(-1)).toContain('And the lexer?');
	});

	it('hands over what was said where the agent never says which session answered', async () => {
		await aTurn('Why two passes?');
		const id = chat.current?.id as Ulid;
		chat.startThread();
		await chat.openThread(id);

		vi.useFakeTimers();
		try {
			const saying = chat.say('And the lexer?');
			await vi.advanceTimersByTimeAsync(20_000);
			await saying;
		} finally {
			vi.useRealTimers();
		}

		expect(stub.said.at(-1)).toContain('Why two passes?');
		expect(stub.said.at(-1)).toContain('And the lexer?');
		// Which conversation answered is unknown, so nothing is claimed about it.
		expect(chat.says).toBe(null);
	});

	it('hands over what was said where the agent under the chat was changed', async () => {
		stub.offers = ['claude_code', 'anthropic'];
		await chat.lookForAgents();
		await aTurn('Why two passes?');

		chat.pick('anthropic', undefined);
		await aTurn('And the lexer?');

		expect(stub.said.at(-1)).toContain('Why two passes?');
		expect(stub.said.at(-1)).toContain('And the lexer?');
	});

	it('hands it to the chat it was said in and to no other', async () => {
		stub.offers = ['claude_code', 'anthropic'];
		await chat.lookForAgents();
		await aTurn('Why two passes?');
		const first = chat.current?.id as Ulid;
		chat.pick('anthropic', undefined);

		await chat.startThread();
		await aTurn('What does the emitter do?');

		expect(stub.said.at(-1)).toBe('What does the emitter do?');

		// And the chat it belongs to still opens with it when it is read again.
		await chat.openThread(first);
		await aTurn('And the lexer?');

		expect(stub.said.at(-1)).toContain('Why two passes?');
	});

	it('hands over what was said where there is no session to pick up', async () => {
		await aTurn('Why two passes?');
		// A session the agent never named is one there is nothing to resume.
		const id = chat.current?.id as Ulid;
		const without = { ...(chat.current as ChatThread) };
		delete without.session;
		await (await kept()).write(without);
		chat.clear();
		await chat.opened(graph);
		expect(chat.current?.id).toBe(id);

		await chat.say('And the lexer?');

		expect(stub.asked.at(-1)?.thread.session).toBeUndefined();
		expect(stub.said.at(-1)).toContain('Why two passes?');
	});
});

describe('a chat somebody takes away with them', () => {
	it('is the whole of it as markdown, with what was asked of the notes named', async () => {
		await chat.say('Why two passes?');
		stub.begins();
		stub.tell({
			event: 'block',
			at: 0,
			block: { kind: 'said', said: 'Because the lexer needs a second look.' }
		});
		stub.tell({
			event: 'block',
			at: 1,
			block: {
				kind: 'tool_call',
				call: 'c1',
				tool: 'search_notes',
				act: 'search_notes',
				arguments: { words: 'parser' }
			}
		});
		stub.tell({ event: 'ended' });
		await settled();

		const said = chat.copyAsMarkdown();

		expect(said).toContain('# Why two passes?');
		expect(said).toContain('**You**');
		expect(said).toContain('Why two passes?');
		expect(said).toContain('**Assistant**');
		expect(said).toContain('Because the lexer needs a second look.');
		expect(said).toContain('*Looking through the notes: parser*');
	});

	it('is nothing before anything has been said', () => {
		expect(chat.copyAsMarkdown()).toBe('');
	});
});
