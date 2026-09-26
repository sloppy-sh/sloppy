import type { ChatAccess } from '@sloppy/app-core';
import { CHAT_TOOLS, type ChatEvent, type ChatToolAnswer, type ChatToolCall } from '@sloppy/types';
import { beforeEach, describe, expect, it } from 'vitest';
import { tauriChat, type Telling, type Told } from './chat';

const PROJECT = '/work/compiler';
const PARSER = 'src/parser.ts';

/** The agents this device has, as `chat_agents` answers. */
let here: string[];
let opens: { agent: string; root: string; tools: { name: string }[] }[];
/** Every line written onto the agent's own input. */
let lines: string[];
let answers: { call: string; said: string; trouble: boolean }[];
let closes: number;
/** What the session is told over, which the shell takes and the tests speak
 *  into. */
let channel: Telling;

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
		case 'chat_open':
			opens.push({
				agent: held.agent as string,
				root: held.root as string,
				tools: held.tools as { name: string }[]
			});
			channel = held.heard as Telling;
			return undefined as T;
		case 'chat_say':
			lines.push(held.line as string);
			return undefined as T;
		case 'chat_answer':
			answers.push({
				call: held.call as string,
				said: held.said as string,
				trouble: held.trouble as boolean
			});
			return undefined as T;
		case 'chat_close':
			closes += 1;
			queueMicrotask(() => tells({ from: 'over', stopped: true, trouble: null }));
			return undefined as T;
	}
	throw new Error(`no such command: ${command}`);
};

function tells(told: Told): void {
	channel.onmessage(told);
}

function says(line: string): void {
	tells({ from: 'said', line });
}

function calls(act: string, args: unknown, id = 'c1'): void {
	tells({ from: 'called', call: id, act, arguments: args });
}

function chat(): ChatAccess {
	return tauriChat(project, call, () => channel);
}

/** A session open and saying nothing yet, with everything it tells the page
 *  collected. */
async function opened(): Promise<{ access: ChatAccess; heard: ChatEvent[] }> {
	const heard: ChatEvent[] = [];
	const access = chat();
	await access.open({}, (event) => heard.push(event), serve);
	return { access, heard };
}

/** The person's answer to the question in the thread, given once it is there. */
async function answersIt(
	access: ChatAccess,
	heard: readonly ChatEvent[],
	allowed: boolean,
	call = 'c1'
): Promise<void> {
	await until(() => heard.some((event) => event.event === 'asking' && event.call === call));
	await access.settle(call, allowed);
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

function assistant(id: string, content: unknown[]): string {
	return JSON.stringify({ type: 'assistant', message: { id, content } });
}

const WROTE = { sections: ['## What it does\n\nIt reads a file and hands back the sections.'] };

beforeEach(() => {
	here = ['claude_code'];
	opens = [];
	lines = [];
	answers = [];
	closes = 0;
	channel = { onmessage: () => {} };
	served = [];
	serving = async () => ({ said: 'Written to The reader.' });
});

describe('the agents this device can reach', () => {
	it('answers only the ones it knows', async () => {
		here = ['claude_code', 'something_else'];

		expect(await chat().agents()).toEqual(['claude_code']);
	});

	it('says what to install where a chat is opened anyway', async () => {
		here = [];

		await expect(chat().open({}, () => {}, serve)).rejects.toThrow(
			'Sloppy has nothing on this computer to chat with. Install Claude Code and try again.'
		);
	});

	it('says which one is missing where somebody chose it', async () => {
		here = [];

		await expect(chat().open({ agent: 'claude_code' }, () => {}, serve)).rejects.toThrow(
			'Claude Code is not on this computer. Install it and try again.'
		);
	});
});

describe('a session', () => {
	it('starts the agent in the project, handing it every act Sloppy has', async () => {
		await opened();

		expect(opens[0].agent).toBe('claude_code');
		expect(opens[0].root).toBe(PROJECT);
		expect(opens[0].tools.map((tool) => tool.name)).toEqual([...CHAT_TOOLS]);
	});

	it('says there is no project to chat about where none is open', async () => {
		const access = tauriChat(
			async () => undefined,
			call,
			() => channel
		);

		await expect(access.open({}, () => {}, serve)).rejects.toThrow(
			'Open the project these notes are about first.'
		);
	});

	it("says what somebody typed onto the agent's own input", async () => {
		const { access } = await opened();

		await access.say('Say what the reader does');

		expect(JSON.parse(lines[0])).toEqual({
			type: 'user',
			message: { role: 'user', content: [{ type: 'text', text: 'Say what the reader does' }] }
		});
	});

	it('asks for something to be said rather than starting a turn on nothing', async () => {
		const { access } = await opened();

		await expect(access.say('   ')).rejects.toThrow('Say what you want written about.');
		expect(lines).toEqual([]);
	});

	it('refuses a second thing said while the turn is underway', async () => {
		const { access } = await opened();
		await access.say('first');

		await expect(access.say('second')).rejects.toThrow('Wait for the answer');
		expect(lines).toHaveLength(1);
	});

	it('goes on with the session once the turn has ended', async () => {
		const { access, heard } = await opened();
		await access.say('first');

		says(RESULT);
		await access.say('second');

		expect(heard).toContainEqual({ event: 'ended' });
		expect(lines).toHaveLength(2);
	});

	it('says nothing about why where the session simply ended', async () => {
		const { access, heard } = await opened();

		await access.close();

		expect(closes).toBe(1);
		expect(heard.at(-1)).toEqual({ event: 'over' });
	});

	it('hands on what the agent said about its own trouble', async () => {
		const { heard } = await opened();

		tells({ from: 'over', stopped: false, trouble: 'Sign in to keep going.' });

		expect(heard.at(-1)).toEqual({ event: 'over', said: 'Sign in to keep going.' });
	});

	it('says nothing more into a chat that is over', async () => {
		const { access } = await opened();
		await access.close();

		await expect(access.say('again')).rejects.toThrow('That chat is over.');
	});

	it('ends the turn on the person stopping it, and keeps the session', async () => {
		const { access, heard } = await opened();
		await access.say('first');

		const stopping = access.stop();
		await until(() => lines.length === 2);
		says(RESULT);
		await stopping;

		expect(JSON.parse(lines[1])).toMatchObject({
			type: 'control_request',
			request: { subtype: 'interrupt' }
		});
		expect(heard).toContainEqual({ event: 'ended', stopped: true });
		await access.say('second');
	});

	it('is not a failure to stop where no turn is underway', async () => {
		const { access } = await opened();

		await access.stop();

		expect(lines).toEqual([]);
	});

	it('lets go of a session another was opened over', async () => {
		const { access, heard } = await opened();

		await access.open({}, () => {}, serve);

		expect(heard.at(-1)).toEqual({ event: 'over' });
		expect(opens).toHaveLength(2);
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
		const { access, heard } = await opened();
		await access.say('go');

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
		const { access, heard } = await opened();
		await access.say('go');

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
		const { access, heard } = await opened();
		await access.say('go');

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
				block: { kind: 'tool_call', call: 't1', tool: 'Read', arguments: { file_path: 'a.ts' } }
			},
			{
				event: 'block',
				at: 1,
				block: {
					kind: 'tool_call',
					call: 't2',
					tool: 'mcp__sloppy__write_note',
					act: 'write_note',
					arguments: { about: 'src' }
				}
			}
		]);
	});

	it('draws what a call came to beside the call it answers', async () => {
		const { access, heard } = await opened();
		await access.say('go');

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
			block: { kind: 'tool_result', call: 't1', said: 'it says hello' }
		});
	});

	/** A dialect grows, and an agent that grew one must not end the chat. */
	it('passes over an event it knows nothing about, and a line that is not JSON', async () => {
		const { access, heard } = await opened();
		await access.say('go');

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
		const { access, heard } = await opened();
		await access.say('go');

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
	it('hands a reading act over with no question, and answers the agent with it', async () => {
		serving = async () => ({ said: '{"notes":[]}' });
		const { heard } = await opened();

		calls('list_notes', {});

		await until(() => answers.length === 1);
		expect(served).toEqual([{ call: 'c1', act: 'list_notes', arguments: {} }]);
		expect(answers[0]).toEqual({ call: 'c1', said: '{"notes":[]}', trouble: false });
		expect(heard.filter((event) => event.event === 'asking')).toEqual([]);
	});

	it("tells the agent what the act's own shape refused, and hands nothing over", async () => {
		await opened();

		calls('write_note', { about: '../elsewhere/secrets.ts', sections: [] });

		await until(() => answers.length === 1);
		expect(answers[0]).toEqual({
			call: 'c1',
			said: 'That place is outside this project.',
			trouble: true
		});
		expect(served).toEqual([]);
	});

	it('tells the agent what could not be done rather than leaving it waiting', async () => {
		serving = async () => {
			throw new Error('the store said no');
		};
		await opened();

		calls('list_notes', {});

		await until(() => answers.length === 1);
		expect(answers[0]).toEqual({ call: 'c1', said: 'Sloppy could not do that.', trouble: true });
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
	it('reaches the act only once the person has allowed it', async () => {
		const { access, heard } = await opened();

		calls('write_note', { about: PARSER, ...WROTE });

		await until(() => heard.some((event) => event.event === 'asking'));
		expect(heard.at(-1)).toEqual({
			event: 'asking',
			call: 'c1',
			act: 'write_note',
			arguments: { about: PARSER, ...WROTE }
		});
		expect(served).toEqual([]);

		await access.settle('c1', true);

		await until(() => answers.length === 1);
		expect(heard).toContainEqual({ event: 'settled', call: 'c1', allowed: true });
		expect(served).toEqual([
			{ call: 'c1', act: 'write_note', arguments: { about: PARSER, ...WROTE } }
		]);
		expect(answers[0].said).toBe('Written to The reader.');
	});

	it('never reaches the act where the person turned it down', async () => {
		const { access, heard } = await opened();
		calls('write_note', { about: PARSER, ...WROTE });

		await answersIt(access, heard, false);

		await until(() => answers.length === 1);
		expect(heard).toContainEqual({ event: 'settled', call: 'c1', allowed: false });
		expect(served).toEqual([]);
		expect(answers[0]).toMatchObject({ trouble: true });
		expect(answers[0].said).toContain('turned that down');
	});

	it('answers a call nobody answered where the session ended under the question', async () => {
		const { access, heard } = await opened();
		calls('write_note', { about: PARSER, ...WROTE });
		await until(() => heard.some((event) => event.event === 'asking'));

		await access.close();

		await until(() => answers.length === 1);
		expect(heard.map((event) => event.event)).toEqual(['asking', 'settled', 'over']);
		expect(served).toEqual([]);
		expect(answers[0]).toMatchObject({ trouble: true });
	});
});
