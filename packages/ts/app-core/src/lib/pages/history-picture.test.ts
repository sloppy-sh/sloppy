// The History surface once the history can say what shape it is in: the
// picture, one version's details, the lines of work, and the places the folder
// is also kept.

import 'fake-indexeddb/auto';
import {
	credentialFor,
	type HeldCredential,
	LocalApi,
	MemoryFiles,
	MemoryHistory,
	MemoryRemotes
} from '@sloppy/local';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api, resetApi } from '../api.js';
import { initRuntime } from '../runtime.js';
import { graphHistory } from '../stores/history.svelte.js';
import { nodes } from '../stores/nodes.svelte.js';
import { outlineSections } from '../stores/outline-sections.svelte.js';
import History from './history.svelte';

const HERE = '/Users/me/garden';
const THERE = '/Users/them/garden';
const AT = 'https://github.test/me/garden.git';

let store: Map<string, Uint8Array>;
let places: MemoryRemotes;
let held: HeldCredential[];
let kept: MemoryHistory;
let theirs: MemoryHistory;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

function folder(): MemoryFiles {
	return new MemoryFiles({ root: HERE, store, data: '/data' });
}

function stubBrowser(): void {
	// jsdom drives no pointer, and a picker asks the element it is on about one.
	Element.prototype.hasPointerCapture = () => false;
	Element.prototype.setPointerCapture = () => {};
	Element.prototype.releasePointerCapture = () => {};
	Element.prototype.scrollIntoView = () => {};
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: (query: string) => ({
			matches: query.includes('max-width'),
			addEventListener: () => {},
			removeEventListener: () => {}
		})
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
	for (let turn = 0; turn < 8; turn += 1) {
		await new Promise((done) => setTimeout(done, 0));
		flushSync();
	}
	flushSync();
}

const screen = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

function control(labelled: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('button')].find((one) =>
		one.textContent?.includes(labelled)
	);
	if (!found) throw new Error(`Nothing on the screen is labelled "${labelled}"`);
	return found;
}

function exactly(labelled: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('button')].find(
		(one) => one.textContent?.trim() === labelled
	);
	if (!found) throw new Error(`Nothing on the screen is exactly "${labelled}"`);
	return found;
}

function inRow(name: string, labelled: string): HTMLButtonElement {
	const row = document.body.querySelector(`[data-line="${name}"]`);
	const found = [...(row?.querySelectorAll('button') ?? [])].find((one) =>
		one.textContent?.includes(labelled)
	);
	if (!found) throw new Error(`The line "${name}" offers nothing labelled "${labelled}"`);
	return found;
}

function offered(labelled: string): boolean {
	return [...document.body.querySelectorAll('button')].some((one) =>
		one.textContent?.includes(labelled)
	);
}

/** The versions the picture is drawing, newest first. */
function drawn(): string[] {
	return [...document.body.querySelectorAll('[aria-label="The history"] li')].map((one) =>
		(one.textContent ?? '').replace(/\s+/g, ' ').trim()
	);
}

function lineRow(name: string): string {
	const found = document.body.querySelector(`[data-line="${name}"]`);
	if (!found) throw new Error(`Nothing on the screen is a line called "${name}"`);
	return (found.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function type(labelled: string, said: string): void {
	const field = document.body.querySelector<HTMLInputElement>(`input[aria-label="${labelled}"]`);
	if (!field) throw new Error(`No field is labelled "${labelled}"`);
	field.value = said;
	field.dispatchEvent(new Event('input', { bubbles: true }));
}

async function open(): Promise<void> {
	mounted = mount(History, { target, props: { open: true } });
	await settle();
}

beforeEach(async () => {
	stubBrowser();
	store = new Map();
	held = [];
	places = new MemoryRemotes();
	kept = new MemoryHistory(folder(), { author: 'Ada', remotes: places });
	theirs = new MemoryHistory(
		new MemoryFiles({ root: THERE, store: new Map(), data: '/their-data' }),
		{ author: 'Bo', branch: 'holding', remotes: places }
	);
	places.keep(AT, theirs);
	graphHistory.clear();
	nodes.clear();
	outlineSections.clear();
	initRuntime({
		apiHost: () => '',
		mode: () => 'local',
		createApi: () => new LocalApi(folder()),
		vault: {
			folder: () => HERE,
			graph: () => new LocalApi(folder()).graphHere(),
			asks: true,
			open: async () => HERE
		},
		history: () => kept,
		credentials: {
			list: async () => held,
			forUrl: async (url) => credentialFor(held, url),
			hold: async () => {},
			forget: async () => {}
		}
	});
	resetApi();
	target = document.createElement('div');
	document.body.appendChild(target);
	await api.createNode({ title: 'Origins' });
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	graphHistory.clear();
	nodes.clear();
	outlineSections.clear();
	initRuntime({ apiHost: () => '', mode: () => 'hosted', history: () => undefined });
	resetApi();
	target.remove();
	document.body.innerHTML = '';
});

describe('the history as a picture', () => {
	it('draws every line with the branch at its head', async () => {
		await graphHistory.keep('A first version');
		await graphHistory.startLine('an-argument');
		await graphHistory.workOn('an-argument');
		await api.createNode({ title: 'Written over there' });
		await graphHistory.keep('Over there');

		await open();

		expect(drawn()).toHaveLength(2);
		expect(drawn()[0]).toContain('an-argument');
		expect(drawn()[0]).toContain('Over there');
		expect(drawn()[1]).toContain('main');
		expect(drawn()[1]).toContain('A first version');
	});

	it('says nothing has been kept yet where there is nothing to draw', async () => {
		await open();

		expect(drawn()).toEqual([]);
		expect(screen()).toContain('You have not kept one yet.');
	});

	it('draws what another line holds where the one the folder is on holds none', async () => {
		const away = new Map<string, Uint8Array>();
		const elsewhere = new MemoryFiles({
			root: '/Users/me/backup',
			store: away,
			data: '/backup-data'
		});
		const backup = new MemoryHistory(elsewhere, { author: 'Cy', remotes: places });
		places.keep('/Users/me/backup', backup);
		await elsewhere.write('theirs.md', new TextEncoder().encode('Kept on the other disk\n'));
		await backup.commit('Kept on the other disk');
		await kept.addRemote('backup', '/Users/me/backup');
		await graphHistory.read();
		await graphHistory.lookElsewhere('backup');

		await open();

		expect(graphHistory.versions).toEqual([]);
		expect(drawn()).toHaveLength(1);
		expect(drawn()[0]).toContain('Kept on the other disk');
		expect(screen()).not.toContain('You have not kept one yet.');
	});

	it('says what a version springs from, and starts a line at that one and no other', async () => {
		await graphHistory.keep('A first version');
		const first = graphHistory.at as string;
		await api.createNode({ title: 'A second thought' });
		await graphHistory.keep('And the second');
		await open();

		control('And the second').click();
		await settle();
		expect(screen()).toContain('What it springs from');
		expect(screen()).toContain('A first version');

		exactly('A first version').click();
		await settle();
		type('Name a line starting here', 'back-then');
		await settle();
		exactly('Start it').click();
		await settle();

		expect(graphHistory.lines.map((one) => one.name).sort()).toEqual(['back-then', 'main']);
		expect(graphHistory.lines.find((one) => one.name === 'back-then')?.head).toBe(first);
		expect(graphHistory.at).not.toBe(first);
	});

	it('says a version is signed and by which key', async () => {
		await kept.setSigning({ kind: 'ssh', key: { kind: 'kept' } });
		await graphHistory.keep('A first version');
		await open();

		control('A first version').click();
		await settle();

		expect(screen()).toContain('Signed with a key this device knows:');
		const key = [...document.body.querySelectorAll('p')].find(
			(one) => one.textContent?.trim() === 'SHA256:kept'
		);
		// A fingerprint is longer than a phone is wide, so it stands on its own
		// line and breaks rather than running off the edge.
		expect(key?.className).toContain('break-all');
	});

	it('says where the history starts', async () => {
		await graphHistory.keep('A first version');
		await open();

		control('A first version').click();
		await settle();

		expect(screen()).toContain('Nothing: this is where the history starts.');
	});
});

describe('the lines of work beside the picture', () => {
	it('says which one the folder is on, and lets another go', async () => {
		await graphHistory.keep('A first version');
		await graphHistory.startLine('an-argument');
		await open();

		expect(lineRow('main')).toContain('You are working on this one.');
		expect(lineRow('an-argument')).toContain('Let it go');

		inRow('an-argument', 'Let it go').click();
		await settle();

		expect(graphHistory.lines.map((one) => one.name)).toEqual(['main']);
		expect(document.body.querySelector('[data-line="an-argument"]')).toBe(null);
	});

	it('offers nothing that would take the folder off the line it is on', async () => {
		await graphHistory.keep('A first version');
		await open();

		expect(lineRow('main')).not.toContain('Let it go');
		expect(lineRow('main')).not.toContain('Work on it');
	});

	it('starts a line here from one kept somewhere else', async () => {
		held = [{ host: 'github.test', credential: { kind: 'token', token: 'a-token' } }];
		await kept.addRemote('origin', AT);
		await graphHistory.keep('A first version');
		await graphHistory.putElsewhere('origin');
		await graphHistory.startLine('an-argument');
		await graphHistory.workOn('an-argument');
		await api.createNode({ title: 'Written over there' });
		await graphHistory.keep('Over there');
		await graphHistory.putElsewhere('origin');
		await graphHistory.workOn('main');
		await graphHistory.dropLine('an-argument');
		await open();

		expect(lineRow('origin/an-argument')).toContain('Start one here');

		inRow('origin/an-argument', 'Start one here').click();
		await settle();

		expect(graphHistory.lines.map((one) => one.name)).toContain('an-argument');
	});
});

describe('the places the folder is also kept', () => {
	it('points at Settings where there is nowhere else', async () => {
		await graphHistory.keep('A first version');
		await open();

		expect(screen()).toContain('Your notes are only in this folder.');
		expect(offered('Put yours there')).toBe(false);
	});

	it('puts the notes there, and says where they are', async () => {
		held = [{ host: 'github.test', credential: { kind: 'token', token: 'a-token' } }];
		await kept.addRemote('origin', AT);
		await graphHistory.keep('A first version');
		await open();

		expect(screen()).toContain('Also kept on github.test.');

		control('Put yours there').click();
		await settle();

		expect(screen()).toContain('Your notes are on github.test.');
		expect(document.body.querySelector('[role="status"]')?.textContent?.trim()).toBe(
			'Your notes are on github.test.'
		);
	});

	it('asks after the place the line follows before any other, and counts against it', async () => {
		held = [{ host: 'github.test', credential: { kind: 'token', token: 'a-token' } }];
		const backup = new MemoryHistory(
			new MemoryFiles({ root: '/Users/me/backup', store: new Map(), data: '/backup-data' }),
			{ author: 'Cy', remotes: places }
		);
		places.keep('/Users/me/backup', backup);
		await kept.addRemote('backup', '/Users/me/backup');
		await kept.addRemote('origin', AT);
		await graphHistory.keep('A first version');
		await graphHistory.putElsewhere('origin');
		await api.createNode({ title: 'A second thought' });
		await graphHistory.keep('And the second');

		await open();

		const picker = document.body.querySelector('[aria-label="Where to"]');
		expect(picker?.textContent?.trim()).toBe('github.test');
		expect(screen()).toContain('1 to put there.');
	});

	it('asks for a way in where this device holds none', async () => {
		await kept.addRemote('origin', AT);
		await graphHistory.keep('A first version');
		await open();

		control('Put yours there').click();
		await settle();

		expect(document.body.querySelector('[role="alert"]')?.textContent?.trim()).toBe(
			'Add a way in for github.test in Settings, then try again.'
		);
		expect(screen().split('Add a way in for github.test')).toHaveLength(2);
	});
});
