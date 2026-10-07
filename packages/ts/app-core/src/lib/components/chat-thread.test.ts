// The conversation as a person reads it: what each act laid out, what they
// attached, and the way to keep an answer. docs/ARCHITECTURE.md § "Asking a
// tool to write the notes". The acts themselves are stood in for — what an act
// answers the person is its own, and this is what is drawn from it.

import 'fake-indexeddb/auto';
import {
	chatCard,
	type ChatActDone,
	type ChatCard,
	type ChatTurn,
	type OwnedRef
} from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DID, homeOf, node, ref, useFakeApi, VIEWER } from '../stores/fake-api.test-support.js';
import { nodes } from '../stores/nodes.svelte.js';
import { session } from '../stores/session.svelte.js';
import ChatThread from './chat-thread.svelte';

const HOME = homeOf(DID);
const PARSER = ref(1);
const VAULT = ref(2);
const AT = '2026-09-27T00:00:00.000Z';

const screen = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

const named = (words: string): HTMLButtonElement | undefined =>
	[...document.body.querySelectorAll('button')].find((one) => one.textContent?.trim() === words);

function person(blocks: ChatTurn['blocks']): ChatTurn {
	return { from: 'person', blocks, at: AT };
}

function agent(blocks: ChatTurn['blocks']): ChatTurn {
	return { from: 'agent', blocks, at: AT };
}

/** What one of Sloppy's own acts hands the agent: its ref and what became of
 *  it, which is the machine's half of the answer and nobody's to read. */
const HANDED_BACK = `{"note":"${PARSER}","done":"written"}`;

/** One of Sloppy's own acts called and answered, as the shell and the page
 *  between them leave it in the thread. */
function wrote(call: string, about: string, trouble = false): ChatTurn {
	return agent([
		{ kind: 'tool_call', call, tool: 'write_note', act: 'write_note', arguments: { about } },
		{
			kind: 'tool_result',
			call,
			said: HANDED_BACK,
			...(trouble ? { trouble: true } : {})
		}
	]);
}

/** The same, for an act called on a note that is already there. */
function acted(call: string, act: 'read_note' | 'delete_note', note: OwnedRef): ChatTurn {
	return agent([
		{ kind: 'tool_call', call, tool: act, act, arguments: { note } },
		{ kind: 'tool_result', call, said: '{}' }
	]);
}

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let opened: OwnedRef[];
let keeps: { at: number; said: string }[];
let answers: boolean[];
let acts: Map<string, ChatActDone>;
let kept: Map<number, ChatActDone>;

function show(
	turns: readonly ChatTurn[],
	over: { live?: boolean; keeping?: { at: number; card?: ChatCard } } = {}
): void {
	mounted = mount(ChatThread, {
		target,
		props: {
			turns,
			live: over.live ?? false,
			keeping: over.keeping ?? null,
			done: (call: string) => acts.get(call),
			kept: (at: number) => kept.get(at),
			onKeep: (at: number, said: string) => keeps.push({ at, said }),
			onKept: (allowed: boolean) => answers.push(allowed),
			onOpen: (note: OwnedRef) => opened.push(note)
		}
	});
	flushSync();
}

/** The modal reads the viewport to pick its presentation. */
function stubViewport(): void {
	Object.defineProperty(globalThis, 'innerWidth', {
		configurable: true,
		writable: true,
		value: 390
	});
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: (query: string) => {
			const most = /max-width:\s*(\d+)px/.exec(query);
			return {
				matches: most ? 390 <= Number(most[1]) : false,
				addEventListener: () => {},
				removeEventListener: () => {}
			};
		}
	});
}

async function settle(): Promise<void> {
	for (let turn = 0; turn < 20; turn += 1) {
		await new Promise((wake) => setTimeout(wake));
		flushSync();
	}
}

beforeEach(async () => {
	stubViewport();
	nodes.clear();
	opened = [];
	keeps = [];
	answers = [];
	acts = new Map();
	kept = new Map();
	const api = useFakeApi();
	api.on('GET /nodes', () => [
		node(1, '1', { title: 'The parser' }),
		node(2, '1a', { title: 'The vault' })
	]);
	session.adopt(VIEWER, 'a-session');
	await nodes.load({ graph: HOME });
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	nodes.clear();
	session.clear();
	target.remove();
	document.body.innerHTML = '';
});

describe('what an act comes to', () => {
	it('lays out the act’s own card, and never what the agent was handed', () => {
		acts.set('c1', {
			said: '{"note":"…","done":"written"}',
			told: 'Written.',
			card: chatCard('note', 'The parser', [
				{ label: 'Place', value: 'src/parser.ts' },
				{ label: 'Tags', value: 'parser' }
			]),
			touched: [PARSER]
		});
		show([wrote('c1', 'src/parser.ts')]);

		expect(screen()).toContain('Written.');
		expect(screen()).toContain('Place');
		expect(screen()).toContain('src/parser.ts');
		expect(screen()).not.toContain('done');
	});

	it('offers the one note it left, and reads it as somebody cites it', () => {
		acts.set('c1', { said: '{}', told: 'Written.', touched: [PARSER] });
		show([wrote('c1', 'src/parser.ts')]);

		named('Open 1 · The parser')?.click();
		flushSync();

		expect(opened).toEqual([PARSER]);
	});

	it('offers nowhere to go where an act left a whole run of notes', () => {
		acts.set('c1', { said: '{}', told: 'Carried.', touched: [PARSER, VAULT] });
		show([wrote('c1', 'src/parser.ts')]);

		expect(screen()).toContain('Carried.');
		expect(named('Open 1 · The parser')).toBeUndefined();
	});

	it('offers nowhere to go once an act has put the note in the bin', () => {
		acts.set('c1', { said: '{}', told: 'In the bin. You can put it back.', touched: [PARSER] });
		show([acted('c1', 'delete_note', PARSER)]);

		expect(screen()).toContain('In the bin. You can put it back.');
		expect(named('Open 1 · The parser')).toBeUndefined();
	});

	it('names the note a read answers with once, where the line would say it too', () => {
		acts.set('c1', { said: '{}', told: '1 · The parser', touched: [] });
		show([acted('c1', 'read_note', PARSER)]);

		expect(screen().match(/1 · The parser/g)).toHaveLength(1);
	});

	it('draws none of what the agent was handed, where the act laid out nothing', () => {
		show([wrote('c1', 'src/parser.ts')]);

		expect(screen()).toContain('Writing a note');
		expect(screen()).not.toContain(DID);
		expect(screen()).not.toContain('"note"');
	});

	it('says an act did not happen, where it came to nothing and said nothing', () => {
		show([wrote('c1', 'src/parser.ts', true)]);

		expect(screen()).toContain('That did not happen.');
		expect(screen()).not.toContain(DID);
	});

	it('reads trouble as trouble, in the words the act gave', () => {
		acts.set('c1', { said: 'ignored', trouble: true, told: 'There is no note there.' });
		show([wrote('c1', 'src/parser.ts')]);

		expect(screen()).toContain('There is no note there.');
		expect(document.body.querySelector('.text-destructive')).not.toBeNull();
	});

	it('draws a tool of the agent’s own by its name and its own writing', () => {
		show([
			agent([
				{ kind: 'tool_call', call: 'c2', tool: 'Read', arguments: { file: 'src/parser.ts' } },
				{ kind: 'tool_result', call: 'c2', said: 'export function parse() {}' }
			])
		]);

		expect(screen()).toContain('Read');
		expect(screen()).toContain('export function parse() {}');
	});
});

describe('reading a call whole', () => {
	const CALLED = '2026-09-27T00:00:01.000Z';
	const read = () =>
		agent([
			{
				kind: 'tool_call',
				call: 'c2',
				tool: 'Read',
				arguments: { file: 'src/parser.ts' },
				at: CALLED
			},
			{
				kind: 'tool_result',
				call: 'c2',
				said: 'export function parse() {}',
				took: 1200,
				tokens: 300
			}
		]);
	const line = () => document.body.querySelector<HTMLButtonElement>('button[title]');

	it('says on the line when it was made, how long it took and what it cost', () => {
		show([read()]);

		expect(line()?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Read src/parser.ts');
		expect(line()?.title).toContain('Took 1.2 s');
		expect(line()?.title).toContain('300 tokens');
		expect(line()?.title).toContain('Called at');
	});

	it('opens what was asked and what came back, whole', async () => {
		show([read()]);

		line()?.click();
		await settle();

		const transcript = document.body.querySelector('[data-call-transcript="c2"]');
		expect(transcript).not.toBeNull();
		const shown = transcript?.textContent?.replace(/\s+/g, ' ') ?? '';
		expect(shown).toContain('Asked');
		expect(shown).toContain('"file": "src/parser.ts"');
		expect(shown).toContain('Answered');
		expect(shown).toContain('export function parse() {}');
	});

	it('still opens a call that has nothing to say about itself yet', async () => {
		show([
			agent([{ kind: 'tool_call', call: 'c3', tool: 'Glob', arguments: { pattern: '*.ts' } }])
		]);

		const call = [...document.body.querySelectorAll('button')].find((one) =>
			one.textContent?.includes('Glob')
		);
		expect(call?.title).toBe('');
		call?.click();
		await settle();

		const shown =
			document.body
				.querySelector('[data-call-transcript="c3"]')
				?.textContent?.replace(/\s+/g, ' ') ?? '';
		expect(shown).toContain('"pattern": "*.ts"');
		expect(shown).toContain('Nothing yet.');
	});
});

describe('what a person put in front of it', () => {
	it('shows what they attached beside what they said', () => {
		show([
			person([
				{ kind: 'said', said: 'What is this?' },
				{
					kind: 'attached',
					attached: [{ name: 'the board.png', path: '.sloppy/attached/1-the-board.png' }]
				}
			])
		]);

		expect(screen()).toContain('What is this?');
		expect(screen()).toContain('the board.png');
	});
});

describe('keeping an answer', () => {
	const ANSWER = 'The parser hands the lexer tokens.';
	const said = agent([{ kind: 'said', said: ANSWER }]);

	it('offers every answer a way to be kept', () => {
		show([person([{ kind: 'said', said: 'Tell me about it' }]), said]);

		named('Keep as a note')?.click();
		flushSync();

		expect(keeps).toEqual([{ at: 1, said: ANSWER }]);
	});

	it('offers nothing on an answer that is still arriving', () => {
		show([said], { live: true });

		expect(named('Keep as a note')).toBeUndefined();
	});

	it('stands the question at the turn it would keep, and the offer at the rest', () => {
		show([said, agent([{ kind: 'said', said: 'And the lexer reads the characters.' }])], {
			keeping: {
				at: 0,
				card: chatCard('note', 'The parser', [{ label: 'Place', value: 'src/parser.ts' }])
			}
		});

		expect(screen()).toContain('src/parser.ts');
		expect(named('Keep as a note')).toBeDefined();

		named('Keep it')?.click();
		flushSync();

		expect(answers).toEqual([true]);
	});

	it('stands what came of keeping it where the offer was', () => {
		kept.set(0, {
			said: '{}',
			told: 'Kept.',
			card: chatCard('note', 'The parser', [{ label: 'Place', value: 'src/parser.ts' }]),
			touched: [PARSER]
		});
		show([said]);

		expect(named('Keep as a note')).toBeUndefined();
		expect(screen()).toContain('Kept.');
		expect(screen()).toContain('src/parser.ts');
		expect(named('Open 1 · The parser')).toBeDefined();
	});

	it('says why it was not kept and leaves the offer standing', () => {
		kept.set(0, {
			said: 'That note was not written.',
			trouble: true,
			told: 'That note was not written.'
		});
		show([said]);

		expect(screen()).toContain('That note was not written.');

		named('Keep as a note')?.click();
		flushSync();

		expect(keeps).toEqual([{ at: 0, said: ANSWER }]);
	});
});
