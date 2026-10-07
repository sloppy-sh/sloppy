import { whatHappened, type ChatAccess, type ChatAsked, type ChatLive } from '@sloppy/app-core';
import type { AiKeysAccess } from '@sloppy/local';
import {
	CHAT_TOOLS,
	draftBranch,
	heldAsideIn,
	usedIn,
	type ChatEvent,
	type ToolResultBlock,
	type ChatToolAnswer,
	type ChatToolCall,
	type ContextUsage,
	type StandingDraft
} from '@sloppy/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tauriChat, type Telling, type Told } from './chat';
import { tauriDrafts, type DraftAccess } from './draft';
import { tauriFiles } from './files';

const PROJECT = '/work/compiler';
const NOTES = `${PROJECT}/.sloppy`;
const PARSER = 'src/parser.ts';

/** Where this app keeps its own copies, as `draft_start` answers them. */
const COPIES = '/data/drafts';
/** The thread a session is opened for, whose draft it works in, and another
 *  the same person keeps about the same project. */
const THREAD = '01JAPART000000000000000000';
const SECOND = '01JAPART000000000000000001';

/** The graphs two folders beside the project hold, which is what makes them
 *  places Sloppy's own acts answer for. */
const THEIRS = 'did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE/01JQ7X3K9M2N4P5R6S7T8V9W0X';
const ALSO_THEIRS = 'did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE/01JQ7X3K9M2N4P5R6S7T8V9W1Y';

/** What a thread asks a session to be opened as. */
const asking = (more: Partial<ChatAsked> = {}): ChatAsked => ({
	thread: { id: THREAD, places: [] },
	...more
});

function copy(id: string): StandingDraft {
	return {
		id,
		root: `${COPIES}/${id}`,
		vault: `${COPIES}/${id}/.sloppy`,
		branch: draftBranch(id),
		from: 'f0f0f0'
	};
}

/** The agents this device has, as `chat_agents` answers. */
let here: string[];
type Opened = {
	agent: string;
	thread: string;
	root: string;
	tools: { name: string }[];
	brief: string;
	places: string[];
	resume: boolean;
	model?: string;
	session?: string;
};
let opens: Opened[];
/** Every line written onto the agent's own input. */
let lines: string[];
let answers: { thread: string; call: string; said: string; trouble: boolean }[];
let closes: number;
/** Which thread each line said, each answer and each end was asked of. */
let saidIn: string[];
let closedIn: string[];
/** What each thread's session is told over, which the shell takes and the tests
 *  speak into — one per session, because two of them stand at once. */
let channel: Telling;
let channels: Map<string, Telling>;

/** The notes the drafts are of, and the copies standing, as `draft_standing`
 *  answers them. */
let notes: string | undefined;
let standing: StandingDraft[];
let started: { root: string; id: string }[];
let discarded: { root: string; id: string }[];
/** Where a history a draft was reached through was rooted. */
let headsAt: string[];

/** Every call that reached the page's act, and what that act answers with —
 *  the acts themselves are `chat-acts.ts` in `@sloppy/app-core`, so what is
 *  stood in for here is only the handing over. */
let served: ChatToolCall[];
let serving: (call: ChatToolCall) => Promise<ChatToolAnswer>;

const serve = async (call: ChatToolCall): Promise<ChatToolAnswer> => {
	served.push(call);
	return await serving(call);
};

const project = async () => PROJECT;

const call = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
	const held = args ?? {};
	switch (command) {
		case 'chat_agents':
			return here as T;
		case 'chat_open': {
			const asked = held.asked as Opened;
			opens.push(asked);
			channel = held.heard as Telling;
			channels.set(asked.thread, channel);
			return undefined as T;
		}
		case 'chat_say':
			lines.push(held.line as string);
			saidIn.push(held.thread as string);
			return undefined as T;
		case 'chat_answer':
			answers.push({
				thread: held.thread as string,
				call: held.call as string,
				said: held.said as string,
				trouble: held.trouble as boolean
			});
			return undefined as T;
		case 'chat_close': {
			const of = held.thread as string;
			closes += 1;
			closedIn.push(of);
			queueMicrotask(() => tells({ from: 'over', stopped: true, trouble: null }, of));
			return undefined as T;
		}
		case 'draft_standing':
			return standing as T;
		case 'draft_start': {
			const made = copy(held.id as string);
			if (standing.some((one) => one.id === made.id)) {
				throw 'This chat already has a draft of these notes.';
			}
			started.push({ root: held.root as string, id: made.id });
			standing = [...standing, made];
			return made as T;
		}
		case 'draft_discard':
			discarded.push({ root: held.root as string, id: held.id as string });
			standing = standing.filter((one) => one.id !== held.id);
			return undefined as T;
		case 'history_head':
			headsAt.push(held.root as string);
			return null as T;
	}
	throw new Error(`no such command: ${command}`);
};

function tells(told: Told, of?: string): void {
	const held = of === undefined ? channel : channels.get(of);
	held?.onmessage(told);
}

function says(line: string, of?: string): void {
	tells({ from: 'said', line }, of);
}

/** What was written onto the agent's own input, read back. */
function written(): {
	type?: string;
	request_id?: string;
	request?: { subtype?: string };
	message?: unknown;
}[] {
	return lines.map((line) => JSON.parse(line));
}

/** The turns the person's own words went out as, apart from what this shell
 *  writes on its own — an interrupt, and a question about the window. */
function spoken(): unknown[] {
	return written()
		.filter((one) => one.type === 'user')
		.map((one) => one.message);
}

/** Every question about what is in the agent's window, however it was asked. */
function askedAbout(): { type?: string; request_id?: string; request?: { subtype?: string } }[] {
	return written().filter(
		(one) =>
			one.request?.subtype === 'get_context_usage' ||
			(one.type === 'user' && JSON.stringify(one.message).includes('/context'))
	);
}

/** The id of the ask still waiting, which the agent answers under. */
function waitingOn(): string {
	const [asked] = askedAbout();
	if (asked?.request_id === undefined) throw new Error('nothing was asked');
	return asked.request_id;
}

function calls(act: string, args: unknown, id = 'c1', of?: string): void {
	tells({ from: 'called', call: id, act, arguments: args }, of);
}

function drafts(): DraftAccess {
	return tauriDrafts(
		() => notes,
		tauriFiles('', call, (path) => path),
		call
	);
}

function chat(): ChatAccess {
	return tauriChat(project, drafts(), call, () => ({ onmessage: () => {} }));
}

/** A session open and saying nothing yet, with the handle it answered with and
 *  everything it tells the page collected. */
async function opened(): Promise<{ access: ChatAccess; live: ChatLive; heard: ChatEvent[] }> {
	const heard: ChatEvent[] = [];
	const access = chat();
	const live = await access.open(asking(), (event) => heard.push(event), serve);
	return { access, live, heard };
}

async function until(held: () => boolean): Promise<void> {
	for (let at = 0; at < 200 && !held(); at++) {
		await new Promise((resolve) => setTimeout(resolve, 1));
	}
	if (!held()) throw new Error('it never happened');
}

// ── What the agent writes out ────────────────────────────────────────────────

const INIT = JSON.stringify({
	type: 'system',
	subtype: 'init',
	session_id: 's1',
	model: 'a-model',
	tools: ['Read', 'mcp__sloppy__write_note']
});

const RESULT = JSON.stringify({ type: 'result', subtype: 'success' });

function messageStart(id: string): string {
	return JSON.stringify({
		type: 'stream_event',
		event: { type: 'message_start', message: { id } }
	});
}

function blockStart(index: number, block: unknown): string {
	return JSON.stringify({
		type: 'stream_event',
		event: { type: 'content_block_start', index, content_block: block }
	});
}

function textDelta(index: number, text: string): string {
	return JSON.stringify({
		type: 'stream_event',
		event: { type: 'content_block_delta', index, delta: { type: 'text_delta', text } }
	});
}

function assistant(id: string, content: unknown[], more: Record<string, unknown> = {}): string {
	return JSON.stringify({ type: 'assistant', message: { id, content, ...more } });
}

/** One of the agent's tools answered, as the agent hands it back to itself. */
function result(
	call: string,
	content: string
): { type: 'tool_result'; tool_use_id: string; content: string } {
	return { type: 'tool_result', tool_use_id: call, content };
}

/** The answers the page was told of, as they were told. */
function resultBlocks(heard: ChatEvent[]): ToolResultBlock[] {
	return heard.flatMap((event) =>
		event.event === 'block' && event.block.kind === 'tool_result'
			? [event.block as ToolResultBlock]
			: []
	);
}

/** What the window holds, as the agent answers the ask it is given over its
 *  own channel. */
const WINDOW = 200_000;

function breakdown(id: string, more: Record<string, unknown> = {}): string {
	return JSON.stringify({
		type: 'control_response',
		response: {
			subtype: 'success',
			request_id: id,
			response: {
				categories: [
					{ name: 'System prompt', tokens: 3_000, kind: 'used' },
					{ name: 'Messages', tokens: 12_000, kind: 'used' },
					{ name: 'Free space', tokens: 185_000, kind: 'free' },
					{ name: 'Autocompact buffer', tokens: 45_000, kind: 'buffer' },
					{ name: 'Tool definitions', tokens: 9_000, kind: 'deferred' }
				],
				totalTokens: 15_000,
				maxTokens: WINDOW,
				rawMaxTokens: WINDOW,
				autoCompactThreshold: 160_000,
				isAutoCompactEnabled: true,
				...more
			}
		}
	});
}

/** What an agent that has no breakdown to give answers the same ask with. */
function noBreakdown(id: string): string {
	return JSON.stringify({
		type: 'control_response',
		response: {
			subtype: 'error',
			request_id: id,
			error: 'get_context_usage is not supported in this context'
		}
	});
}

/**
 * The same breakdown as the agent answers it when it was asked in WORDS: beside
 * the message rather than inside it, in its other spelling, and saying nothing
 * about where room will be made.
 */
function breakdownInWords(said: string, total: number): string {
	return JSON.stringify({
		type: 'assistant',
		message: { id: 'm1', content: [{ type: 'text', text: said }] },
		context_usage: {
			model: 'a-model',
			categories: [
				{ name: 'System prompt', tokens: 4_000, kind: 'used' },
				{ name: 'Free space', tokens: WINDOW - 4_000, kind: 'free' },
				{ name: 'Tool definitions', tokens: 9_000, kind: 'deferred' }
			],
			total_tokens: total,
			raw_max_tokens: WINDOW,
			percentage: 2
		}
	});
}

/** The window as an agent's own request carried it, which is what it holds
 *  going into that answer. */
function carrying(sent: number, recalled = 0): string {
	return JSON.stringify({
		type: 'stream_event',
		event: {
			type: 'message_start',
			message: {
				id: `m${sent}`,
				usage: { input_tokens: sent, cache_read_input_tokens: recalled }
			}
		}
	});
}

/** The last thing the page was told about the window. */
function windowNow(heard: ChatEvent[]): ContextUsage {
	const held = heard.filter((one) => one.event === 'context');
	const last = held[held.length - 1];
	if (last === undefined) throw new Error('nothing was said about the window');
	return last.usage;
}

const WROTE = { sections: ['## What it does\n\nIt reads a file and hands back the sections.'] };

beforeEach(() => {
	here = ['claude_code'];
	opens = [];
	lines = [];
	answers = [];
	closes = 0;
	saidIn = [];
	closedIn = [];
	channel = { onmessage: () => {} };
	channels = new Map();
	served = [];
	serving = async () => ({ said: 'Written to The reader.' });
	notes = NOTES;
	standing = [];
	started = [];
	discarded = [];
	headsAt = [];
});

describe('the agents this device can reach', () => {
	it('answers only the ones it knows', async () => {
		here = ['claude_code', 'something_else'];

		expect(await chat().agents()).toEqual(['claude_code']);
	});

	it('counts an agent a key this device holds opens, in the order they are named', async () => {
		here = ['claude_code'];
		const keys: AiKeysAccess = {
			held: async () => [{ provider: 'deepseek', backing: 'hardware' }],
			hold: async () => 'hardware',
			forget: async () => {}
		};

		expect(await tauriChat(project, drafts(), call, () => channel, keys).agents()).toEqual([
			'claude_code',
			'deepseek'
		]);

		here = [];
		expect(await tauriChat(project, drafts(), call, () => channel, keys).agents()).toEqual([
			'deepseek'
		]);
	});

	it('says what to install where a chat is opened anyway', async () => {
		here = [];

		await expect(chat().open(asking(), () => {}, serve)).rejects.toThrow(
			'Sloppy has nothing on this computer to chat with. Install Claude Code, or give it a key in Settings, and try again.'
		);
	});

	it('says which one is missing where somebody chose it', async () => {
		here = [];

		await expect(chat().open(asking({ agent: 'claude_code' }), () => {}, serve)).rejects.toThrow(
			'Claude Code is not on this computer. Install it and try again.'
		);
	});
});

describe('a session', () => {
	it('starts the agent in a copy of the project, handing it every act Sloppy has', async () => {
		await opened();

		expect(opens[0].agent).toBe('claude_code');
		expect(opens[0].root).toBe(standing[0].root);
		expect(opens[0].tools.map((tool) => tool.name)).toEqual([...CHAT_TOOLS]);
	});

	it('says there is no project to chat about where none is open', async () => {
		const access = tauriChat(
			async () => undefined,
			drafts(),
			call,
			() => channel
		);

		await expect(access.open(asking(), () => {}, serve)).rejects.toThrow(
			'Open the project these notes are about first.'
		);
		expect(started).toEqual([]);
	});

	it('starts the agent in the project itself where this shell keeps no draft', async () => {
		const access = tauriChat(project, undefined, call, () => ({ onmessage: () => {} }));

		await access.open(asking(), () => {}, serve);

		expect(opens[0].root).toBe(PROJECT);
	});

	it("says what somebody typed onto the agent's own input", async () => {
		const { live } = await opened();

		await live.say('Say what the reader does');

		expect(JSON.parse(lines[0])).toEqual({
			type: 'user',
			message: { role: 'user', content: [{ type: 'text', text: 'Say what the reader does' }] }
		});
	});

	it('asks for something to be said rather than starting a turn on nothing', async () => {
		const { live } = await opened();

		await expect(live.say('   ')).rejects.toThrow('Say what you want written about.');
		expect(lines).toEqual([]);
	});

	it('refuses a second thing said while the turn is underway', async () => {
		const { live } = await opened();
		await live.say('first');

		await expect(live.say('second')).rejects.toThrow('Wait for the answer');
		expect(lines).toHaveLength(1);
	});

	it('goes on with the session once the turn has ended', async () => {
		const { live, heard } = await opened();
		await live.say('first');

		says(RESULT);
		await live.say('second');

		expect(heard).toContainEqual({ event: 'ended' });
		expect(spoken()).toHaveLength(2);
	});

	it('says what a turn spent where the agent says, and nothing where it does not', async () => {
		const { live, heard } = await opened();
		await live.say('first');

		says(
			JSON.stringify({
				type: 'result',
				subtype: 'success',
				usage: {
					input_tokens: 1200,
					output_tokens: 340,
					cache_read_input_tokens: 900,
					cache_creation_input_tokens: 0,
					output_tokens_details: { thinking_tokens: 40 }
				},
				total_cost_usd: 0.0421,
				modelUsage: { 'claude-fable-5-1': { costUSD: 0.0421 } }
			})
		);
		expect(heard.at(-1)).toEqual({
			event: 'ended',
			spent: { sent: 1200, answered: 340, recalled: 900, kept: 0, thought: 40, cost: 0.0421 }
		});

		await live.say('second');
		says(RESULT);
		expect(heard.at(-1)).toEqual({ event: 'ended' });
	});

	it('takes the cost from the models where the total is not said', async () => {
		const { live, heard } = await opened();
		await live.say('first');

		says(
			JSON.stringify({
				type: 'result',
				usage: { input_tokens: 10, output_tokens: 5 },
				modelUsage: { a: { costUSD: 0.01 }, b: { costUSD: 0.02 }, c: {} }
			})
		);
		expect(heard.at(-1)).toEqual({
			event: 'ended',
			spent: { sent: 10, answered: 5, cost: 0.03 }
		});
	});

	it('says nothing about why where the session simply ended', async () => {
		const { live, heard } = await opened();

		await live.close();

		expect(closes).toBe(1);
		expect(heard.at(-1)).toEqual({ event: 'over' });
	});

	it('hands on what the agent said about its own trouble', async () => {
		const { heard } = await opened();

		tells({ from: 'over', stopped: false, trouble: 'Sign in to keep going.' });

		expect(heard.at(-1)).toEqual({ event: 'over', said: 'Sign in to keep going.' });
	});

	it('says nothing more into a chat that is over', async () => {
		const { live } = await opened();
		await live.close();

		await expect(live.say('again')).rejects.toThrow('That chat is over.');
	});

	it('ends the turn on the person stopping it, and keeps the session', async () => {
		const { live, heard } = await opened();
		await live.say('first');

		const stopping = live.stop();
		await until(() => lines.length === 2);
		says(RESULT);
		await stopping;

		expect(JSON.parse(lines[1])).toMatchObject({
			type: 'control_request',
			request: { subtype: 'interrupt' }
		});
		expect(heard).toContainEqual({ event: 'ended', stopped: true });
		await live.say('second');
	});

	it('is not a failure to stop where no turn is underway', async () => {
		const { live } = await opened();

		await live.stop();

		expect(lines).toEqual([]);
	});

	it('lets go of a session another was opened over', async () => {
		const { access, heard } = await opened();

		await access.open(asking(), () => {}, serve);

		expect(heard.at(-1)).toEqual({ event: 'over' });
		expect(opens).toHaveLength(2);
	});
});

/** How many stand at once is the page's rule, so this shell holds one per
 *  thread and each act is keyed by the thread it belongs to. */
describe('two threads with a conversation each', () => {
	/** Both open, with what each of them tells the page collected. */
	async function both(): Promise<{
		one: { live: ChatLive; heard: ChatEvent[] };
		other: { live: ChatLive; heard: ChatEvent[] };
	}> {
		const access = chat();
		const heardOne: ChatEvent[] = [];
		const heardOther: ChatEvent[] = [];
		const live = await access.open(asking(), (event) => heardOne.push(event), serve);
		const another = await access.open(
			asking({ thread: { id: SECOND, places: [] } }),
			(event) => heardOther.push(event),
			serve
		);
		return {
			one: { live, heard: heardOne },
			other: { live: another, heard: heardOther }
		};
	}

	it('stand at once, each saying into its own', async () => {
		const { one, other } = await both();

		await one.live.say('About the parser');
		await other.live.say('About the lexer');

		expect(one.heard).toEqual([]);
		expect(other.heard).toEqual([]);
		expect(saidIn).toEqual([THREAD, SECOND]);
		expect(spoken()).toEqual([
			{ role: 'user', content: [{ type: 'text', text: 'About the parser' }] },
			{ role: 'user', content: [{ type: 'text', text: 'About the lexer' }] }
		]);
	});

	it('hear only what the agent answering them said', async () => {
		const { one, other } = await both();

		says(assistant('m1', [{ type: 'text', text: 'Two passes.' }]), THREAD);

		expect(one.heard).toEqual([
			{ event: 'block', at: 0, block: { kind: 'said', said: 'Two passes.' } }
		]);
		expect(other.heard).toEqual([]);
	});

	it('answer a call of one of Sloppy’s own acts under the thread it came from', async () => {
		await both();

		calls('list_notes', {}, 'c1', SECOND);

		await until(() => answers.length === 1);
		expect(answers[0].thread).toBe(SECOND);
	});

	it('end one at a time, and the other stands', async () => {
		const { one, other } = await both();

		await one.live.close();

		expect(closedIn).toEqual([THREAD]);
		expect(one.heard.at(-1)).toEqual({ event: 'over' });
		expect(other.heard).toEqual([]);
		await other.live.say('still here');
		expect(saidIn).toEqual([SECOND]);
	});

	it('are replaced one at a time where a thread is opened again', async () => {
		const access = chat();
		const heardOne: ChatEvent[] = [];
		const heardOther: ChatEvent[] = [];
		await access.open(asking(), (event) => heardOne.push(event), serve);
		const other = await access.open(
			asking({ thread: { id: SECOND, places: [] } }),
			(event) => heardOther.push(event),
			serve
		);

		await access.open(asking(), (event) => heardOne.push(event), serve);

		expect(heardOne.at(-1)).toEqual({ event: 'over' });
		expect(heardOther).toEqual([]);
		expect(opens.map((held) => held.thread)).toEqual([THREAD, SECOND, THREAD]);
		await other.say('still here');
		expect(saidIn).toEqual([SECOND]);
	});
});

describe('what the agent says', () => {
	it('says what it is and what tools it has when it starts', async () => {
		const { heard } = await opened();

		says(INIT);

		expect(heard).toContainEqual({
			event: 'started',
			session: 's1',
			model: 'a-model',
			tools: ['Read', 'mcp__sloppy__write_note']
		});
	});

	it('grows a block at the place it already has as the writing arrives', async () => {
		const { live, heard } = await opened();
		await live.say('go');

		says(messageStart('m1'));
		says(blockStart(0, { type: 'text', text: '' }));
		says(textDelta(0, 'It reads'));
		says(textDelta(0, ' a file.'));
		says(assistant('m1', [{ type: 'text', text: 'It reads a file.' }]));

		expect(heard.filter((event) => event.event === 'block')).toEqual([
			{ event: 'block', at: 0, block: { kind: 'said', said: '' } },
			{ event: 'block', at: 0, block: { kind: 'said', said: 'It reads' } },
			{ event: 'block', at: 0, block: { kind: 'said', said: 'It reads a file.' } },
			{ event: 'block', at: 0, block: { kind: 'said', said: 'It reads a file.' } }
		]);
	});

	/** One message's blocks finish one at a time, each arriving on its own, so
	 *  the second must not land on the first's place. */
	it('keeps the blocks of one message in the places they were started at', async () => {
		const { live, heard } = await opened();
		await live.say('go');

		says(messageStart('m1'));
		says(blockStart(0, { type: 'thinking', thinking: '' }));
		says(assistant('m1', [{ type: 'thinking', thinking: 'Reading it.' }]));
		says(blockStart(1, { type: 'text', text: '' }));
		says(assistant('m1', [{ type: 'text', text: 'It reads a file.' }]));

		expect(heard.filter((event) => event.event === 'block')).toEqual([
			{ event: 'block', at: 0, block: { kind: 'thinking', said: '' } },
			{ event: 'block', at: 0, block: { kind: 'thinking', said: 'Reading it.' } },
			{ event: 'block', at: 1, block: { kind: 'said', said: '' } },
			{ event: 'block', at: 1, block: { kind: 'said', said: 'It reads a file.' } }
		]);
	});

	it("names the act behind a call of Sloppy's, and leaves the agent's own alone", async () => {
		const { live, heard } = await opened();
		await live.say('go');

		says(
			assistant('m1', [
				{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.ts' } },
				{ type: 'tool_use', id: 't2', name: 'mcp__sloppy__write_note', input: { about: 'src' } }
			])
		);

		expect(heard.filter((event) => event.event === 'block')).toEqual([
			{
				event: 'block',
				at: 0,
				block: {
					kind: 'tool_call',
					call: 't1',
					tool: 'Read',
					arguments: { file_path: 'a.ts' },
					at: expect.any(String)
				}
			},
			{
				event: 'block',
				at: 1,
				block: {
					kind: 'tool_call',
					call: 't2',
					tool: 'mcp__sloppy__write_note',
					act: 'write_note',
					arguments: { about: 'src' },
					at: expect.any(String)
				}
			}
		]);
	});

	it('draws what a call came to beside the call it answers', async () => {
		const { live, heard } = await opened();
		await live.say('go');

		says(assistant('m1', [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }]));
		says(
			JSON.stringify({
				type: 'user',
				message: {
					content: [{ type: 'tool_result', tool_use_id: 't1', content: 'it says hello' }]
				}
			})
		);

		expect(heard.at(-1)).toEqual({
			event: 'block',
			at: 1,
			block: { kind: 'tool_result', call: 't1', said: 'it says hello', took: expect.any(Number) }
		});
	});

	/** A call is stamped when it is first seen, so the moment the stream started
	 *  it is the moment its whole message repeats. */
	it('keeps the moment a call was made across the block arriving again', async () => {
		const { live, heard } = await opened();
		await live.say('go');

		says(messageStart('m1'));
		says(blockStart(0, { type: 'tool_use', id: 't1', name: 'Read', input: {} }));
		says(assistant('m1', [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }]));

		const calls = heard.flatMap((event) =>
			event.event === 'block' && event.block.kind === 'tool_call' ? [event.block] : []
		);
		expect(calls).toHaveLength(2);
		expect(calls[0].at).toBe(calls[1].at);
	});

	/** What an answer added to the window is what the agent's next request
	 *  carries, less what it held going into the message that asked and what
	 *  that message wrote. */
	it("costs an answer by the agent's next request, once it comes", async () => {
		const { live, heard } = await opened();
		await live.say('go');

		says(
			assistant('m1', [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }], {
				usage: { input_tokens: 100, output_tokens: 20 }
			})
		);
		says(JSON.stringify({ type: 'user', message: { content: [result('t1', 'it says hello')] } }));
		expect(resultBlocks(heard).at(-1)?.tokens).toBeUndefined();

		says(
			assistant('m2', [{ type: 'text', text: 'Read it.' }], {
				usage: { input_tokens: 300, cache_read_input_tokens: 100 }
			})
		);

		expect(resultBlocks(heard).at(-1)).toMatchObject({
			call: 't1',
			said: 'it says hello',
			tokens: 280
		});
	});

	it('shares that cost evenly among answers that arrived together', async () => {
		const { live, heard } = await opened();
		await live.say('go');

		says(
			assistant(
				'm1',
				[
					{ type: 'tool_use', id: 't1', name: 'Read', input: {} },
					{ type: 'tool_use', id: 't2', name: 'Read', input: {} }
				],
				{ usage: { input_tokens: 100, output_tokens: 30 } }
			)
		);
		says(
			JSON.stringify({
				type: 'user',
				message: { content: [result('t1', 'one'), result('t2', 'two')] }
			})
		);
		says(assistant('m2', [{ type: 'text', text: 'Both.' }], { usage: { input_tokens: 501 } }));

		expect(resultBlocks(heard).slice(-2)).toEqual([
			expect.objectContaining({ call: 't1', tokens: 186 }),
			expect.objectContaining({ call: 't2', tokens: 185 })
		]);
	});

	/** A dialect grows, and an agent that grew one must not end the chat. */
	it('passes over an event it knows nothing about, and a line that is not JSON', async () => {
		const { live, heard } = await opened();
		await live.say('go');

		says(JSON.stringify({ type: 'system', subtype: 'hook_started', hook_name: 'SessionStart' }));
		says(JSON.stringify({ type: 'system', subtype: 'hook_response', output: 'done' }));
		says(JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }));
		says(JSON.stringify({ type: 'something_new', whatever: [1, 2] }));
		says('Debug: starting up');
		says('');
		says(assistant('m1', [{ type: 'text', text: 'still here' }]));

		expect(heard).toEqual([{ event: 'block', at: 0, block: { kind: 'said', said: 'still here' } }]);
	});

	/** A block of a kind this build has no renderer for is carried untouched
	 *  rather than refused, the way a note's own elements are. */
	it('carries a block of a kind it has no renderer for', async () => {
		const { live, heard } = await opened();
		await live.say('go');

		says(assistant('m1', [{ type: 'redacted_thinking', data: 'opaque' }]));

		expect(heard).toEqual([
			{
				event: 'block',
				at: 0,
				block: { kind: 'redacted_thinking', type: 'redacted_thinking', data: 'opaque' }
			}
		]);
	});
});

describe("Sloppy's own acts", () => {
	it('hands a reading act over, and answers the agent with what it came to', async () => {
		serving = async () => ({ said: '{"notes":[]}' });
		const { heard } = await opened();

		calls('list_notes', {});

		await until(() => answers.length === 1);
		expect(served).toEqual([{ call: 'c1', act: 'list_notes', arguments: {} }]);
		expect(answers[0]).toEqual({
			thread: THREAD,
			call: 'c1',
			said: '{"notes":[]}',
			trouble: false
		});
		expect(heard).toEqual([]);
	});

	it("tells the agent what the act's own shape refused, and hands nothing over", async () => {
		await opened();

		calls('write_note', { about: '../elsewhere/secrets.ts', sections: [] });

		await until(() => answers.length === 1);
		expect(answers[0]).toEqual({
			thread: THREAD,
			call: 'c1',
			said: 'That place is outside this project.',
			trouble: true
		});
		expect(served).toEqual([]);
	});

	// The page is never told about this one, so a record somebody turned on is
	// the only place it leaves a mark.
	it('leaves a call it refused in the record of what happened', async () => {
		whatHappened.record(true);
		await opened();

		calls('write_note', { about: '../elsewhere/secrets.ts', sections: [] });

		await until(() => answers.length === 1);
		expect(whatHappened.kept.map((one) => one.said)).toContain(
			'writing a note was refused before it ran: That place is outside this project.'
		);
		whatHappened.record(false);
		whatHappened.clear();
	});

	it('tells the agent what could not be done rather than leaving it waiting', async () => {
		serving = async () => {
			throw new Error('the store said no');
		};
		await opened();

		calls('list_notes', {});

		await until(() => answers.length === 1);
		expect(answers[0]).toEqual({
			thread: THREAD,
			call: 'c1',
			said: 'Sloppy could not do that.',
			trouble: true
		});
	});

	it('tells the agent so where the answer itself is not one it could read', async () => {
		serving = async () => ({ said: 12 }) as unknown as ChatToolAnswer;
		await opened();

		calls('list_notes', {});

		await until(() => answers.length === 1);
		expect(answers[0]).toMatchObject({ call: 'c1', trouble: true });
	});
});

describe('a write', () => {
	it('lands like a reading act, with nothing asked of anybody', async () => {
		const { heard } = await opened();

		calls('write_note', { about: PARSER, ...WROTE });

		await until(() => answers.length === 1);
		expect(served).toEqual([
			{ call: 'c1', act: 'write_note', arguments: { about: PARSER, ...WROTE } }
		]);
		expect(answers[0]).toEqual({
			thread: THREAD,
			call: 'c1',
			said: 'Written to The reader.',
			trouble: false
		});
		expect(heard).toEqual([]);
	});

	it('answers every one of them, however many arrive at once', async () => {
		await opened();

		calls('write_note', { about: PARSER, ...WROTE }, 'c1');
		calls('write_note', { about: 'src/lexer.ts', ...WROTE }, 'c2');
		calls('write_note', { about: 'src/emit.ts', ...WROTE }, 'c3');

		await until(() => answers.length === 3);
		expect(answers.map((one) => one.call)).toEqual(['c1', 'c2', 'c3']);
		expect(served).toHaveLength(3);
	});
});

describe('the draft a chat works in', () => {
	it('is taken of the notes where none is standing', async () => {
		await opened();

		expect(started).toEqual([{ root: NOTES, id: standing[0].id }]);
		expect(standing[0].root).toBe(`${COPIES}/${standing[0].id}`);
	});

	it('works in the one already standing rather than taking a second', async () => {
		standing = [copy(THREAD)];

		await opened();

		expect(started).toEqual([]);
		expect(opens[0].root).toBe(`${COPIES}/${THREAD}`);
	});

	it('takes one copy where a page and a session ask for it at once', async () => {
		const held = drafts();

		const [one, other] = await Promise.all([held.start(THREAD), held.start(THREAD)]);

		expect(started).toHaveLength(1);
		expect(one).toEqual(other);
	});

	it('says what to do rather than taking a copy of nothing', async () => {
		notes = undefined;
		const held = drafts();

		expect(await held.standing()).toEqual([]);
		await expect(held.start(THREAD)).rejects.toThrow('Open the notes you want a draft of first.');
	});

	it('reaches the copy at the project and its states at the notes inside it', async () => {
		const held = drafts();
		const draft = await held.start(THREAD);

		expect(held.files(draft).root).toBe(draft.root);
		await held.history(draft).currentCommit();

		expect(headsAt).toEqual([draft.vault]);
	});

	it('stands through the turn being stopped and the session being closed', async () => {
		const { access, live } = await opened();
		const draft = standing[0];
		await live.say('go');

		const stopping = live.stop();
		await until(() => lines.length === 2);
		says(RESULT);
		await stopping;
		await live.close();

		expect(discarded).toEqual([]);
		expect(await access.drafts?.standing()).toEqual([draft]);
	});

	it('is gone once the person discards it', async () => {
		const { access } = await opened();
		const draft = standing[0];

		await access.drafts?.discard(draft);

		expect(discarded).toEqual([{ root: NOTES, id: draft.id }]);
		expect(await access.drafts?.standing()).toEqual([]);
	});

	/** A person keeps as many chats as they like, and each writes into its own
	 *  copy, so neither thread's writing lands in the other's. */
	it('is one per chat, and two of them stand at once', async () => {
		const access = chat();

		await access.open(asking(), () => {}, serve);
		await access.open(asking({ thread: { id: SECOND, places: [] } }), () => {}, serve);

		expect((await access.drafts?.standing())?.map((one) => one.id)).toEqual([THREAD, SECOND]);
		expect(opens.map((one) => one.root)).toEqual([`${COPIES}/${THREAD}`, `${COPIES}/${SECOND}`]);
	});
});

describe('the conversation a chat is opened as', () => {
	it('is one of its own where no agent has opened this chat before', async () => {
		await opened();

		expect(opens[0].resume).toBe(false);
		expect(opens[0].session).toBeUndefined();
	});

	/** Everything said in it is still there, which is what makes reopening a
	 *  chat different from starting one about the same thing. */
	it('is the one left off where the chat has one', async () => {
		await chat().open(
			asking({ thread: { id: THREAD, session: 'the-conversation', places: [] } }),
			() => {},
			serve
		);

		expect(opens[0].resume).toBe(true);
		expect(opens[0].session).toBe('the-conversation');
	});

	it('is one of its own again where the agent would not pick that one up', async () => {
		const heard: ChatEvent[] = [];
		const access = chat();
		await access.open(
			asking({ thread: { id: THREAD, session: 'long-gone', places: [] } }),
			(event) => heard.push(event),
			serve
		);

		// The agent turns the session down and ends without ever saying what it
		// is — which is a line about a turn nobody took, and then the program.
		says(
			JSON.stringify({
				type: 'result',
				subtype: 'error_during_execution',
				is_error: true,
				num_turns: 0,
				session_id: 'long-gone',
				errors: ['No conversation found with session ID: long-gone']
			})
		);
		tells({ from: 'over', stopped: false, trouble: null });
		await until(() => opens.length === 2);

		expect(opens[1].resume).toBe(false);
		expect(opens[1].session).toBeUndefined();
		// Nothing is said about a session nobody saw; what the page is told is
		// the conversation that did answer, which is not the one it asked for.
		expect(heard).toEqual([]);
		// And nothing was asked of the program that refused, so the one taking
		// its place is not left answering a question about a window it never had.
		expect(askedAbout()).toEqual([]);
		says(INIT);
		expect(heard).toContainEqual(
			expect.objectContaining({ event: 'started', session: 's1' }) as ChatEvent
		);
	});

	it('is over for good where the agent said what it was and then stopped', async () => {
		const heard: ChatEvent[] = [];
		const access = chat();
		await access.open(
			asking({ thread: { id: THREAD, session: 'the-conversation', places: [] } }),
			(event) => heard.push(event),
			serve
		);
		says(INIT);

		tells({ from: 'over', stopped: false, trouble: 'Sign in to keep going.' });

		expect(opens).toHaveLength(1);
		expect(heard.at(-1)).toEqual({ event: 'over', said: 'Sign in to keep going.' });
	});
});

describe('the places a chat reads', () => {
	const PLACES = [
		{ root: '/work/lexer', name: 'lexer', graph: THEIRS },
		{ root: '/work/old/lexer', name: 'old/lexer', graph: ALSO_THEIRS }
	];

	it('are given to the agent every time, because none can be added to one running', async () => {
		const access = chat();

		await access.open(asking({ thread: { id: THREAD, places: PLACES } }), () => {}, serve);
		await access.open(
			asking({ thread: { id: THREAD, session: 'the-conversation', places: PLACES } }),
			() => {},
			serve
		);

		expect(opens[0].places).toEqual(['/work/lexer', '/work/old/lexer']);
		expect(opens[1].places).toEqual(['/work/lexer', '/work/old/lexer']);
	});

	it('are none for a chat that reads nothing but its own project', async () => {
		await opened();

		expect(opens[0].places).toEqual([]);
	});
});

describe('what the agent says is in its window', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	/** A chat open, the agent introduced, and the one ask that follows already
	 *  written out. */
	async function introduced(): Promise<ChatEvent[]> {
		const heard: ChatEvent[] = [];
		await chat().open(asking(), (event) => heard.push(event), serve);
		says(INIT);
		await until(() => askedAbout().length === 1);
		return heard;
	}

	it('is asked for as soon as the agent has said what it is', async () => {
		await introduced();

		expect(askedAbout()[0]).toMatchObject({
			type: 'control_request',
			request: { subtype: 'get_context_usage', detail: 'summary' }
		});
	});

	it('is asked for again once a turn has ended', async () => {
		const live = await chat().open(asking(), () => {}, serve);
		says(INIT);
		await until(() => askedAbout().length === 1);
		await live.say('go');

		says(RESULT);

		await until(() => askedAbout().length === 2);
	});

	/** The parts are the agent's own, named and counted as it gave them, and
	 *  what it holds ASIDE is never in what the window is holding. */
	it('is the breakdown it answers with, with what it holds aside left out', async () => {
		const heard = await introduced();

		says(breakdown(waitingOn()));

		const usage = windowNow(heard);
		expect(usage.parts.map((one) => one.name)).toEqual([
			'System prompt',
			'Messages',
			'Free space',
			'Autocompact buffer',
			'Tool definitions'
		]);
		expect(usedIn(usage)).toBe(15_000);
		expect(heldAsideIn(usage)).toBe(9_000);
		expect(usage.total).toBe(15_000);
		expect(usage.limit).toBe(WINDOW);
		expect(usage.compactsAt).toBe(160_000);
	});

	it('says nothing about where room is made for an agent that never makes any', async () => {
		const heard = await introduced();

		says(breakdown(waitingOn(), { isAutoCompactEnabled: false }));

		expect(windowNow(heard).compactsAt).toBeUndefined();
	});

	/** Between one breakdown and the next, the agent's own requests say how full
	 *  the window is; the parts stay as of the last ask and only the total
	 *  moves. */
	it('follows what the agent is carrying between one breakdown and the next', async () => {
		const heard = await introduced();
		says(breakdown(waitingOn()));
		const asked = heard.length;

		// Under a fiftieth of the window: not worth redrawing for.
		says(carrying(17_000));
		expect(heard).toHaveLength(asked);

		says(carrying(20_000, 5_000));
		expect(windowNow(heard)).toMatchObject({ total: 25_000, limit: WINDOW, parts: [] });
	});

	it('draws down to what is left once the agent has made room', async () => {
		const heard = await introduced();
		says(breakdown(waitingOn()));

		says(
			JSON.stringify({
				type: 'system',
				subtype: 'compact_boundary',
				compact_metadata: { trigger: 'auto', pre_tokens: 150_000, post_tokens: 20_000 }
			})
		);

		expect(windowNow(heard)).toMatchObject({
			total: 20_000,
			compacted: { from: 150_000 },
			parts: []
		});
	});

	/** An agent re-introduces itself after making room, and that is what has it
	 *  told again about the places it may read. */
	it('says the agent started again where it starts again', async () => {
		const heard = await introduced();

		says(INIT);

		expect(heard.filter((one) => one.event === 'started')).toHaveLength(2);
	});

	it('is asked for in words where the agent answers no other way', async () => {
		vi.useFakeTimers();
		const heard: ChatEvent[] = [];
		await chat().open(asking(), (event) => heard.push(event), serve);
		says(INIT);
		await vi.advanceTimersByTimeAsync(0);

		await vi.advanceTimersByTimeAsync(8_000);

		expect(askedAbout()).toHaveLength(2);
		expect(spoken()).toEqual([{ role: 'user', content: [{ type: 'text', text: '/context' }] }]);
	});

	/** What the agent writes answering a question nobody typed is the chart's,
	 *  so none of it reaches the thread. */
	it('reads the answer in words and shows none of it in the thread', async () => {
		vi.useFakeTimers();
		const heard: ChatEvent[] = [];
		await chat().open(asking(), (event) => heard.push(event), serve);
		says(INIT);
		await vi.advanceTimersByTimeAsync(8_000);

		says(breakdownInWords('Here is what I am holding.', 4_000));
		says(RESULT);

		expect(windowNow(heard)).toMatchObject({ total: 4_000, limit: WINDOW });
		expect(usedIn(windowNow(heard))).toBe(4_000);
		expect(heldAsideIn(windowNow(heard))).toBe(9_000);
		expect(heard.filter((one) => one.event === 'block')).toEqual([]);
		expect(heard.filter((one) => one.event === 'ended')).toEqual([]);
	});

	/** The answer in words carries no window of its own BEFORE the agent has
	 *  said what the window is, which is the first thing asked for — so the
	 *  count has to come out of the answer itself. */
	it('reads the window out of the answer in words with nothing said before it', async () => {
		vi.useFakeTimers();
		const heard: ChatEvent[] = [];
		await chat().open(asking(), (event) => heard.push(event), serve);
		says(INIT);
		await vi.advanceTimersByTimeAsync(8_000);

		says(breakdownInWords('Here is what I am holding.', 4_000));

		expect(windowNow(heard).limit).toBe(WINDOW);
	});

	/** An agent that says it cannot answer has answered: nothing is gained by
	 *  waiting the rest of the timeout out before asking the other way. */
	it('is asked for in words as soon as the agent says it cannot answer that way', async () => {
		vi.useFakeTimers();
		const live = await chat().open(asking(), () => {}, serve);
		says(INIT);
		await vi.advanceTimersByTimeAsync(0);
		await live.say('go');
		says(noBreakdown(waitingOn()));
		says(RESULT);
		await vi.advanceTimersByTimeAsync(0);

		expect(spoken()).toContainEqual({
			role: 'user',
			content: [{ type: 'text', text: '/context' }]
		});
	});

	it('is asked in words from the start once the agent has answered no other way', async () => {
		vi.useFakeTimers();
		const live = await chat().open(asking(), () => {}, serve);
		says(INIT);
		await vi.advanceTimersByTimeAsync(8_000);
		says(RESULT);
		await vi.advanceTimersByTimeAsync(0);
		lines.length = 0;

		await live.context?.('summary');

		expect(askedAbout()).toHaveLength(1);
		expect(askedAbout()[0].type).toBe('user');
	});

	/** It is what the chart offers a refresh on, so a shell that cannot ask is
	 *  one that offers nothing. */
	it('is something this shell can be asked for on any conversation it opens', async () => {
		const { live } = await opened();

		expect(live.context).toBeDefined();
	});

	it('is nothing to ask about once the conversation is over', async () => {
		const { live } = await opened();
		await live.close();
		lines.length = 0;

		await expect(live.context?.('summary')).resolves.toBeUndefined();
		expect(lines).toEqual([]);
	});

	/** An agent grows what it says, and a kind of line this build knows nothing
	 *  about must not end a chat or be drawn as one of its own. */
	it('passes over what it says that is about neither the turn nor the window', async () => {
		const heard = await introduced();
		const before = heard.length;

		for (const line of [
			JSON.stringify({ type: 'rate_limit_event', reset_at: 1 }),
			JSON.stringify({ type: 'system', subtype: 'status', status: 'compacting' }),
			JSON.stringify({ type: 'system', subtype: 'thinking_tokens', tokens: 12 })
		]) {
			says(line);
		}

		expect(heard).toHaveLength(before);
	});
});

describe('what the agent is told before it hears anybody', () => {
	it('is sent the brief, so it knows it is in Sloppy at all', async () => {
		await chat().open(asking(), () => {}, serve);

		const { brief } = opens[0];
		expect(brief).toContain('.sloppy/AGENT.md');
		expect(brief).toContain('belongs in a note');
		// The one thing it got wrong without this: offering to write a file.
		expect(brief).toContain('cannot write or change any file in this project');
		// A thread with no places beside its own project says nothing about any.
		expect(brief).not.toContain('You may also read these places');
	});

	it('names the places that thread reads, because a name is how it asks for one', async () => {
		await chat().open(
			asking({
				thread: {
					id: THREAD,
					places: [
						{ root: '/work/lexer', name: 'lexer', graph: THEIRS },
						{ root: '/work/old/lexer', name: 'old/lexer', graph: ALSO_THEIRS }
					]
				}
			}),
			() => {},
			serve
		);

		expect(opens[0].brief).toContain('You may also read these places: lexer, old/lexer');
	});

	it('answers with the model somebody chose, and with none where they chose nothing', async () => {
		await chat().open(asking({ model: 'opus' }), () => {}, serve);
		expect(opens[0].model).toBe('opus');

		await chat().open(asking(), () => {}, serve);
		expect(opens[1].model).toBeUndefined();
	});
});
