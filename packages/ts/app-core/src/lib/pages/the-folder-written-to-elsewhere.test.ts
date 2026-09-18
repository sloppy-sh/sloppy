// A note written into the folder by something other than the app — the
// terminal writes the same files — and the window coming back to somebody.
// docs/ARCHITECTURE.md § "Tooling and the review".

import 'fake-indexeddb/auto';
import { LocalApi, MemoryFiles } from '@sloppy/local';
import type { OwnedRef } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetApi } from '../api.js';
import { initRuntime } from '../runtime.js';
import { canvasInk } from '../stores/canvas-ink.svelte.js';
import { find } from '../stores/find.svelte.js';
import { graphs } from '../stores/graphs.svelte.js';
import { nodes } from '../stores/nodes.svelte.js';
import { outlineSections } from '../stores/outline-sections.svelte.js';
import { peers } from '../stores/peers.svelte.js';
import { people } from '../stores/people.svelte.js';
import { publications } from '../stores/publications.svelte.js';
import { review } from '../stores/review.svelte.js';
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

const FOLDER = '/home/ada/garden';

let store: Map<string, Uint8Array>;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

/** The folder as one reader reaches it. Every client here reads and writes the
 *  same files and holds nothing of another's index, so the app is told nothing
 *  about a write another one makes. */
function client(): LocalApi {
	return new LocalApi(new MemoryFiles({ store, folder: FOLDER }));
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
	for (let turn = 0; turn < 20; turn += 1) {
		await new Promise((done) => setTimeout(done, 0));
		flushSync();
	}
	for (let frame = 0; frame < 3; frame += 1) await new Promise(requestAnimationFrame);
	flushSync();
}

const screen = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

/** The app, serving the folder the way a shell with one open does: a reader
 *  made afresh every time the app asks for one, since each holds its own index
 *  of the folder. */
async function readingTheFolder(): Promise<void> {
	initRuntime({
		apiHost: () => '',
		mode: () => 'local',
		createApi: () => client(),
		vault: {
			folder: () => FOLDER,
			graph: () => client().graphHere(),
			open: async () => FOLDER,
			asks: false
		}
	});
	resetApi();
	for (const held of [nodes, outlineSections, peers, tags, publications, find, graphs, review]) {
		held.clear();
	}
	people.hold(null);
	session.clear();
	await session.refresh();
	await people.read().catch(() => undefined);
	await graphs.load().catch(() => undefined);
	mounted = mount(Graph, { target });
	flushSync();
	await settle();
}

beforeEach(async () => {
	startAt('/');
	stubViewport();
	store = new Map();
	const owner = client();
	await owner.createGraph({ title: 'The garden' });
	await owner.createNode({ title: 'Seed banks', address: '1' });
	canvasInk.rubOut((await owner.graphHere()) as OwnedRef);
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	nodes.clear();
	graphs.clear();
	review.clear();
	session.clear();
	initRuntime({ apiHost: () => '', project: undefined, history: () => undefined });
	resetApi();
	target.remove();
	document.body.innerHTML = '';
});

describe('a note written into the folder while the app stands on it', () => {
	it('is drawn once the window comes back to somebody', async () => {
		await readingTheFolder();
		expect(screen()).toContain('Seed banks');
		expect(screen()).not.toContain('Photosynthesis');

		await client().createNode({ title: 'Photosynthesis', address: '2' });
		window.dispatchEvent(new Event('focus'));
		await settle();

		expect(screen()).toContain('Photosynthesis');
	});
});
