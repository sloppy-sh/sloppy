// A whole chat as somebody takes it away with them. What must NOT be in it —
// what a call handed back to the agent — is as much of this as what must.

import type { ChatThread, ChatTurn } from '@sloppy/types';
import { describe, expect, it } from 'vitest';
import { CHAT_ASKED_MAX } from '@sloppy/types';
import {
	callDetails,
	threadAsMarkdown,
	threadRows,
	tookSaid,
	whenSaid,
	withCarried
} from './chat-said.js';

const GRAPH = 'did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE/01JQ7X3K9M2N4P5R6S7T8V9W2Z';
const NOTE = 'did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE/01JQ7X3K9M2N4P5R6S7T8V9W0X';
const AT = '2026-10-06T10:00:00.000Z';

function aThread(turns: ChatTurn[], name = 'Why the parser is two passes'): ChatThread {
	return {
		id: '01JQ7X3K9M2N4P5R6S7T8V9W01',
		name,
		graph: GRAPH,
		project: '/work/compiler',
		created_at: AT,
		updated_at: AT,
		places: [],
		turns
	};
}

describe('a chat as markdown', () => {
	it('opens with what it is called and the day it began', () => {
		const said = threadAsMarkdown(aThread([]));

		expect(said).toBe('# Why the parser is two passes\n\n2026-10-06\n');
	});

	it('says who each turn was from, and what they said', () => {
		const said = threadAsMarkdown(
			aThread([
				{ from: 'person', blocks: [{ kind: 'said', said: 'Why two passes?' }], at: AT },
				{
					from: 'agent',
					blocks: [{ kind: 'said', said: 'Because the lexer needs a second look.' }],
					at: AT
				}
			])
		);

		expect(said).toContain('**You**\n\nWhy two passes?');
		expect(said).toContain('**Assistant**\n\nBecause the lexer needs a second look.');
	});

	it('names an act as one line, and carries nothing the act answered with', () => {
		const said = threadAsMarkdown(
			aThread([
				{
					from: 'agent',
					blocks: [
						{
							kind: 'tool_call',
							call: 'c1',
							tool: 'search_notes',
							act: 'search_notes',
							arguments: { words: 'parser' }
						},
						{ kind: 'tool_result', call: 'c1', said: '{"found":[{"title":"Two passes"}]}' },
						{ kind: 'said', said: 'There is a note about it already.' }
					],
					at: AT
				}
			])
		);

		expect(said).toContain('*Looking through the notes: parser*');
		expect(said).not.toContain('found');
		expect(said).toContain('There is a note about it already.');
	});

	it('names what was put in front of the agent, and never where it went', () => {
		const said = threadAsMarkdown(
			aThread([
				{
					from: 'person',
					blocks: [
						{ kind: 'said', said: 'What is in this?' },
						{
							kind: 'attached',
							attached: [{ name: 'the whiteboard.png', path: '.sloppy/attached/a1.png' }]
						}
					],
					at: AT
				}
			])
		);

		expect(said).toContain('*Attached: the whiteboard.png*');
		expect(said).not.toContain('.sloppy/attached');
	});

	it('leaves out what the agent only thought, and a turn with nothing in it', () => {
		const said = threadAsMarkdown(
			aThread([
				{
					from: 'agent',
					blocks: [{ kind: 'thinking', said: 'Let me look at the lexer.' }],
					at: AT
				},
				{ from: 'agent', blocks: [], at: AT },
				{ from: 'agent', blocks: [{ kind: 'said', said: 'It needs a second look.' }], at: AT }
			])
		);

		expect(said).not.toContain('Let me look at the lexer.');
		expect(said.match(/\*\*Assistant\*\*/g)).toHaveLength(1);
	});

	it('carries a kind this build draws nothing for without breaking', () => {
		const said = threadAsMarkdown(
			aThread([
				{
					from: 'agent',
					blocks: [
						{ kind: 'a_kind_from_later', payload: { note: NOTE } },
						{ kind: 'said', said: 'Still here.' }
					],
					at: AT
				}
			])
		);

		expect(said).toContain('Still here.');
		expect(said).not.toContain('a_kind_from_later');
	});
});

describe('what one call cost', () => {
	const CALLED = '2026-10-06T10:00:01.000Z';

	it('carries how long an answer took and what it added, where the shell measured them', () => {
		const rows = threadRows({
			from: 'agent',
			at: AT,
			blocks: [
				{ kind: 'tool_call', call: 'c', tool: 'Read', arguments: { file: 'a.ts' }, at: CALLED },
				{ kind: 'tool_result', call: 'c', said: 'hello', took: 1200, tokens: 300 }
			]
		});

		expect(rows).toEqual([
			expect.objectContaining({
				kind: 'call',
				call: expect.objectContaining({ at: CALLED }),
				answer: { said: 'hello', took: 1200, tokens: 300 }
			})
		]);
	});

	it('says each thing only where it was recorded', () => {
		expect(callDetails({ kind: 'tool_call', call: 'c', tool: 'Read' }, undefined)).toEqual([]);
		expect(callDetails({ kind: 'tool_call', call: 'c', tool: 'Read' }, { said: '' })).toEqual([]);
		expect(
			callDetails(
				{ kind: 'tool_call', call: 'c', tool: 'Read', at: CALLED },
				{ said: '', took: 1200, tokens: 3400 }
			)
		).toEqual([`Called at ${whenSaid(CALLED)}`, 'Took 1.2 s', '3.4k tokens']);
	});

	it('reads how long a call took as somebody would', () => {
		expect(tookSaid(400)).toBe('0.4 s');
		expect(tookSaid(1200)).toBe('1.2 s');
		expect(tookSaid(12_400)).toBe('12 s');
		expect(tookSaid(120_000)).toBe('2 min');
		expect(tookSaid(125_000)).toBe('2 min 5 s');
	});
});

describe('what is carried into a new conversation', () => {
	it('fits beside what was said, keeping the end of what was carried', () => {
		const said = 'And the lexer?';
		const carried = 'x'.repeat(20_000) + ' the last thing';

		const whole = withCarried(carried, said);

		expect(whole.length).toBeLessThanOrEqual(CHAT_ASKED_MAX);
		expect(whole.endsWith(said)).toBe(true);
		expect(whole).toContain(' the last thing');
		expect(whole).toContain('…');
	});

	it('carries nothing where what was said leaves no room for it', () => {
		const said = 'y'.repeat(CHAT_ASKED_MAX - 100);

		expect(withCarried('the earlier conversation', said)).toBe(said);
	});

	it('carries the whole of it where it fits', () => {
		expect(withCarried('Person: hello', 'And?')).toContain('Person: hello');
	});
});
