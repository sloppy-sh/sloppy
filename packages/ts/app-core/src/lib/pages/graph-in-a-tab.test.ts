// Settings and the graph picker while a graph kept on this device is open in a
// browser tab: what they offer, and what they stop offering —
// docs/ARCHITECTURE.md § "A graph on this device, beside the one a Sloppy serves".

import { LocalApi, MemoryFiles } from '@sloppy/local';
import type { OwnedRef } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeFolder, type Held } from '../browser-files.test-support.js';
import { graphHere } from '../graph-here.svelte.js';
import { type FakeApi, useFakeApi, VIEWER } from '../stores/fake-api.test-support.js';
import { session } from '../stores/session.svelte.js';
import { at, pushed, replaced, startAt } from './page.test-support.svelte.js';

vi.mock('$app/state', () => ({
	page: {
		get url() {
			return new URL(at.path, 'http://app.test');
		},
		get state() {
			return {};
		}
	}
}));

vi.mock('$app/navigation', () => ({
	pushState: (path: string, state: { note?: OwnedRef; notes?: readonly OwnedRef[] }) =>
		pushed(path, state.note ?? null, [...(state.notes ?? [])]),
	replaceState: (path: string, state: { note?: OwnedRef; notes?: readonly OwnedRef[] }) =>
		replaced(path, state.note ?? null, [...(state.notes ?? [])]),
	afterNavigate: () => {},
	goto: () => {}
}));

vi.mock('@sloppy/ui', async (original) => ({
	...((await original()) as object),
	GraphSurface: (await import('./graph-surface.test-support.svelte')).default
}));

const Settings = (await import('./settings.svelte')).default;
const Graph = (await import('./graph.svelte')).default;

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let hosted: FakeApi;

async function aFolderWithAGraph(title: string): Promise<Held> {
	const store = new Map<string, Uint8Array>();
	const root = '/the-folder';
	const writing = new LocalApi(new MemoryFiles({ store, folder: root, data: '/elsewhere' }));
	await writing.createGraph({ title });
	return new Map(
		[...store]
			.filter(([path]) => path.startsWith(`${root}/`))
			.map(([path, bytes]) => [path.slice(root.length + 1), bytes])
	);
}

function picksUp(held: Held): void {
	Object.defineProperty(globalThis, 'showDirectoryPicker', {
		configurable: true,
		writable: true,
		value: async () => fakeFolder(held, '', 'garden')
	});
}

async function settle(): Promise<void> {
	for (let turn = 0; turn < 8; turn += 1) await new Promise((done) => setTimeout(done, 0));
	flushSync();
}

function screen(): string {
	return (target.textContent ?? '').replace(/\s+/g, ' ');
}

/** The picker is over the page rather than in it, so it is read off the body. */
function sheet(): string {
	const up = document.body.querySelector('[role="dialog"]');
	return (up?.textContent ?? '').replace(/\s+/g, ' ');
}

function press(label: string): void {
	const one = [...document.body.querySelectorAll('button')].find(
		(button) => button.textContent?.trim() === label || button.getAttribute('aria-label') === label
	);
	if (!one) throw new Error(`Nothing to press reads ${JSON.stringify(label)}`);
	one.click();
	flushSync();
}

beforeEach(async () => {
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: (query: string) => ({
			matches: query.includes('max-width'),
			addEventListener: () => {},
			removeEventListener: () => {}
		})
	});
	startAt('/');
	Object.defineProperty(globalThis, 'ResizeObserver', {
		configurable: true,
		writable: true,
		value: class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	});
	URL.createObjectURL = () => 'blob:held';
	URL.revokeObjectURL = () => {};
	target = document.createElement('div');
	document.body.append(target);
	hosted = useFakeApi();
	hosted.on('GET /auth/me', () => VIEWER);
	graphHere.offerHere();
	await session.refresh();
});

afterEach(async () => {
	if (mounted) unmount(mounted);
	mounted = undefined;
	target.remove();
	if (graphHere.open) await graphHere.close();
	Reflect.deleteProperty(globalThis, 'showDirectoryPicker');
	session.clear();
});

describe('Settings, with a graph on this device open in this tab', () => {
	it('stops offering what a graph on this device has no answer for, and offers it again after', async () => {
		picksUp(await aFolderWithAGraph('The garden'));
		mounted = mount(Settings, { target });
		await settle();

		expect(screen()).toContain('A graph kept on this device');
		expect(screen()).toContain('Where your Sloppy is');
		expect(screen()).toContain('Your identity lives at');

		await graphHere.openFolder();
		await settle();

		expect(screen()).toContain('garden is open');
		expect(screen()).not.toContain('Where your Sloppy is');
		expect(screen()).not.toContain('Your identity lives at');

		await graphHere.close();
		await settle();

		expect(screen()).toContain('A graph kept on this device');
		expect(screen()).toContain('Where your Sloppy is');
		expect(screen()).toContain('Your identity lives at');
		expect(screen()).not.toContain('garden is open');
	});
});

// The doors are a section of the graph picker, so the sheet is open at the
// moment the graph on this device goes in front of somebody.
describe('the graph picker, with a door in it', () => {
	it('stops offering to start a graph the moment one on this device is open', async () => {
		picksUp(await aFolderWithAGraph('The garden'));
		hosted.on('GET /nodes', () => []);
		hosted.on('GET /nodes/tags', () => []);
		hosted.on('GET /publications', () => []);
		mounted = mount(Graph, { target });
		await settle();

		press('Your graphs');
		await settle();
		expect(sheet()).toContain('A new graph');

		press('Open a folder on this device');
		await settle();

		expect(sheet()).toContain('garden is open');
		expect(sheet()).not.toContain('A new graph');
	});
});

describe('who is signed in while one is open', () => {
	it('is the graph on this device’s answer, so reading one needs no account', async () => {
		session.clear();
		expect(session.signedIn).toBe(false);
		picksUp(await aFolderWithAGraph('The garden'));

		await graphHere.openFolder();

		expect(session.onDevice).toBe(true);
		expect(session.signedIn).toBe(true);
		expect(session.viewer?.did).toMatch(/^did:syr:/);
		expect(session.viewer?.syr_instance_url).toBe('');
	});

	it('is the Sloppy this app is served from again once it is closed', async () => {
		picksUp(await aFolderWithAGraph('The garden'));
		await graphHere.openFolder();
		await graphHere.close();

		expect(session.onDevice).toBe(false);
		expect(session.viewer?.did).toBe(VIEWER.did);
		expect(session.viewer?.syr_instance_url).toBe(VIEWER.syr_instance_url);
	});
});
