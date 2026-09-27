// The conversation as a person reads it: what each act laid out, what they
// attached, and the way to keep an answer. docs/ARCHITECTURE.md § "Asking a
// tool to write the notes". The acts themselves are stood in for — what an act
// answers the person is its own, and this is what is drawn from it.

import 'fake-indexeddb/auto';
import { chatCard, type ChatActDone, type ChatTurn, type OwnedRef } from '@sloppy/types';
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

/** One of Sloppy's own acts called and answered, as the shell and the page
 *  between them leave it in the thread. */
function wrote(call: string, about: string): ChatTurn {
	return agent([
		{ kind: 'tool_call', call, tool: 'write_note', act: 'write_note', arguments: { about } },
		{ kind: 'tool_result', call, said: '{"note":"…","done":"written"}' }
	]);
}

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let opened: OwnedRef[];
let keeps: { at: number; said: string }[];
let acts: Map<string, ChatActDone>;
let kept: Map<number, ChatActDone>;

function show(turns: readonly ChatTurn[], live = false): void {
	mounted = mount(ChatThread, {
		target,
		props: {
			turns,
			live,
			done: (call: string) => acts.get(call),
			kept: (at: number) => kept.get(at),
			onKeep: (at: number, said: string) => keeps.push({ at, said }),
			onOpen: (note: OwnedRef) => opened.push(note)
		}
	});
	flushSync();
}

beforeEach(async () => {
	nodes.clear();
	opened = [];
	keeps = [];
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
		show([said], true);

		expect(named('Keep as a note')).toBeUndefined();
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
});
