import { whatHappened, type ChatAccess } from '@sloppy/app-core';
import {
	CHAT_TOOLS,
	draftBranch,
	type ChatEvent,
	type ChatToolAnswer,
	type ChatToolCall,
	type StandingDraft
} from '@sloppy/types';
import { beforeEach, describe, expect, it } from 'vitest';
import { tauriChat, type Telling, type Told } from './chat';
import { tauriDrafts, type DraftAccess } from './draft';
import { tauriFiles } from './files';

const PROJECT = '/work/compiler';
const NOTES = `${PROJECT}/.sloppy`;
const PARSER = 'src/parser.ts';

/** Where this app keeps its own copies, as `draft_start` answers them. */
const COPIES = '/data/drafts';
const STOOD = '01JAPART000000000000000000';

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
let opens: {
	agent: string;
	root: string;
	tools: { name: string }[];
	brief: string;
	model?: string;
}[];
/** Every line written onto the agent's own input. */
let lines: string[];
let answers: { call: string; said: string; trouble: boolean }[];
let closes: number;
/** What the session is told over, which the shell takes and the tests speak
 *  into. */
let channel: Telling;

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
		case 'chat_open':
			{
				const asked = held.asked as {
					agent: string;
					root: string;
					tools: { name: string }[];
					brief: string;
					model?: string;
				};
				opens.push({
					agent: asked.agent,
					root: asked.root,
					tools: asked.tools,
					brief: asked.brief,
					...(asked.model === undefined ? {} : { model: asked.model })
				});
			}
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
		case 'draft_standing':
			return standing as T;
		case 'draft_start': {
			const made = copy(held.id as string);
			started.push({ root: held.root as string, id: made.id });
			standing = [made];
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

function tells(told: Told): void {
	channel.onmessage(told);
}

function says(line: string): void {
	tells({ from: 'said', line });
}

function calls(act: string, args: unknown, id = 'c1'): void {
	tells({ from: 'called', call: id, act, arguments: args });
}

function drafts(): DraftAccess {
	return tauriDrafts(
		() => notes,
		tauriFiles('', call, (path) => path),
		call
	);
}

function chat(): ChatAccess {
	return tauriChat(project, drafts(), call, () => channel);
}

/** A session open and saying nothing yet, with everything it tells the page
 *  collected. */
async function opened(): Promise<{ access: ChatAccess; heard: ChatEvent[] }> {
	const heard: ChatEvent[] = [];
	const access = chat();
	await access.open({}, (event) => heard.push(event), serve);
	return { access, heard };
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

		await expect(access.open({}, () => {}, serve)).rejects.toThrow(
			'Open the project these notes are about first.'
		);
		expect(started).toEqual([]);
	});

	it('starts the agent in the project itself where this shell keeps no draft', async () => {
		const access = tauriChat(project, undefined, call, () => channel);

		await access.open({}, () => {}, serve);

		expect(opens[0].root).toBe(PROJECT);
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
	it('hands a reading act over, and answers the agent with what it came to', async () => {
		serving = async () => ({ said: '{"notes":[]}' });
		const { heard } = await opened();

		calls('list_notes', {});

		await until(() => answers.length === 1);
		expect(served).toEqual([{ call: 'c1', act: 'list_notes', arguments: {} }]);
		expect(answers[0]).toEqual({ call: 'c1', said: '{"notes":[]}', trouble: false });
		expect(heard).toEqual([]);
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
	it('lands like a reading act, with nothing asked of anybody', async () => {
		const { heard } = await opened();

		calls('write_note', { about: PARSER, ...WROTE });

		await until(() => answers.length === 1);
		expect(served).toEqual([
			{ call: 'c1', act: 'write_note', arguments: { about: PARSER, ...WROTE } }
		]);
		expect(answers[0]).toEqual({ call: 'c1', said: 'Written to The reader.', trouble: false });
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
		standing = [copy(STOOD)];

		await opened();

		expect(started).toEqual([]);
		expect(opens[0].root).toBe(`${COPIES}/${STOOD}`);
	});

	it('takes one copy where a page and a session ask for it at once', async () => {
		const held = drafts();

		const [one, other] = await Promise.all([held.start(), held.start()]);

		expect(started).toHaveLength(1);
		expect(one).toEqual(other);
	});

	it('says what to do rather than taking a copy of nothing', async () => {
		notes = undefined;
		const held = drafts();

		expect(await held.standing()).toBeUndefined();
		await expect(held.start()).rejects.toThrow('Open the notes you want a draft of first.');
	});

	it('reaches the copy at the project and its states at the notes inside it', async () => {
		const held = drafts();
		const draft = await held.start();

		expect(held.files(draft).root).toBe(draft.root);
		await held.history(draft).currentCommit();

		expect(headsAt).toEqual([draft.vault]);
	});

	it('stands through the turn being stopped and the session being closed', async () => {
		const { access } = await opened();
		const draft = standing[0];
		await access.say('go');

		const stopping = access.stop();
		await until(() => lines.length === 2);
		says(RESULT);
		await stopping;
		await access.close();

		expect(discarded).toEqual([]);
		expect(await access.drafts?.standing()).toEqual(draft);
	});

	it('is gone once the person discards it', async () => {
		const { access } = await opened();
		const draft = standing[0];

		await access.drafts?.discard(draft);

		expect(discarded).toEqual([{ root: NOTES, id: draft.id }]);
		expect(await access.drafts?.standing()).toBeUndefined();
	});
});

describe('what the agent is told before it hears anybody', () => {
	it('is sent the brief, so it knows it is in Sloppy at all', async () => {
		await chat().open({}, () => {}, serve);

		const { brief } = opens[0];
		expect(brief).toContain('.sloppy/AGENT.md');
		expect(brief).toContain('belongs in a note');
		// The one thing it got wrong without this: offering to write a file.
		expect(brief).toContain('cannot write or change any file in this project');
	});

	it('answers with the model somebody chose, and with none where they chose nothing', async () => {
		await chat().open({ model: 'opus' }, () => {}, serve);
		expect(opens[0].model).toBe('opus');

		await chat().open({}, () => {}, serve);
		expect(opens[1].model).toBeUndefined();
	});
});
