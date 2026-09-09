// A graph kept in a folder on the device: the surfaces offer nothing that would
// need another machine to finish, and say where the writing is instead.
// docs/ARCHITECTURE.md § "Local-only mode".

import type { NodeView, OwnedRef, ProfileView } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	DID,
	node,
	ref,
	useFakeApi,
	VIEWER,
	type FakeApi
} from '../stores/fake-api.test-support.js';
import { type AppRuntime, initRuntime, type VaultAccess } from '../runtime.js';
import { conversation } from '../stores/conversation.svelte.js';
import { find } from '../stores/find.svelte.js';
import { graphs } from '../stores/graphs.svelte.js';
import { identity } from '../stores/identity.svelte.js';
import { nodes } from '../stores/nodes.svelte.js';
import { outlineSections } from '../stores/outline-sections.svelte.js';
import { peers } from '../stores/peers.svelte.js';
import { people } from '../stores/people.svelte.js';
import { prefs } from '../stores/prefs.svelte.js';
import { publications } from '../stores/publications.svelte.js';
import { session } from '../stores/session.svelte.js';
import { tags } from '../stores/tags.svelte.js';
import { at, pushed, replaced, startAt } from './page.test-support.svelte.js';

vi.mock('$app/state', () => ({
	page: {
		get url() {
			return new URL(at.path, 'http://app.test');
		},
		get state() {
			return at.note ? { note: at.note, notes: at.notes } : {};
		}
	}
}));

vi.mock('$app/navigation', () => ({
	pushState: (path: string, state: { note?: OwnedRef; notes?: readonly OwnedRef[] }) =>
		pushed(path, state.note ?? null, [...(state.notes ?? [])]),
	replaceState: (path: string, state: { note?: OwnedRef; notes?: readonly OwnedRef[] }) =>
		replaced(path, state.note ?? null, [...(state.notes ?? [])]),
	afterNavigate: () => {}
}));

vi.mock('@sloppy/ui', async (original) => ({
	...((await original()) as object),
	GraphSurface: (await import('./graph-surface.test-support.svelte')).default
}));

const Graph = (await import('./graph.svelte')).default;
const NoteOnSurface = (await import('./note-in-panel.test-support.svelte')).default;
const Settings = (await import('./settings.svelte')).default;
const Profile = (await import('./profile.svelte')).default;

const FIRST = ref(1);

const STORED: ProfileView = {
	did: DID,
	username: 'ada',
	display_name: 'Ada Lovelace',
	bio: null,
	avatar_src: null,
	banner_src: null
};

let api: FakeApi;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let written: NodeView[];

function stubBrowser(): void {
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
	for (let frame = 0; frame < 3; frame += 1) await new Promise(requestAnimationFrame);
	flushSync();
}

/** Which of the two deployments the app is running as, for the mount that
 *  follows, what the shell around it can do with a file, and where it keeps the
 *  graph. `afterEach` puts it back. */
function running(
	mode: 'hosted' | 'local',
	saveFile?: AppRuntime['saveFile'],
	vault?: VaultAccess
): void {
	initRuntime({ apiHost: () => 'http://api.test', mode: () => mode, saveFile, vault });
}

/** A shell keeping the graph in `folder`, which somebody chose unless `asks`
 *  says the device keeps its graphs in one place. */
function keeping(folder: string | undefined, asks = true): VaultAccess & { opened: number } {
	return {
		opened: 0,
		folder: () => folder,
		asks,
		async open() {
			this.opened += 1;
			return '/Users/me/thesis';
		}
	};
}

/** The identity a device writes its own graphs under: no instance, because
 *  there is none. */
const ON_DEVICE = { ...VIEWER, syr_instance_url: '' };

const screen = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

const has = (labelled: string) =>
	[...document.body.querySelectorAll('button')].some((b) => b.textContent?.includes(labelled));

function control(labelled: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('button')].find((b) =>
		b.textContent?.includes(labelled)
	);
	if (!found) throw new Error(`Nothing on the screen is labelled "${labelled}"`);
	return found;
}

const offered = (): string[] =>
	[...document.body.querySelectorAll('[role="menuitem"]')].map(
		(row) => row.textContent?.trim() ?? ''
	);

function menuOn(what: string): HTMLButtonElement {
	const found = document.body.querySelector<HTMLButtonElement>(`[data-menu="${what}"]`);
	if (!found) throw new Error(`Nothing on the canvas answers a menu on ${what}`);
	return found;
}

function item(label: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
		(row) => row.textContent?.trim() === label
	);
	if (!found) throw new Error(`The menu does not offer "${label}"`);
	return found;
}

function onCanvas(address: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('[aria-label="The graph"] button')].find(
		(b) => b.textContent?.trim().split(/\s+/)[0] === address
	);
	if (!found) throw new Error(`No note addressed ${address} is drawn`);
	return found as HTMLButtonElement;
}

/** The rest of what the graph can do, behind the one control the rail keeps. */
async function openMore(): Promise<void> {
	const more = [...document.body.querySelectorAll('button')].find(
		(b) => b.getAttribute('aria-label') === 'More'
	);
	if (!more) throw new Error('The graph carries no More control');
	more.click();
	await settle();
}

/** Everything a note can have done to it waits behind one control at its head. */
async function openActs(): Promise<void> {
	const menu = document.body.querySelector<HTMLButtonElement>(
		'[aria-label="What to do with this note"]'
	);
	if (!menu) throw new Error('The note carries no way to act on it');
	menu.click();
	await settle();
}

async function openGraph(): Promise<void> {
	session.adopt(VIEWER, 'a-session');
	mounted = mount(Graph, { target });
	flushSync();
	await settle();
}

async function openNote(): Promise<void> {
	session.adopt(VIEWER, 'a-session');
	mounted = mount(NoteOnSurface, { target, props: { opened: FIRST, fresh: false } });
	flushSync();
	await settle();
}

beforeEach(() => {
	startAt('/');
	stubBrowser();
	localStorage.clear();
	prefs.init();
	nodes.clear();
	outlineSections.clear();
	peers.clear();
	tags.clear();
	publications.clear();
	conversation.clear();
	identity.clear();
	find.clear();
	graphs.clear();
	people.hold(null);
	api = useFakeApi();
	written = [node(1, '1', { title: 'Origins' })];
	api.on('GET /nodes', () => written);
	api.on('GET /nodes/tags', () => []);
	api.on(`GET /nodes/${encodeURIComponent(DID)}/${encodeURIComponent(FIRST.split('/')[1])}`, () =>
		node(1, '1', { title: 'Origins' })
	);
	api.on(
		`GET /nodes/${encodeURIComponent(DID)}/${encodeURIComponent(FIRST.split('/')[1])}/blocks`,
		() => []
	);
	api.on('GET /profile/me', () => STORED);
	api.on('GET /publications', () => []);
	api.on('GET /pulls', () => []);
	api.on('GET /auth/own-instance', () => ({ instance_url: null }));
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	session.clear();
	running('hosted');
	target.remove();
	document.body.innerHTML = '';
});

describe('the graph, on a device holding its own', () => {
	it('offers no way into somebody else’s graph, and asks about none', async () => {
		running('local');
		await openGraph();
		await openMore();

		expect(offered()).toContain('Choose notes');
		expect(offered()).not.toContain("Other people's graphs");
		expect(api.countOf('GET /pulls')).toBe(0);
		expect(api.countOf('GET /publications')).toBe(0);
	});

	it('still offers it where a Sloppy is serving the graph', async () => {
		running('hosted');
		await openGraph();
		await openMore();

		expect(offered()).toContain("Other people's graphs");
		expect(api.countOf('GET /pulls')).toBeGreaterThan(0);
	});

	it('leaves it out of a graph with nothing written in it yet', async () => {
		api.on('GET /nodes', () => []);
		running('local');
		await openGraph();

		expect(has('Write the first note')).toBe(true);
		expect(has("Read somebody else's")).toBe(false);

		unmount(mounted as ReturnType<typeof mount>, { outro: false });
		mounted = undefined;
		nodes.clear();
		graphs.clear();
		running('hosted');
		await openGraph();

		expect(has("Read somebody else's")).toBe(true);
	});

	it('leaves publishing out of what can be done to the notes chosen', async () => {
		running('local');
		await openGraph();

		menuOn('the canvas').click();
		await settle();
		item('Choose notes').click();
		await settle();
		onCanvas('1').click();
		await settle();

		expect(has('Delete')).toBe(true);
		expect(has('Publish')).toBe(false);

		menuOn('1').click();
		await settle();

		expect(offered()).toContain('Tags');
		expect(offered().some((label) => label.startsWith('Publish'))).toBe(false);
	});

	it('offers publishing to a graph a Sloppy serves', async () => {
		running('hosted');
		await openGraph();

		menuOn('the canvas').click();
		await settle();
		item('Choose notes').click();
		await settle();
		onCanvas('1').click();
		await settle();

		expect(has('Publish')).toBe(true);

		menuOn('1').click();
		await settle();

		expect(offered().some((label) => label.startsWith('Publish'))).toBe(true);
	});

	it('says a note of somebody else’s is not in the graph it holds', async () => {
		const theirs = ref(4, 'did:syr:z6MkPeerPeerPeerPeerPeerPeerPeerPeerPeer');
		const cut = theirs.lastIndexOf('/');
		startAt(
			`/n/${encodeURIComponent(theirs.slice(0, cut))}/${encodeURIComponent(theirs.slice(cut + 1))}`
		);
		running('local');
		await openGraph();

		expect(screen()).toContain("That note is somebody else's");
		expect(at.note).toBe(null);
		expect(at.notes).toEqual([]);
		expect(screen()).not.toContain('Nothing lives at that address');
		expect(api.countOf('GET /pulls')).toBe(0);
	});
});

describe('a note, on a device holding its own graph', () => {
	it('offers nothing about publishing it', async () => {
		running('local');
		await openNote();
		await openActs();

		expect(has('Publishing')).toBe(false);
		expect(has('Copy link')).toBe(true);
		expect(api.countOf('GET /publications')).toBe(0);
	});

	it('offers publishing where a Sloppy serves the graph', async () => {
		running('hosted');
		await openNote();
		await openActs();

		expect(has('Publishing')).toBe(true);
	});
});

describe('Settings, on a device holding its own graph', () => {
	it('says where the writing is, and offers no Sloppy to point at', async () => {
		running('local');
		mounted = mount(Settings, { target });
		flushSync();
		await settle();

		expect(screen()).toContain('Your graph is a folder on this device');
		expect(has('Point Sloppy here')).toBe(false);
		expect(has('Sign out')).toBe(false);
		expect(screen()).not.toContain('Your graph opens once you sign in');
		expect(api.countOf('GET /profile/me')).toBe(0);
	});

	it('names the folder the graph is in, and offers another', async () => {
		const vault = keeping('/Users/me/garden');
		running('local', undefined, vault);
		session.adopt(ON_DEVICE, 'this device');
		mounted = mount(Settings, { target });
		flushSync();
		await settle();

		expect(screen()).toContain('/Users/me/garden');

		control('Open another folder').click();
		await settle();

		expect(vault.opened).toBe(1);
		expect(screen()).toContain('/Users/me/thesis');
	});

	// The folder is this app's own there, and there is only the one, so a path
	// nobody chose and cannot move is a fact they can do nothing with.
	it('names no folder on a device that keeps its graphs in one place', async () => {
		running('local', undefined, keeping('/var/mobile/Containers/1/Documents', false));
		session.adopt(ON_DEVICE, 'this device');
		mounted = mount(Settings, { target });
		flushSync();
		await settle();

		expect(screen()).toContain('Your graph is a folder on this device');
		expect(screen()).not.toContain('/var/mobile');
		expect(has('Open another folder')).toBe(false);
	});

	it('still hands over a copy of everything written', async () => {
		running('local', async () => {});
		mounted = mount(Settings, { target });
		flushSync();
		await settle();

		expect(control('Download a copy').disabled).toBe(false);
	});

	// A folder on this device is not something a browser can be opened on, so the
	// offer goes rather than standing there disabled beside advice to try one.
	it('offers no copy where the app around it can save no file', async () => {
		running('local', null);
		mounted = mount(Settings, { target });
		flushSync();
		await settle();

		expect(has('Download a copy')).toBe(false);
		expect(screen()).not.toContain('Open Sloppy in a browser');
	});

	it('keeps the Sloppy to point at, and the way out, where one serves the graph', async () => {
		running('hosted');
		session.adopt(VIEWER, 'a-session');
		mounted = mount(Settings, { target });
		flushSync();
		await settle();

		expect(has('Point Sloppy here')).toBe(true);
		expect(has('Sign out')).toBe(true);
	});
});

describe('the page about you, on a device holding its own graph', () => {
	it('shows what the notes are written under and asks no server about it', async () => {
		running('local');
		session.adopt(VIEWER, 'a-session');
		mounted = mount(Profile, { target });
		flushSync();
		await settle();

		expect(screen()).toContain(DID);
		expect(screen()).not.toContain('What you publish');
		expect(api.countOf('GET /profile/me')).toBe(0);
		expect(api.countOf('GET /publications')).toBe(0);
	});

	it('draws no identity to copy before the graph has opened', async () => {
		running('local');
		mounted = mount(Profile, { target });
		flushSync();
		await settle();

		expect(document.body.querySelector('[aria-label="Copy your identity"]')).toBe(null);
		expect(screen()).toContain('Your graph is opening');
	});

	it('reads the profile a Sloppy holds where one serves the graph', async () => {
		running('hosted');
		session.adopt(VIEWER, 'a-session');
		mounted = mount(Profile, { target });
		flushSync();
		await settle();

		expect(api.countOf('GET /profile/me')).toBeGreaterThan(0);
		expect(screen()).toContain('What you publish');
	});
});
