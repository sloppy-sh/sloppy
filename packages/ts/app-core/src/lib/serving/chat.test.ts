// The desk's chat, spoken to from a headset: the threads of a served folder,
// a turn said from the headset and answered as it is written, the note the
// assistant takes the reader to. docs/ARCHITECTURE.md § "A headset beside the
// desk".

import 'fake-indexeddb/auto';
import {
	containerApi,
	DeviceThreads,
	type History,
	MemoryFiles,
	namedProjects,
	type ProjectsServing,
	servingProjects
} from '@sloppy/local';
import {
	CHAT_OPEN_TURNS,
	CHAT_SAID_CUT,
	type ChatAgent,
	type ChatEvent,
	type ChatThread,
	type ChatToolAnswer,
	type ChatToolCall,
	type ChatTurn,
	draftBranch,
	NO_AGENT_SAID,
	type OwnedRef,
	SERVE_REFUSALS,
	type StandingDraft,
	ulid,
	type Ulid
} from '@sloppy/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chatEngine } from '../chat-engine.svelte.js';
import { initRuntime, type ChatAccess, type ChatAsked, type ChatLive } from '../runtime.js';
import { seamSettledAgain } from '../seam.svelte.js';
import { chat } from '../stores/chat.svelte.js';
import { chatDraft } from '../stores/chat-draft.svelte.js';
import { prefs } from '../stores/prefs.svelte.js';
import { chatClosed, chatMethods, NO_SUCH_THREAD, STILL_ANSWERING } from './chat.js';

const GARDEN = '/work/garden';
const ORCHARD = '/work/orchard';

type Line = Record<string, unknown> & {
	id?: number;
	method?: string;
	params?: Record<string, unknown>;
	result?: Record<string, unknown>;
	error?: { code: number; message: string };
};

/** The desk's agent as the shell carries it: every session asked for, and the
 *  events a test has it tell. */
class Agent implements ChatAccess {
	offers: ChatAgent[] = ['claude_code'];
	asked: ChatAsked[] = [];
	said: { thread: Ulid; words: string }[] = [];
	closed: Ulid[] = [];
	stopped: Ulid[] = [];
	/** Each draft asked for, and the folder it was asked of. */
	starts: { id: Ulid; root?: string }[] = [];
	readonly standing = new Map<
		Ulid,
		{ hear: (event: ChatEvent) => void; serve: (call: ChatToolCall) => Promise<ChatToolAnswer> }
	>();
	readonly #drafts = new Map<Ulid, StandingDraft>();

	readonly drafts = {
		standing: async () => [...this.#drafts.values()],
		start: async (id: Ulid, root?: string) => {
			this.starts.push(root === undefined ? { id } : { id, root });
			const at = root ?? GARDEN;
			const draft: StandingDraft = {
				id,
				root: at,
				vault: at,
				branch: draftBranch(id),
				from: 'v0'
			};
			this.#drafts.set(id, draft);
			return draft;
		},
		discard: async (draft: StandingDraft) => {
			this.#drafts.delete(draft.id);
		},
		files: (draft: StandingDraft) => folders.get(draft.root) as MemoryFiles,
		history: () => ({ commit: async () => null }) as unknown as History
	};

	agents(): Promise<ChatAgent[]> {
		return Promise.resolve([...this.offers]);
	}

	open(
		asked: ChatAsked,
		hear: (event: ChatEvent) => void,
		serve: (call: ChatToolCall) => Promise<ChatToolAnswer>
	): Promise<ChatLive> {
		const of = asked.thread.id;
		this.asked.push(asked);
		this.standing.set(of, { hear, serve });
		return Promise.resolve({
			say: async (words: string) => {
				this.said.push({ thread: of, words });
			},
			stop: async () => {
				this.stopped.push(of);
			},
			close: async () => {
				this.closed.push(of);
				this.standing.delete(of);
			}
		});
	}

	/** Four events of one answer: the agent saying what it is, a block
	 *  growing, and the turn ending. */
	answers(thread: Ulid, ending: ChatEvent | null = { event: 'ended' }): ChatEvent[] {
		const events: ChatEvent[] = [
			{ event: 'started', session: `s-${thread}`, tools: ['show_note'] },
			{ event: 'block', at: 0, block: { kind: 'said', said: 'The' } },
			{ event: 'block', at: 0, block: { kind: 'said', said: 'The note' } },
			...(ending === null ? [] : [ending])
		];
		for (const event of events) this.standing.get(thread)?.hear(event);
		return events;
	}

	acts(thread: Ulid, call: ChatToolCall): Promise<ChatToolAnswer> | undefined {
		return this.standing.get(thread)?.serve(call);
	}
}

let agent: Agent;
let loop: ProjectsServing;
let threads: DeviceThreads;
let folders: Map<string, MemoryFiles>;
let heard: Map<string, Line[]>;
let asking = 0;
let gardenGraph: OwnedRef;

async function aFolder(root: string): Promise<MemoryFiles> {
	const files = new MemoryFiles({ root, data: `${root}-data` });
	await files.write('package.json', new TextEncoder().encode('{"name":"it"}'));
	await containerApi(files).openProject(root);
	return files;
}

async function settled(): Promise<void> {
	await loop.settled();
	for (let turn = 0; turn < 30; turn++) await new Promise((done) => setTimeout(done, 0));
}

/** One line from a headset on `connection`, answered once everything it
 *  started has settled. */
async function ask(
	connection: string,
	method: string,
	params: Record<string, unknown> = {},
	project = 'garden'
): Promise<Line> {
	const id = ++asking;
	loop.take(
		JSON.stringify({ jsonrpc: '2.0', id, method, params, project }),
		(line) => heard.set(connection, [...(heard.get(connection) ?? []), JSON.parse(line)]),
		connection
	);
	await settled();
	const answer = heard.get(connection)?.find((one) => one.id === id);
	if (!answer) throw new Error(`${method} was not answered`);
	return answer;
}

/** What the desk sent `connection` unasked, by method. */
function told(connection: string, method: string): Record<string, unknown>[] {
	return (heard.get(connection) ?? [])
		.filter((line) => line.id === undefined && line.method === method)
		.map((line) => line.params as Record<string, unknown>);
}

async function opened(connection: string, thread?: Ulid, project?: string): Promise<Ulid> {
	const answer = await ask(
		connection,
		'chat/open',
		thread === undefined ? {} : { thread },
		project
	);
	return (answer.result?.thread as { id: Ulid }).id;
}

function aThread(id: Ulid, project: string, changed: Partial<ChatThread> = {}): ChatThread {
	return {
		id,
		name: `Thread ${id.slice(-4)}`,
		graph: gardenGraph,
		project,
		created_at: '2026-11-01T00:00:00.000Z',
		updated_at: '2026-11-01T00:00:00.000Z',
		places: [],
		turns: [],
		...changed
	};
}

beforeEach(async () => {
	localStorage.clear();
	prefs.init();
	agent = new Agent();
	heard = new Map();
	folders = new Map([
		[GARDEN, await aFolder(GARDEN)],
		[ORCHARD, await aFolder(ORCHARD)]
	]);
	gardenGraph = await containerApi(folders.get(GARDEN) as MemoryFiles).graphHere();
	threads = new DeviceThreads(new MemoryFiles({ root: '/device', data: '/device-data' }));
	initRuntime({
		apiHost: () => 'http://api.test',
		mode: () => 'local',
		chat: agent,
		threads,
		project: async () => folders.get(GARDEN)
	});
	seamSettledAgain();
	loop = servingProjects(
		namedProjects([
			{ name: 'garden', server: { version: '1', files: folders.get(GARDEN) } },
			{ name: 'orchard', server: { version: '1', files: folders.get(ORCHARD) } }
		]),
		{ methods: chatMethods, closed: chatClosed }
	);
});

afterEach(() => {
	for (const connection of heard.keys()) loop.closed(connection);
	chat.clear();
	chatDraft.clear();
	for (const live of chatEngine.all()) {
		chatEngine.letSessionGo(live);
		chatEngine.forget(live.thread.id);
	}
	initRuntime({
		apiHost: () => '',
		mode: () => 'hosted',
		chat: undefined,
		threads: undefined,
		project: undefined
	});
	seamSettledAgain();
	localStorage.clear();
});

describe('the chat engine', () => {
	it('tells everybody following a thread every event of it', async () => {
		const thread = aThread(ulid(), GARDEN);
		const live = chatEngine.liveFor(thread);
		const one: ChatEvent[] = [];
		const two: ChatEvent[] = [];
		const stopOne = chatEngine.listen(thread.id, { heard: (event) => one.push(event) });
		const stopTwo = chatEngine.listen(thread.id, { heard: (event) => two.push(event) });

		await chatEngine.say(live, 'Why the garden?', { places: [], attached: [] });
		const events = agent.answers(thread.id);
		stopOne();
		stopTwo();

		expect(one).toEqual(events);
		expect(two).toEqual(events);
		expect(live.turns.at(-1)?.blocks).toEqual([{ kind: 'said', said: 'The note' }]);
	});
});

describe('the desk chat from a headset', () => {
	it('lists the chat threads of the folder asked of, newest first and the archived ones last', async () => {
		const [older, newer, archived, elsewhere, build] = [ulid(), ulid(), ulid(), ulid(), ulid()];
		await threads.write(aThread(older, GARDEN, { updated_at: '2026-11-02T00:00:00.000Z' }));
		await threads.write(aThread(newer, GARDEN, { updated_at: '2026-11-03T00:00:00.000Z' }));
		await threads.write(
			aThread(archived, GARDEN, {
				updated_at: '2026-11-04T00:00:00.000Z',
				archived_at: '2026-11-04T00:00:00.000Z'
			})
		);
		await threads.write(aThread(elsewhere, ORCHARD));
		await threads.write(aThread(build, GARDEN, { kind: 'build', build }));

		const listed = await ask('a', 'chat/threads');

		expect(listed.result).toEqual({
			threads: [
				{
					id: newer,
					name: `Thread ${newer.slice(-4)}`,
					updated_at: '2026-11-03T00:00:00.000Z',
					archived: false,
					answering: false
				},
				{
					id: older,
					name: `Thread ${older.slice(-4)}`,
					updated_at: '2026-11-02T00:00:00.000Z',
					archived: false,
					answering: false
				},
				{
					id: archived,
					name: `Thread ${archived.slice(-4)}`,
					updated_at: '2026-11-04T00:00:00.000Z',
					archived: true,
					answering: false
				}
			]
		});
	});

	it('answers what is said into a new thread on the connection that opened it and on no other', async () => {
		const thread = await opened('a');
		await opened('b');

		const answer = await ask('a', 'chat/say', { thread, said: 'Take me to the roses' });
		const events = agent.answers(thread);
		await settled();

		expect(answer.result).toEqual({});
		expect(told('a', 'chat/event')).toEqual(events.map((event) => ({ thread, event })));
		expect(told('b', 'chat/event')).toEqual([]);
		expect(agent.said).toEqual([{ thread, words: 'Take me to the roses' }]);
		expect(agent.asked[0]).toMatchObject({ thread: { id: thread }, surface: 'headset' });
	});

	it('keeps a thread started from a headset where the desk lists it, named from what was said', async () => {
		const graph = gardenGraph;
		await chat.opened(graph);
		const thread = await opened('a');

		await ask('a', 'chat/say', { thread, said: 'Why roses by the wall?' });

		const kept = await threads.read(thread);
		expect(kept).toMatchObject({ name: 'Why roses by the wall?', project: GARDEN, graph });
		expect(chat.threads.map((one) => one.id)).toContain(thread);
		expect(chat.answeringAway(thread)).toBe(true);
		const listed = await ask('a', 'chat/threads');
		expect(listed.result?.threads).toEqual([
			expect.objectContaining({ id: thread, answering: true })
		]);
	});

	it('shows the turn a headset is having on the desk, as it arrives, when the desk is reading that thread', async () => {
		await chat.opened(gardenGraph);
		const thread = await opened('a');
		await ask('a', 'chat/say', { thread, said: 'Why roses?' });

		agent.answers(thread, null);
		await chat.openThread(thread);

		expect(chat.current?.id).toBe(thread);
		expect(chat.running).toBe(true);
		const said = (turn: ChatTurn) =>
			turn.blocks.map((block) => ('said' in block ? block.said : ''));
		expect(chat.turns.map(said)).toEqual([['Why roses?'], ['The note']]);
	});

	it('works on a draft of the folder the headset is reading, not the one in front of the desk', async () => {
		const thread = await opened('a', undefined, 'orchard');

		await ask('a', 'chat/say', { thread, said: 'What grows here?' }, 'orchard');

		expect(agent.starts).toEqual([{ id: thread, root: ORCHARD }]);
		expect(agent.asked[0]).toMatchObject({ cwd: ORCHARD, surface: 'headset' });
		expect((await threads.read(thread))?.project).toBe(ORCHARD);
	});

	it('refuses a second thread of the folder while one answers, unless chats go on in the background', async () => {
		const first = await opened('a');
		await ask('a', 'chat/say', { thread: first, said: 'Why roses?' });

		const second = await ask('b', 'chat/open');
		const again = await ask('a', 'chat/say', { thread: first, said: 'And?' });

		expect(second.error).toEqual({ code: SERVE_REFUSALS.ANSWERING, message: STILL_ANSWERING });
		expect(again.error).toEqual({ code: SERVE_REFUSALS.ANSWERING, message: STILL_ANSWERING });

		prefs.set('chatInBackground', true);
		const allowed = await ask('b', 'chat/open');
		expect(allowed.result?.thread).toMatchObject({ name: '', turns: [] });
	});

	it('says the desk has no assistant where it has none', async () => {
		agent.offers = [];

		const answer = await ask('a', 'chat/open');

		expect(answer.error).toEqual({ code: SERVE_REFUSALS.NO_AGENT, message: NO_AGENT_SAID });
	});

	it('refuses a thread of another folder', async () => {
		const elsewhere = ulid();
		await threads.write(aThread(elsewhere, ORCHARD));

		const answer = await ask('a', 'chat/open', { thread: elsewhere });

		expect(answer.error).toEqual({ code: -32602, message: NO_SUCH_THREAD });
	});

	it('opens a thread with its last turns, each one cut short enough for one line', async () => {
		const id = ulid();
		const turns: ChatTurn[] = Array.from({ length: 50 }, (_, at) => ({
			from: at % 2 === 0 ? 'person' : 'agent',
			blocks: [{ kind: 'said', said: at === 49 ? 'x'.repeat(5_000) : `turn ${at}` }],
			at: '2026-11-01T00:00:00.000Z'
		}));
		await threads.write(aThread(id, GARDEN, { turns }));

		const answer = await ask('a', 'chat/open', { thread: id });

		const served = (answer.result?.thread as { turns: ChatTurn[] }).turns;
		expect(served).toHaveLength(CHAT_OPEN_TURNS);
		expect(served[0].blocks).toEqual([{ kind: 'said', said: 'turn 10' }]);
		expect(served.at(-1)?.blocks).toEqual([
			{ kind: 'said', said: `${'x'.repeat(CHAT_SAID_CUT)}…` }
		]);
	});

	it('takes the reader who asked to the note the assistant shows, and nobody else', async () => {
		const note = await containerApi(folders.get(GARDEN) as MemoryFiles).createNode({
			title: 'Roses by the wall'
		});
		const thread = await opened('a');
		await opened('b', thread);
		await ask('b', 'chat/say', { thread, said: 'Take me to the roses' });

		const answered = await agent.acts(thread, {
			call: 'call-1',
			act: 'show_note',
			arguments: { note: note.ref }
		});
		await settled();

		expect(answered?.trouble).toBeUndefined();
		expect(told('b', 'view/show')).toEqual([
			{ note: note.ref, title: 'Roses by the wall', address: note.address }
		]);
		expect(told('a', 'view/show')).toEqual([]);
	});

	it('opens a thread the desk is answering in again for the headset, and again for the desk after it', async () => {
		const note = await containerApi(folders.get(GARDEN) as MemoryFiles).createNode({
			title: 'Roses by the wall'
		});
		await chat.opened(gardenGraph);
		await chat.say('Why roses?');
		const thread = chat.current?.id as Ulid;
		agent.answers(thread);
		await settled();
		expect(chatEngine.live(thread)?.standing).toBe(true);

		await opened('a', thread);
		await ask('a', 'chat/say', { thread, said: 'Take me to the roses' });
		await agent.acts(thread, { call: 'call-1', act: 'show_note', arguments: { note: note.ref } });
		agent.answers(thread);
		await settled();

		expect(agent.closed).toEqual([thread]);
		expect(agent.asked.at(-1)).toMatchObject({
			thread: { id: thread, session: `s-${thread}` },
			surface: 'headset'
		});
		expect(told('a', 'view/show')).toEqual([
			{ note: note.ref, title: 'Roses by the wall', address: note.address }
		]);

		await chat.say('And the wall?');

		expect(agent.closed).toEqual([thread, thread]);
		expect(agent.asked.at(-1)?.surface).toBeUndefined();
		expect(agent.asked.at(-1)?.thread.session).toBe(`s-${thread}`);
	});

	it('stops telling a connection that has gone, and leaves its thread the way the desk does', async () => {
		const thread = await opened('a');
		await opened('b', thread);
		await ask('a', 'chat/say', { thread, said: 'Why roses?' });
		agent.answers(thread);
		await settled();

		loop.closed('a');
		const before = told('a', 'chat/event').length;
		await ask('b', 'chat/say', { thread, said: 'And the wall?' });
		agent.answers(thread);
		await settled();

		expect(told('a', 'chat/event')).toHaveLength(before);
		expect(told('b', 'chat/event')).toHaveLength(8);
		expect(agent.closed).toEqual([]);

		loop.closed('b');
		expect(agent.closed).toEqual([thread]);
	});

	it('stops the turn underway and lets a thread go on chat/close', async () => {
		const thread = await opened('a');
		await ask('a', 'chat/say', { thread, said: 'Why roses?' });

		await ask('a', 'chat/stop', { thread });
		await ask('a', 'chat/close', { thread });

		expect(agent.stopped).toEqual([thread]);
		expect(agent.closed).toEqual([thread]);
	});
});
