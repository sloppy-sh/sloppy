// A note in a project: it points at code, opens what it points at, and says
// when that code moved — DESIGN.md § "An anchor into code".

import { MemoryFiles, MemoryHistory } from '@sloppy/local';
import { digestOf } from '@sloppy/vault';
import type { BlockView, NodeView, OwnedRef, UpdateNodeRequest } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initRuntime, type DeploymentMode } from '../runtime.js';
import { graphs } from '../stores/graphs.svelte.js';
import { nodes } from '../stores/nodes.svelte.js';
import { peers } from '../stores/peers.svelte.js';
import { people } from '../stores/people.svelte.js';
import { session } from '../stores/session.svelte.js';
import {
	AT,
	amending,
	node,
	ref,
	useFakeApi,
	VIEWER,
	type FakeApi
} from '../stores/fake-api.test-support.js';
import { offers } from '../stores/offers.svelte.js';
import NoteOnSurface from './note-in-panel.test-support.svelte';

const NOTE = ref(1);
const PROJECT = '/home/ada/garden';

const PARSER = 'export function discover() {\n\treturn 1;\n}\n';

function refPath(of: OwnedRef): string {
	const cut = of.lastIndexOf('/');
	return `/${encodeURIComponent(of.slice(0, cut))}/${encodeURIComponent(of.slice(cut + 1))}`;
}
const path = (of: OwnedRef) => `/nodes${refPath(of)}`;

function stubViewport(width: number): void {
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: (query: string) => ({
			matches: /min-width:\s*(\d+)px/.test(query)
				? width >= Number(/min-width:\s*(\d+)px/.exec(query)?.[1])
				: /max-width:\s*(\d+)px/.test(query)
					? width <= Number(/max-width:\s*(\d+)px/.exec(query)?.[1])
					: false,
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
	for (let turn = 0; turn < 40; turn += 1) {
		await new Promise((wake) => setTimeout(wake));
		flushSync();
	}
}

const screen = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

const named = (words: string): HTMLButtonElement | undefined =>
	[...document.body.querySelectorAll('button')].find((one) => one.textContent?.trim() === words);

const labelled = (label: string) =>
	document.body.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

/** Raises what a reader may do to the note being read. */
async function openActs(): Promise<void> {
	const acts = labelled('What to do with this note');
	if (!acts) throw new Error('The note carries no acts control');
	acts.click();
	await settle();
}

/** One section pointing at a place in the code, under the words it was cited
 *  by. */
function anchored(href: string, of: OwnedRef = NOTE): BlockView {
	const wrote = of.slice(0, of.lastIndexOf('/'));
	return {
		ref: ref(50, wrote),
		node: of,
		created_by: wrote,
		created_at: AT,
		updated_at: AT,
		ord: 'a0',
		content: {
			type: 'doc',
			content: [
				{
					type: 'section',
					content: [
						{
							type: 'paragraph',
							content: [{ type: 'text', marks: [{ type: 'link', attrs: { href } }], text: 'here' }]
						}
					]
				}
			]
		}
	} as unknown as BlockView;
}

let api: FakeApi;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let written: UpdateNodeRequest[];
let files: MemoryFiles;
let kept: MemoryHistory;
let store: Map<string, Uint8Array>;

/** The folder as somebody's project, with the code in it and its history over
 *  it; `false` is a graph that is nobody's project. */
function shellOver(project: boolean, mode: DeploymentMode = 'hosted'): void {
	initRuntime({
		apiHost: () => 'http://api.test',
		mode: () => mode,
		project: project ? async () => files : undefined,
		history: () => (project ? kept : undefined)
	});
}

const said = (text: string) => new TextEncoder().encode(text);

/** Puts a file in the project and keeps a version of the folder. */
async function keepFile(at: string, text: string): Promise<string> {
	await files.write(at, said(text));
	await kept.commit(`Wrote ${at}`);
	return (await kept.currentCommit()) as string;
}

async function openNote(
	over: Partial<NodeView> = {},
	blocks: BlockView[] = [anchored('code:src/parser.ts')]
): Promise<void> {
	const held = node(1, '1', over);
	api.on(`GET ${path(NOTE)}`, () => held);
	api.on(`GET ${path(NOTE)}/blocks`, () => blocks);
	api.on(`PATCH ${path(NOTE)}`, (_url, init) => {
		const request = JSON.parse(String(init?.body)) as UpdateNodeRequest;
		written.push(request);
		return { ...held, ...request };
	});
	mounted = mount(NoteOnSurface, { target, props: { opened: NOTE, fresh: false } });
	flushSync();
	await settle();
}

beforeEach(() => {
	nodes.clear();
	peers.clear();
	graphs.clear();
	offers.clear();
	people.hold(null);
	written = [];
	store = new Map();
	files = new MemoryFiles({ root: PROJECT, store, data: '/data' });
	kept = new MemoryHistory(new MemoryFiles({ root: PROJECT, store, data: '/data' }), {
		author: 'Ada'
	});
	api = useFakeApi();
	shellOver(true);
	stubViewport(390);
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	session.clear();
	nodes.clear();
	initRuntime({ apiHost: () => '', project: undefined, history: () => undefined });
	target.remove();
	document.body.innerHTML = '';
});

describe('a note in a project', () => {
	it('offers a place in the code to point at', async () => {
		await keepFile('src/parser.ts', PARSER);
		await openNote();

		document.body
			.querySelector('.sloppy-prose')
			?.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
		flushSync();

		expect(labelled('Cite code')).not.toBeNull();
	});

	it('opens the code an anchor names rather than sending the reader out', async () => {
		await keepFile('src/parser.ts', PARSER);
		await openNote();

		const chip = document.body.querySelector('.sloppy-prose a') as HTMLAnchorElement;
		chip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		await settle();

		expect(screen()).toContain('src/parser.ts');
		expect(document.body.querySelector('code')?.textContent).toContain('export function discover');
	});
});

describe('a graph that is nobody’s project', () => {
	it('offers nothing about code, and leaves the anchor an ordinary link', async () => {
		shellOver(false);
		await openNote();

		document.body
			.querySelector('.sloppy-prose')
			?.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
		flushSync();

		expect(labelled('Cite code')).toBeNull();
		expect(document.body.querySelector('[data-code-anchors]')).toBeNull();

		await openActs();
		expect(named('Still true')).toBeUndefined();
	});
});

describe('saying a note’s reasoning still holds', () => {
	// Unread is not stale: a note nobody has confirmed says nothing at all, and
	// the act waits with the note's other acts.
	it('says nothing about a note nobody has confirmed, and stands nothing under its title', async () => {
		await keepFile('src/parser.ts', PARSER);
		await openNote();

		expect(screen()).not.toContain('has changed since you read it');
		expect(named('Still true')).toBeUndefined();

		await openActs();
		expect(named('Still true')).toBeDefined();
	});

	it('records what every file it points at says now, and the version too', async () => {
		const at = await keepFile('src/parser.ts', PARSER);
		await openNote();

		await openActs();
		named('Still true')?.click();
		await settle();

		expect(written).toEqual([
			{
				read_against: [{ path: 'src/parser.ts', digest: await digestOf(said(PARSER)) }],
				checked: at
			}
		]);
	});

	// A folder nothing is keeping a history of can still answer this, because
	// the reading is a reading of the files and not of a version.
	it('records the reading where the folder keeps no history', async () => {
		await files.write('src/parser.ts', said(PARSER));
		initRuntime({
			apiHost: () => 'http://api.test',
			mode: () => 'local',
			project: async () => files,
			history: () => undefined
		});
		await openNote();

		await openActs();
		named('Still true')?.click();
		await settle();

		expect(written).toEqual([
			{ read_against: [{ path: 'src/parser.ts', digest: await digestOf(said(PARSER)) }] }
		]);
	});

	it('names the file that moved since the note was read against it', async () => {
		const digest = await digestOf(said(PARSER));
		await files.write('src/parser.ts', said(`${PARSER}// and more\n`));
		await openNote({ read_against: [{ path: 'src/parser.ts', digest }] });

		expect(screen()).toContain('src/parser.ts has changed since you read it');
		expect(named('Still true')).toBeDefined();
	});

	// A reading outlives the link that wrote it: the mark on the canvas is drawn
	// off the readings alone, so the note says the same thing and the act clears
	// it — taking it records the note against what it points at NOW, which is
	// nothing.
	it('says so, and offers the act, where the writing no longer points there', async () => {
		const digest = await digestOf(said(PARSER));
		await files.write('src/parser.ts', said(`${PARSER}// and more\n`));
		await openNote({ read_against: [{ path: 'src/parser.ts', digest }] }, [
			anchored('https://example.com/')
		]);

		expect(screen()).toContain('src/parser.ts has changed since you read it');

		named('Still true')?.click();
		await settle();

		expect(written.map((one) => one.read_against)).toEqual([[]]);
	});

	it('says so where the code moved after the note was confirmed', async () => {
		const read = await keepFile('src/parser.ts', PARSER);
		await keepFile('src/parser.ts', `${PARSER}// and more\n`);
		await openNote({ checked: read });

		expect(screen()).toContain('src/parser.ts has changed since you read it');
		expect(named('Still true')).toBeDefined();
	});

	// Silence is the ordinary state of a note that is fine.
	it('says nothing, and stands nothing under the title, where nothing has moved', async () => {
		const read = await keepFile('src/parser.ts', PARSER);
		await keepFile('src/history.rs', 'fn discover() {}\n');
		await openNote({ checked: read });

		expect(screen()).not.toContain('has changed since you read it');
		expect(named('Still true')).toBeUndefined();
	});

	it('says nothing where the file it was read against still says the same', async () => {
		const digest = await digestOf(said(PARSER));
		await files.write('src/parser.ts', said(PARSER));
		await openNote({ read_against: [{ path: 'src/parser.ts', digest }] });

		expect(screen()).not.toContain('has changed since you read it');
		expect(named('Still true')).toBeUndefined();
	});

	// Where the code cannot be reached nothing is worked out: not moved, and
	// not up to date either.
	it('works nothing out beside a graph that is nobody’s project', async () => {
		const digest = await digestOf(said(PARSER));
		await files.write('src/parser.ts', said(`${PARSER}// and more\n`));
		shellOver(false);
		await openNote({ read_against: [{ path: 'src/parser.ts', digest }] });

		expect(screen()).not.toContain('has changed since you read it');
	});

	it('is not offered on a note with nothing pointing at code', async () => {
		await keepFile('src/parser.ts', PARSER);
		await openNote({}, [anchored('https://example.com/')]);

		await openActs();
		expect(named('Still true')).toBeUndefined();
	});
});

// One container in one repository is read by everybody who works in it, so a
// path is the project's and not its author's — ruling 2 gates code on the
// graph. What the reader may not do is say somebody else's reading still holds.
describe('a note a colleague writes, in the same project', () => {
	const COLLEAGUE = 'did:syr:z6MkjChhrJfLm9WGVUAnyLPnfPGmZDcyDKNsBTsAsn7RkAqB';
	const THEIRS = ref(2, COLLEAGUE);

	async function openTheirNote(over: Partial<NodeView> = {}): Promise<void> {
		const held: NodeView = {
			...node(2, '1', { created_by: COLLEAGUE, owner: COLLEAGUE }),
			ref: THEIRS,
			title: 'What the parser does',
			...over
		};
		api.on(`GET ${path(THEIRS)}`, () => held);
		api.on(`GET ${path(THEIRS)}/blocks`, () => [anchored('code:src/parser.ts', THEIRS)]);
		api.on(`GET /profile/${encodeURIComponent(COLLEAGUE)}`, () => ({
			did: COLLEAGUE,
			username: 'charles',
			display_name: 'Charles Babbage',
			bio: null,
			avatar_src: null,
			banner_src: null
		}));
		amending(api, { [THEIRS]: [] }, () => held);
		mounted = mount(NoteOnSurface, { target, props: { opened: THEIRS, fresh: false } });
		flushSync();
		await settle();
	}

	beforeEach(() => {
		shellOver(true, 'local');
		session.adopt(VIEWER, 'a-session');
	});

	it('opens the code it points at, and offers a place for the change being written', async () => {
		await keepFile('src/parser.ts', PARSER);
		await openTheirNote();

		const chip = document.body.querySelector('.sloppy-prose a') as HTMLAnchorElement;
		chip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		await settle();

		expect(document.body.querySelector('code')?.textContent).toContain('export function discover');

		document.body
			.querySelector('.sloppy-prose')
			?.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
		flushSync();
		expect(labelled('Cite code')).not.toBeNull();
	});

	it('leaves saying it still holds to whoever writes it', async () => {
		const read = await keepFile('src/parser.ts', PARSER);
		await keepFile('src/parser.ts', `${PARSER}// and more\n`);
		await openTheirNote({ checked: read });

		expect(screen()).not.toContain('has changed since you read it');
		await openActs();
		expect(named('Still true')).toBeUndefined();
	});
});
