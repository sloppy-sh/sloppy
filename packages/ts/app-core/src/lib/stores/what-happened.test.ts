// The record a person turns on before doing the thing that went wrong again.
// What must NOT be in it is as much of this as what must.

import 'fake-indexeddb/auto';
import { SloppyApiError } from '@sloppy/client';
import { MemoryFiles } from '@sloppy/local';
import type {
	ChatActDone,
	ChatAgent,
	ChatCallId,
	ChatEvent,
	ChatToolAnswer,
	ChatToolCall
} from '@sloppy/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initRuntime, type ChatAccess, type ChatAsked } from '../runtime.js';
import { ref } from './fake-api.test-support.js';
import { chat } from './chat.svelte.js';
import { prefs } from './prefs.svelte.js';
import { MOST_KEPT, whatHappened } from './what-happened.svelte.js';

const acting = vi.hoisted(() => ({ answer: { said: '{}' } as ChatActDone }));

vi.mock('../chat-acts.js', () => ({
	serveChatCall: () => Promise.resolve(acting.answer)
}));

const CALL = 'c1';

/** A write the agent asked for, as the shell hands one to the page. */
function writing(asked: Record<string, unknown> = {}): ChatToolCall {
	return { call: CALL, act: 'write_note', arguments: asked } as ChatToolCall;
}

class Stub implements ChatAccess {
	#hear: ((event: ChatEvent) => void) | null = null;
	#serve: ((call: ChatToolCall) => Promise<ChatToolAnswer>) | null = null;

	agents(): Promise<ChatAgent[]> {
		return Promise.resolve(['claude_code']);
	}

	open(
		_asked: ChatAsked,
		hear: (event: ChatEvent) => void,
		serve: (call: ChatToolCall) => Promise<ChatToolAnswer>
	): Promise<void> {
		this.#hear = hear;
		this.#serve = serve;
		return Promise.resolve();
	}

	say(): Promise<void> {
		return Promise.resolve();
	}

	settle(call: ChatCallId, allowed: boolean): Promise<void> {
		this.tell({ event: 'settled', call, allowed });
		return Promise.resolve();
	}

	stop(): Promise<void> {
		return Promise.resolve();
	}

	close(): Promise<void> {
		return Promise.resolve();
	}

	tell(event: ChatEvent): void {
		this.#hear?.(event);
	}

	serve(call: ChatToolCall): Promise<ChatToolAnswer> {
		if (!this.#serve) throw new Error('nothing is serving');
		return this.#serve(call);
	}
}

/** What the record says, as one string to look through. */
const said = (): string => whatHappened.kept.map((one) => one.said).join(' | ');

/** A failure nobody wrote a path for, as the window hands one over. */
function reject(reason: unknown): void {
	const event = new Event('unhandledrejection') as Event & { reason?: unknown };
	event.reason = reason;
	window.dispatchEvent(event);
}

let stub: Stub;

beforeEach(() => {
	localStorage.clear();
	prefs.init();
	whatHappened.clear();
	chat.clear();
	acting.answer = { said: '{}' };
	stub = new Stub();
	initRuntime({
		apiHost: () => 'http://api.test',
		chat: stub,
		project: async () =>
			new MemoryFiles({ root: '/home/ada/code', store: new Map(), data: '/data' })
	});
});

afterEach(() => {
	chat.clear();
	whatHappened.clear();
	localStorage.clear();
});

describe('the record', () => {
	it('is off until somebody turns it on', () => {
		expect(whatHappened.on).toBe(false);
		whatHappened.put('act', 'writing a note began');
		expect(whatHappened.kept).toEqual([]);
	});

	it('keeps what happened, with the time and the act it is part of', () => {
		whatHappened.record(true);
		whatHappened.put('act', 'writing a note began', CALL);
		const [one] = whatHappened.kept;
		expect(one.kind).toBe('act');
		expect(one.said).toBe('writing a note began');
		expect(one.call).toBe(CALL);
		expect(Number.isNaN(Date.parse(one.at))).toBe(false);
		expect(whatHappened.asText()).toContain('writing a note began');
		expect(whatHappened.asText()).toContain(CALL);
	});

	it('stops when it is turned off, and keeps what it has to hand over', () => {
		whatHappened.record(true);
		whatHappened.put('turn', 'a turn began');
		whatHappened.record(false);
		whatHappened.put('turn', 'the turn ended');
		expect(said()).toBe('a turn began');
	});

	it('is the last so many and never grows past them', () => {
		whatHappened.record(true);
		for (let one = 0; one < MOST_KEPT + 20; one += 1) whatHappened.put('act', `act ${one}`);
		expect(whatHappened.kept).toHaveLength(MOST_KEPT);
		expect(whatHappened.kept[0].said).toBe('act 20');
		expect(whatHappened.kept[MOST_KEPT - 1].said).toBe(`act ${MOST_KEPT + 19}`);
	});

	it('is cleared when somebody asks', () => {
		whatHappened.record(true);
		whatHappened.put('trouble', 'something went wrong');
		whatHappened.clear();
		expect(whatHappened.kept).toEqual([]);
	});

	it('carries a failure nobody else wrote a path for, and none of its insides', () => {
		whatHappened.record(true);
		reject(new TypeError('draw.render is not a function'));
		expect(whatHappened.kept.map((one) => one.kind)).toEqual(['trouble']);
		expect(said()).not.toContain('draw.render');
		expect(said()).not.toContain('TypeError');
	});

	it('keeps a ref, a DID and a path a failure was carrying out of it', () => {
		whatHappened.record(true);
		reject(new Error(`Expected a <did>/<ulid> reference: ${ref(1)}`));
		reject(
			new SloppyApiError(404, `Sloppy API 404 Not Found for /nodes/${encodeURIComponent(ref(1))}`)
		);
		reject(
			new SloppyApiError(500, 'Sloppy API 500 Internal Server Error for /following/did:syr:abc', {
				detail: 'Internal server error'
			})
		);
		const whole = whatHappened.asText();
		expect(whatHappened.kept).toHaveLength(3);
		expect(whole).not.toContain('did:syr:');
		expect(whole).not.toContain('/nodes/');
		expect(whole).not.toContain('/following/');
		expect(whole).not.toContain('Sloppy API');
	});

	it('carries the words a server wrote for a person, and not the path it wrote them about', () => {
		whatHappened.record(true);
		reject(
			new SloppyApiError(409, `Sloppy API 409 Conflict for /nodes/${encodeURIComponent(ref(1))}`, {
				detail: 'That address is already taken in this graph.'
			})
		);
		expect(said()).toBe('That address is already taken in this graph.');
	});
});

describe('a chat in the record', () => {
	it('carries the turn, the question, the answer and what the act came to', async () => {
		whatHappened.record(true);
		await chat.lookForAgents();
		await chat.say('what is in here?');
		stub.tell({
			event: 'started',
			session: '01J00000000000000000000001',
			model: 'opus',
			tools: ['write_note']
		});
		stub.tell({ event: 'asking', call: CALL, act: 'write_note', arguments: {} });
		await chat.settle(CALL, true);
		acting.answer = { said: '{"note":"…"}', touched: [ref(1)] };
		await stub.serve(writing({ title: 'A note' }));
		stub.tell({ event: 'ended' });

		expect(said()).toContain('a turn began');
		expect(said()).toContain('the chat opened with Opus');
		expect(said()).toContain('writing a note is waiting to be answered');
		expect(said()).toContain('writing a note was allowed');
		expect(said()).toContain('writing a note began');
		expect(said()).toContain('writing a note is done, leaving 1 note different');
		expect(said()).not.toContain('write_note');
		expect(said()).not.toContain('with opus');
		expect(said()).toContain('the turn ended');
		expect(whatHappened.kept.every((one) => one.call === undefined || one.call === CALL)).toBe(
			true
		);
	});

	it('holds nothing of what was said, written or read', async () => {
		whatHappened.record(true);
		await chat.say('write a note about Ada and her diary');
		acting.answer = { said: `{"note":"${ref(1)}","title":"Ada's diary"}`, touched: [ref(1)] };
		await stub.serve(writing({ title: "Ada's diary", sections: ['## Her diary'] }));
		const whole = whatHappened.asText();
		expect(whole).not.toContain('Ada');
		expect(whole).not.toContain('diary');
		expect(whole).not.toContain('did:syr:');
	});

	it('says the chat could not go on, and never the line the agent went out on', async () => {
		whatHappened.record(true);
		await chat.say('what is in here?');
		stub.tell({
			event: 'over',
			said: "ENOENT: no such file or directory, open '/Users/ada/thesis/.agent/config'"
		});
		expect(said()).toContain('the chat could not go on');
		expect(whatHappened.kept.some((one) => one.kind === 'trouble')).toBe(true);
		const whole = whatHappened.asText();
		expect(whole).not.toContain('ENOENT');
		expect(whole).not.toContain('/Users/ada');
		expect(chat.trouble).toContain('/Users/ada/thesis/.agent/config');
	});

	it('says a chat that simply ended, and calls it no trouble', async () => {
		whatHappened.record(true);
		await chat.say('what is in here?');
		stub.tell({ event: 'over' });
		expect(said()).toContain('the chat is over');
		expect(whatHappened.kept.some((one) => one.kind === 'trouble')).toBe(false);
	});

	it('says what an act could not do', async () => {
		whatHappened.record(true);
		await chat.say('write a note');
		acting.answer = { said: 'no', trouble: true, told: 'There is nothing at 1a to write under.' };
		await stub.serve(writing());
		expect(said()).toContain('writing a note did not work: There is nothing at 1a to write under.');
		expect(whatHappened.kept.some((one) => one.kind === 'trouble')).toBe(true);
	});
});
