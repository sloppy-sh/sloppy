// Opening a chat about the project from the graph it is in —
// docs/ARCHITECTURE.md § "Asking a tool to write the notes". Nothing here
// starts a program: the seam is a stand-in.

import 'fake-indexeddb/auto';
import { MemoryFiles } from '@sloppy/local';
import type { ChatAgent, NodeView, OwnedRef } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ChatAccess, type ChatLive, initRuntime } from '../runtime.js';
import { seamSettledAgain } from '../seam.svelte.js';
import { canvasInk } from '../stores/canvas-ink.svelte.js';
import { chat } from '../stores/chat.svelte.js';
import { prefs } from '../stores/prefs.svelte.js';
import { find } from '../stores/find.svelte.js';
import { graphs } from '../stores/graphs.svelte.js';
import { nodes } from '../stores/nodes.svelte.js';
import { offers } from '../stores/offers.svelte.js';
import { outlineSections } from '../stores/outline-sections.svelte.js';
import { peers } from '../stores/peers.svelte.js';
import { publications } from '../stores/publications.svelte.js';
import { session } from '../stores/session.svelte.js';
import { tags } from '../stores/tags.svelte.js';
import {
	DID,
	homeOf,
	node,
	ref,
	useFakeApi,
	VIEWER,
	type FakeApi
} from '../stores/fake-api.test-support.js';
import { at, pushed, replaced, startAt } from './page.test-support.svelte.js';

vi.mock('$app/state', () => ({
	page: {
		get url() {
			return new URL(at.path, 'http://app.test');
		},
		get state() {
			if (!at.note) return {};
			return { note: at.note, notes: at.notes, ...(at.landing ? { at: at.landing } : {}) };
		}
	}
}));

vi.mock('$app/navigation', () => ({
	pushState: (path: string, state: App.PageState) =>
		pushed(path, state.note ?? null, [...(state.notes ?? [])], state.at ?? null),
	replaceState: (path: string, state: App.PageState) =>
		replaced(path, state.note ?? null, [...(state.notes ?? [])], state.at ?? null),
	afterNavigate: () => {}
}));

vi.mock('@sloppy/ui', async (original) => ({
	...((await original()) as object),
	GraphSurface: (await import('./graph-surface.test-support.svelte')).default
}));

const Graph = (await import('./graph.svelte')).default;

const HOME = homeOf(DID);
const PROJECT = '/home/ada/garden';
const PARSER = ref(1);

function segments(of: OwnedRef): string {
	const cut = of.lastIndexOf('/');
	return `${encodeURIComponent(of.slice(0, cut))}/${encodeURIComponent(of.slice(cut + 1))}`;
}
const path = (of: OwnedRef) => `/nodes/${segments(of)}`;

class Stub implements ChatAccess {
	agent: readonly ChatAgent[] = ['claude_code'];
	readonly said: string[] = [];

	agents(): Promise<ChatAgent[]> {
		return Promise.resolve([...this.agent]);
	}

	open(): Promise<ChatLive> {
		return Promise.resolve({
			say: (said: string) => {
				this.said.push(said);
				return Promise.resolve();
			},
			stop: () => Promise.resolve(),
			close: () => Promise.resolve()
		});
	}
}

function stubViewport(): void {
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
	});
	Object.defineProperty(globalThis, 'ResizeObserver', {
		configurable: true,
		writable: true,
		value: class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	});
}

async function settle(): Promise<void> {
	for (let turn = 0; turn < 10; turn += 1) {
		await new Promise((done) => setTimeout(done, 0));
		flushSync();
	}
	for (let frame = 0; frame < 3; frame += 1) await new Promise(requestAnimationFrame);
	flushSync();
}

const screen = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

function labelled(label: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('button')].find(
		(one) => one.getAttribute('aria-label') === label
	);
	if (!found) throw new Error(`Nothing on screen is labelled "${label}"`);
	return found as HTMLButtonElement;
}

const offeredInMenu = (): string[] =>
	[...document.body.querySelectorAll('[role="menuitem"]')].map(
		(row) => row.textContent?.trim() ?? ''
	);

function menuItem(label: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
		(row) => row.textContent?.trim() === label
	);
	if (!found) throw new Error(`The menu does not offer "${label}"`);
	return found;
}

let api: FakeApi;
let files: MemoryFiles;
let serving: MemoryFiles | undefined;
let stub: Stub;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let held: NodeView[];

function installGraph(): void {
	held = [node(1, '1', { title: 'The parser' })];
	api.on('GET /nodes/tags', () => []);
	api.on('GET /nodes', (url) => {
		const origin = url.searchParams.get('origin');
		return held.filter((one) => (origin ? one.origin === origin : one.ref === one.origin));
	});
	api.on('GET /publications', () => []);
	for (const one of held) api.on(`GET ${path(one.ref)}`, () => one);
	api.on(`GET ${path(PARSER)}/blocks`, () => []);
}

async function open(): Promise<void> {
	if (mounted) unmount(mounted, { outro: false });
	session.adopt(VIEWER, 'a-session');
	mounted = mount(Graph, { target });
	flushSync();
	await settle();
}

beforeEach(async () => {
	startAt('/');
	stubViewport();
	nodes.clear();
	outlineSections.clear();
	peers.clear();
	tags.clear();
	publications.clear();
	find.clear();
	graphs.clear();
	chat.clear();
	offers.clear();
	files = new MemoryFiles({ root: PROJECT, store: new Map(), data: '/data' });
	await files.write('src/parser.ts', new TextEncoder().encode('export const one = 1;\n'));
	Element.prototype.scrollIntoView = () => {};
	api = useFakeApi();
	installGraph();
	canvasInk.rubOut(HOME);
	serving = files;
	stub = new Stub();
	prefs.set('aiOffered', true);
	initRuntime({
		apiHost: () => 'http://api.test',
		project: async () => serving,
		chat: stub
	});
	seamSettledAgain();
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	prefs.set('aiOffered', false);
	chat.clear();
	offers.clear();
	session.clear();
	initRuntime({ apiHost: () => '', project: undefined, chat: undefined });
	seamSettledAgain();
	target.remove();
	document.body.innerHTML = '';
});

describe('where the offer to chat stands', () => {
	it('is on a graph that is a project', async () => {
		await open();
		labelled('More').click();
		await settle();

		expect(offeredInMenu()).toContain('Chat about the code');
	});

	it('has taken the place of the four steps that stood there', async () => {
		await open();
		labelled('More').click();
		await settle();

		expect(offeredInMenu()).not.toContain('Write notes about the code');
	});

	it('is nowhere on a graph that is nobody’s project', async () => {
		serving = undefined;
		await open();
		labelled('More').click();
		await settle();

		expect(offeredInMenu()).not.toContain('Chat about the code');
	});

	it('is nowhere until the person has asked for an assistant', async () => {
		prefs.set('aiOffered', false);
		await open();
		labelled('More').click();
		await settle();

		expect(offeredInMenu()).not.toContain('Chat about the code');
	});

	it('is nowhere where nothing on this device answers, though it was asked for', async () => {
		stub.agent = [];
		await open();
		labelled('More').click();
		await settle();

		expect(offeredInMenu()).not.toContain('Chat about the code');
	});

	it('is nowhere on a device that cannot reach an agent at all', async () => {
		initRuntime({
			apiHost: () => 'http://api.test',
			project: async () => serving,
			chat: undefined
		});
		seamSettledAgain();
		await open();
		labelled('More').click();
		await settle();

		expect(offeredInMenu()).not.toContain('Chat about the code');
	});
});

describe('the chat itself', () => {
	it('opens on nothing said and nothing asked of the agent', async () => {
		await open();
		labelled('More').click();
		await settle();
		menuItem('Chat about the code').click();
		await settle();

		expect(screen()).toContain('Say what you want written about');
		expect(stub.said).toEqual([]);
	});
});
