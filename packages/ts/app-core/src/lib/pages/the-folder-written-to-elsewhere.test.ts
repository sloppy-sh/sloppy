// A note written into the folder by something other than the app — the
// terminal writes the same files — and the window coming back to somebody.
// docs/ARCHITECTURE.md § "Tooling and the review".

import 'fake-indexeddb/auto';
import { LocalApi, MemoryFiles } from '@sloppy/local';
import type { BlockDocument, BlockView, OwnedRef } from '@sloppy/types';
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

/** The note the app opens, by the address drawn on the canvas. */
function onCanvas(address: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('[aria-label="The graph"] button')].find(
		(one) => one.textContent?.trim().split(/\s+/)[0] === address
	);
	if (!found) throw new Error(`No note addressed ${address} is drawn`);
	return found as HTMLButtonElement;
}

/** TipTap hangs the editor off the element it writes into. */
const writingIn = (): { commands: { insertContentAt(at: number, words: string): boolean } } =>
	(
		document.body.querySelector('.sloppy-prose') as unknown as {
			editor: { commands: { insertContentAt(at: number, words: string): boolean } };
		}
	).editor;

function paragraph(words: string): BlockDocument {
	return {
		type: 'doc',
		content: [{ type: 'paragraph', content: [{ type: 'text', text: words }] }]
	};
}

/** The words each of the note's sections holds on disk, in order. */
async function onDisk(note: OwnedRef): Promise<string[]> {
	return (await client().listBlocks(note)).map((block) => words(block));
}

function words(block: BlockView): string {
	const said: string[] = [];
	const walk = (content: unknown): void => {
		if (!Array.isArray(content)) return;
		for (const child of content as { type?: string; text?: string; content?: unknown }[]) {
			if (typeof child.text === 'string') said.push(child.text);
			walk(child.content);
		}
	};
	walk(block.content.content);
	return said.join('');
}

/** Long enough for the writing surface's own clock to have sent what is waiting. */
async function written(): Promise<void> {
	await new Promise((done) => setTimeout(done, 900));
	await settle();
}

describe('the note in front of somebody when the folder is read again', () => {
	let seed: OwnedRef;

	beforeEach(async () => {
		seed = ((await client().listNodes({}))[0] as { ref: OwnedRef }).ref;
		await client().createBlock({ node: seed, content: paragraph('as the terminal wrote it') });
		await readingTheFolder();
		onCanvas('1').click();
		await settle();
		expect(screen()).toContain('as the terminal wrote it');
	});

	it('takes the version the folder holds where nothing here is unsaved', async () => {
		const [section] = await client().listBlocks(seed);
		await client().updateBlock(section.ref, {
			content: paragraph('as the terminal wrote it again')
		});
		window.dispatchEvent(new Event('focus'));
		await settle();

		expect(screen()).toContain('as the terminal wrote it again');
		expect(screen()).not.toContain('This note was also written somewhere else');
	});

	it('settles the writing in hand against the folder rather than writing it twice', async () => {
		writingIn().commands.insertContentAt(2, 'my own words — ');
		flushSync();
		// Nothing the pane is holding is contested, so a save would land: only the
		// read that comes with the folder puts this section in front of somebody.
		await client().createBlock({ node: seed, content: paragraph('a section the terminal added') });

		window.dispatchEvent(new Event('focus'));
		await settle();
		expect(screen()).toContain('a section the terminal added');
		expect(screen()).toContain('my own words');
		expect(screen()).toContain('This note was also written somewhere else');

		await written();
		const held = await onDisk(seed);
		expect(held.filter((said) => said.includes('my own words'))).toHaveLength(1);
		expect(held.filter((said) => said.includes('a section the terminal added'))).toHaveLength(1);
		expect(held).toHaveLength(2);
	});

	it('leaves one copy of every section where a save lands after a rewrite', async () => {
		writingIn().commands.insertContentAt(2, 'mine — ');
		flushSync();
		const [section] = await client().listBlocks(seed);
		await client().deleteBlock(section.ref);
		await client().createBlock({ node: seed, content: paragraph('a section the terminal added') });

		await written();
		await written();

		const held = await onDisk(seed);
		expect(held.filter((said) => said.includes('mine'))).toHaveLength(1);
		expect(held.filter((said) => said.includes('a section the terminal added'))).toHaveLength(1);
		expect(held).toHaveLength(2);
	});
});
