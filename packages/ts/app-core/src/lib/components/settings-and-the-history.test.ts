// Settings names a place and holds the way into it; the history is where a
// version is put there. One folder, one device, both surfaces.

import 'fake-indexeddb/auto';
import {
	DeviceCredentials,
	DeviceGitDefaults,
	LocalApi,
	MemoryFiles,
	MemoryHistory,
	MemoryRemotes
} from '@sloppy/local';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api, resetApi } from '../api.js';
import { initRuntime } from '../runtime.js';
import { gitSettings } from '../stores/git-settings.svelte.js';
import { graphs } from '../stores/graphs.svelte.js';
import { graphHistory } from '../stores/history.svelte.js';
import { nodes } from '../stores/nodes.svelte.js';
import { outlineSections } from '../stores/outline-sections.svelte.js';
import HistorySettings from './history-settings.svelte';

const HERE = '/Users/me/garden';
const THERE = '/Users/them/garden';
const AT = 'https://github.test/me/garden.git';
const DATA = '/data';

let store: Map<string, Uint8Array>;
let places: MemoryRemotes;
let kept: MemoryHistory;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

function folder(): MemoryFiles {
	return new MemoryFiles({ root: HERE, store, data: DATA });
}

function show(): void {
	mounted = mount(HistorySettings, { target });
	flushSync();
}

async function settle(): Promise<void> {
	for (let turn = 0; turn < 8; turn += 1) await new Promise((done) => setTimeout(done, 0));
	flushSync();
}

function press(label: string): void {
	const one = [...document.body.querySelectorAll('button')].find(
		(button) => button.textContent?.trim() === label
	);
	if (!one) throw new Error(`No "${label}" on the page`);
	one.click();
}

function offers(label: string): boolean {
	return [...document.body.querySelectorAll('button')].some(
		(button) => button.textContent?.trim() === label
	);
}

function type(id: string, said: string): void {
	const field = target.querySelector<HTMLInputElement>(`#${CSS.escape(id)}`);
	if (!field) throw new Error(`Nowhere to type ${id}`);
	field.value = said;
	field.dispatchEvent(new Event('input', { bubbles: true }));
}

/** The place named through Settings, exactly as somebody would name it. */
async function nameThePlace(): Promise<void> {
	press('Add somewhere else');
	await settle();
	type('history-new-place-name', 'origin');
	type('history-new-place-url', AT);
	press('Keep it there too');
	await settle();
}

/** The token saved through Settings, exactly as somebody would save it. */
async function holdTheWayIn(): Promise<void> {
	press('Add a way in');
	await settle();
	type('history-token-origin', 'a-token-from-the-host');
	press('Save the way in');
	await settle();
}

beforeEach(async () => {
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
	});
	store = new Map();
	places = new MemoryRemotes();
	kept = new MemoryHistory(folder(), { author: 'Ada', remotes: places });
	places.keep(
		AT,
		new MemoryHistory(new MemoryFiles({ root: THERE, store: new Map(), data: '/their-data' }), {
			author: 'Bo',
			branch: 'holding',
			remotes: places
		})
	);
	gitSettings.clear();
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
		gitDefaults: new DeviceGitDefaults(folder()),
		credentials: new DeviceCredentials(folder())
	});
	resetApi();
	target = document.createElement('div');
	document.body.append(target);
	await api.createNode({ title: 'Origins' });
	await graphHistory.keep('A first version');
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	gitSettings.clear();
	graphHistory.clear();
	graphs.clear();
	nodes.clear();
	outlineSections.clear();
	target.remove();
	document.body.innerHTML = '';
	initRuntime({ apiHost: () => '', mode: () => 'hosted', history: () => undefined });
	resetApi();
});

describe('a place named in Settings and put to from the history', () => {
	it('sends somebody to a way in that Settings really offers, under the host it named', async () => {
		show();
		await settle();
		await nameThePlace();

		await graphHistory.read();
		expect(await graphHistory.putElsewhere()).toBe(false);
		expect(graphHistory.elsewhereSaid).toEqual({
			words: 'Add a way in for github.test in Settings, then try again.',
			refused: true
		});

		expect(offers('Add a way in')).toBe(true);
		expect(document.body.textContent).toContain('Sloppy has no way into github.test yet.');
	});

	it('puts the versions there once Settings holds one', async () => {
		show();
		await settle();
		await nameThePlace();
		await holdTheWayIn();

		await graphHistory.read();
		expect(await graphHistory.putElsewhere()).toBe(true);
		expect(graphHistory.elsewhereSaid).toEqual({
			words: 'Your notes are on github.test.',
			refused: false
		});
		expect(await places.reach(AT)?.branches()).toContainEqual(
			expect.objectContaining({ name: 'main', head: graphHistory.at })
		);
	});

	it('refuses again the moment Settings lets the way in go', async () => {
		show();
		await settle();
		await nameThePlace();
		await holdTheWayIn();
		press('Change the way in');
		await settle();
		press('Forget it');
		await settle();

		await graphHistory.read();
		expect(await graphHistory.putElsewhere()).toBe(false);
		expect(graphHistory.elsewhereSaid?.words).toBe(
			'Add a way in for github.test in Settings, then try again.'
		);
	});
});
