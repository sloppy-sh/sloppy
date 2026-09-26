// The surface a maintainer asks a project's notes to be written from —
// docs/ARCHITECTURE.md § "Writing the notes in four steps". Nothing here
// starts a tool: the seam is a stand-in throughout.

import 'fake-indexeddb/auto';
import { MemoryFiles } from '@sloppy/local';
import type {
	DocumentingIntent,
	DocumentingPlan,
	DocumentingProgress,
	DocumentingTool,
	OwnedRef,
	ProposedPlace
} from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initRuntime, type DocumentingAccess } from '../runtime.js';
import { seamSettledAgain } from '../seam.svelte.js';
import { documenting } from '../stores/documenting.svelte.js';
import {
	DID,
	homeOf,
	node,
	ref,
	useFakeApi,
	VIEWER,
	type FakeApi
} from '../stores/fake-api.test-support.js';
import { nodes } from '../stores/nodes.svelte.js';
import { session } from '../stores/session.svelte.js';
import type { NoteLanding } from '../pages/page-state.js';
import DocumentingSheet from './documenting-sheet.svelte';

const HOME = homeOf(DID);
const PROJECT = '/home/ada/garden';
const PARSER = ref(1);

class Stub implements DocumentingAccess {
	readonly surveys: DocumentingIntent[] = [];
	readonly plans: DocumentingPlan[] = [];
	stops = 0;
	tool: readonly DocumentingTool[] = ['claude_code'];
	/** Set while this device is to reject the ask rather than answer it. */
	untold = false;
	proposes: ProposedPlace[] = [];
	reports: DocumentingProgress[] = [{ stage: 'done', places: [] }];
	/** Set while a run is to hang, so the surface can be read mid-run. */
	holding = false;
	#waiting: (() => void) | null = null;

	tools(): Promise<DocumentingTool[]> {
		if (this.untold) return Promise.reject(new Error('no bridge'));
		return Promise.resolve([...this.tool]);
	}

	survey(intent: DocumentingIntent): Promise<ProposedPlace[]> {
		this.surveys.push(intent);
		return Promise.resolve(this.proposes);
	}

	async run(
		plan: DocumentingPlan,
		watch: (progress: DocumentingProgress) => void
	): Promise<DocumentingProgress> {
		this.plans.push(plan);
		for (const progress of this.reports) watch(progress);
		if (this.holding) {
			this.holding = false;
			await new Promise<void>((wake) => {
				this.#waiting = wake;
			});
		}
		return this.reports[this.reports.length - 1];
	}

	stop(): Promise<void> {
		this.stops += 1;
		this.#waiting?.();
		this.#waiting = null;
		return Promise.resolve();
	}
}

function stubViewport(width: number): void {
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: (query: string) => ({
			matches: /max-width:\s*(\d+)px/.test(query)
				? width <= Number(/max-width:\s*(\d+)px/.exec(query)?.[1])
				: false,
			addEventListener: () => {},
			removeEventListener: () => {}
		})
	});
}

async function settle(): Promise<void> {
	for (let turn = 0; turn < 20; turn += 1) {
		await new Promise((wake) => setTimeout(wake));
		flushSync();
	}
}

const screen = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

const named = (words: string): HTMLButtonElement | undefined =>
	[...document.body.querySelectorAll('button')].find((one) => one.textContent?.trim() === words);

const labelled = (label: string): HTMLButtonElement | undefined =>
	[...document.body.querySelectorAll('button')].find(
		(one) => one.getAttribute('aria-label') === label
	);

const field = (label: string): HTMLInputElement | HTMLTextAreaElement | null =>
	document.body.querySelector(`[aria-label="${label}"]`);

function type(into: HTMLInputElement | HTMLTextAreaElement | null, words: string): void {
	if (!into) throw new Error('no field');
	into.value = words;
	into.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

let stub: Stub;
let api: FakeApi;
let files: MemoryFiles;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let opened: { note: OwnedRef; at?: NoteLanding }[];

async function keep(at: string): Promise<void> {
	await files.write(at, new TextEncoder().encode('export const one = 1;\n'));
}

function show(): void {
	mounted = mount(DocumentingSheet, {
		target,
		props: {
			open: true,
			project: files,
			onOpen: (note: OwnedRef, at?: NoteLanding) =>
				opened.push({ note, ...(at === undefined ? {} : { at }) })
		}
	});
	flushSync();
}

/** The sheet standing at the list, on what the survey proposed. */
async function atTheList(proposes: ProposedPlace[]): Promise<void> {
	stub.proposes = proposes;
	await documenting.opened(HOME);
	show();
	await settle();
	named('Look over the code')?.click();
	await settle();
}

beforeEach(async () => {
	nodes.clear();
	documenting.clear();
	opened = [];
	stub = new Stub();
	files = new MemoryFiles({ root: PROJECT, store: new Map(), data: '/data' });
	api = useFakeApi();
	session.adopt(VIEWER, 'a-session');
	initRuntime({ apiHost: () => 'http://api.test', documenting: stub });
	seamSettledAgain();
	stubViewport(390);
	Object.defineProperty(globalThis, 'ResizeObserver', {
		configurable: true,
		writable: true,
		value: class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	});
	Element.prototype.hasPointerCapture = () => false;
	Element.prototype.setPointerCapture = () => {};
	Element.prototype.releasePointerCapture = () => {};
	Element.prototype.scrollIntoView = () => {};
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	documenting.clear();
	nodes.clear();
	session.clear();
	initRuntime({ apiHost: () => '', documenting: undefined });
	seamSettledAgain();
	target.remove();
	document.body.innerHTML = '';
});

describe('a device with nothing to ask', () => {
	it('says so in one line and offers nothing that would fail', async () => {
		stub.tool = [];
		await documenting.opened(HOME);
		show();
		await settle();

		expect(screen()).toContain('Claude Code');
		expect(screen()).toContain('not on this machine');
		expect(named('Look over the code')).toBeUndefined();
		expect(field('What you want written about, and why')).toBeNull();
	});

	it('looks again for one somebody has just installed', async () => {
		stub.tool = [];
		await documenting.opened(HOME);
		show();
		await settle();

		stub.tool = ['claude_code'];
		named('Look again')?.click();
		await settle();

		expect(field('What you want written about, and why')).not.toBeNull();
	});

	it('says an ask that went nowhere went nowhere, not that there is nothing', async () => {
		stub.untold = true;
		await documenting.opened(HOME);
		show();
		await settle();

		expect(screen()).toContain('could not tell');
		expect(screen()).not.toContain('not on this machine');
		expect(screen()).not.toContain('bridge');
		expect(named('Look again')).toBeDefined();
	});
});

describe('saying what you want', () => {
	it('opens on the words, and nothing has been asked of the tool', async () => {
		await documenting.opened(HOME);
		show();
		await settle();

		expect(field('What you want written about, and why')).not.toBeNull();
		expect(named('Look over the code')).toBeDefined();
		expect(stub.surveys).toHaveLength(0);
		expect(stub.plans).toHaveLength(0);
	});

	it('carries what was typed into the survey', async () => {
		await documenting.opened(HOME);
		show();
		await settle();
		type(field('What you want written about, and why'), 'How the reading works');
		named('Look over the code')?.click();
		await settle();

		expect(stub.surveys).toEqual([{ said: 'How the reading works' }]);
	});

	it('keeps what was typed when somebody dismisses the sheet and opens it again', async () => {
		await documenting.opened(HOME);
		show();
		await settle();
		type(field('What you want written about, and why'), 'Half a thought');

		if (mounted) unmount(mounted, { outro: false });
		mounted = undefined;
		show();
		await settle();

		expect(field('What you want written about, and why')?.value).toBe('Half a thought');
	});
});

describe('the list somebody settles', () => {
	beforeEach(async () => {
		await keep('src/ink.ts');
		await keep('src/parser.ts');
		await atTheList([
			{ path: 'src/parser.ts', reason: 'Everything reading goes through here' },
			{ path: 'docs', reason: 'What is already written down' }
		]);
	});

	it('shows each place with the reason it was proposed, and writes nothing yet', () => {
		expect(screen()).toContain('src/parser.ts');
		expect(screen()).toContain('Everything reading goes through here');
		expect(screen()).toContain('docs');
		expect(stub.plans).toHaveLength(0);
	});

	it('takes a place out', async () => {
		labelled('Leave out docs')?.click();
		await settle();

		expect(screen()).not.toContain('What is already written down');
		named('Write these notes')?.click();
		await settle();
		expect(stub.plans[0].places.map((place) => place.path)).toEqual(['src/parser.ts']);
	});

	it('writes about a place moved earlier first', async () => {
		labelled('Write about docs earlier')?.click();
		await settle();
		named('Write these notes')?.click();
		await settle();

		expect(stub.plans[0].places.map((place) => place.path)).toEqual(['docs', 'src/parser.ts']);
	});

	it('adds a place out of the project, with no reason on it', async () => {
		type(field('Add somewhere else in the project'), 'ink');
		await settle();
		named('src/ink.ts')?.click();
		await settle();
		named('Write these notes')?.click();
		await settle();

		expect(stub.plans[0].places[2]).toEqual({ path: 'src/ink.ts' });
	});

	it('offers nothing of the project that is already on the list', async () => {
		type(field('Add somewhere else in the project'), 'parser');
		await settle();

		expect(named('src/parser.ts')).toBeUndefined();
	});

	it('says a place that has a note already comes back as a change to take in', async () => {
		documenting.clear();
		await atTheList([{ path: 'src/parser.ts', note: PARSER }]);

		expect(screen()).toContain('Changes the note already here');
	});
});

describe('the run', () => {
	beforeEach(async () => {
		api.on('GET /nodes', () => [node(1, '1', { title: 'The parser' })]);
		await nodes.load({ graph: HOME });
		await atTheList([{ path: 'src/parser.ts' }]);
	});

	it('says where it is now, and offers a way to stop', async () => {
		stub.reports = [{ stage: 'writing', at: 'src/parser.ts', places: [] }];
		stub.holding = true;
		named('Write these notes')?.click();
		await settle();

		expect(screen()).toContain('Writing about src/parser.ts.');
		expect(named('Stop')).toBeDefined();
		named('Stop')?.click();
		await settle();
		expect(stub.stops).toBe(1);
	});

	it('reads a note the run wrote by its own title', async () => {
		stub.reports = [
			{
				stage: 'done',
				places: [{ path: 'src/parser.ts', note: { ref: PARSER, done: 'written' } }]
			}
		];
		named('Write these notes')?.click();
		await settle();

		expect(screen()).toContain('The parser');
		named('src/parser.ts The parser')?.click();
		await settle();
		expect(opened).toEqual([{ note: PARSER }]);
	});

	it('sends somebody to what is offered on a note they have written in', async () => {
		stub.reports = [
			{
				stage: 'done',
				places: [{ path: 'src/parser.ts', note: { ref: PARSER, done: 'offered' } }]
			}
		];
		named('Write these notes')?.click();
		await settle();

		expect(screen()).toContain('A change is offered on it');
		const row = [...document.body.querySelectorAll('button')].find((one) =>
			one.textContent?.includes('A change is offered on it')
		);
		row?.click();
		await settle();
		expect(opened).toEqual([{ note: PARSER, at: 'offers' }]);
	});

	it('says a place the run had nothing to say about, and offers nothing to read', async () => {
		stub.reports = [{ stage: 'done', places: [{ path: 'src/parser.ts' }] }];
		named('Write these notes')?.click();
		await settle();

		expect(screen()).toContain('Nothing to say about this one.');
		expect(
			[...document.body.querySelectorAll('button')].map((one) => one.textContent)
		).not.toContain('src/parser.ts');
	});

	it('says a run that got nowhere wrote nothing', async () => {
		stub.reports = [{ stage: 'stopped', places: [] }];
		named('Write these notes')?.click();
		await settle();

		expect(screen()).toContain('Nothing was written.');
	});

	it('carries the words of a run that could not go on', async () => {
		stub.reports = [
			{ stage: 'stopped', places: [], trouble: 'That is more than Sloppy can read at once.' }
		];
		named('Write these notes')?.click();
		await settle();

		expect(screen()).toContain('That is more than Sloppy can read at once.');
	});
});

describe('what a person is told', () => {
	it('names no machinery anywhere in the four steps', async () => {
		await atTheList([{ path: 'src/parser.ts', reason: 'The reading' }]);
		stub.reports = [
			{
				stage: 'done',
				places: [{ path: 'src/parser.ts', note: { ref: PARSER, done: 'offered' } }]
			}
		];
		named('Write these notes')?.click();
		await settle();

		const said = screen().toLowerCase();
		for (const word of ['spawn', 'stdout', 'exit code', 'process', 'token', 'binary', 'agent']) {
			expect(said).not.toContain(word);
		}
	});
});

describe('the tags on the list somebody settles', () => {
	const PATH = 'src/parser.ts';

	it('shows what each place would be tagged', async () => {
		await atTheList([{ path: PATH, tags: ['parsing', 'protocol'] }]);

		expect(screen()).toContain('parsing');
		expect(screen()).toContain('protocol');
	});

	it('takes one off without taking the place off', async () => {
		await atTheList([{ path: PATH, tags: ['parsing', 'protocol'] }]);

		labelled(`Do not tag ${PATH} parsing`)?.click();
		await settle();

		expect(screen()).toContain(PATH);
		expect(screen()).not.toContain('parsing');
		expect(screen()).toContain('protocol');
	});

	it('runs on the tags that survived', async () => {
		await atTheList([{ path: PATH, tags: ['parsing', 'protocol'] }]);
		labelled(`Do not tag ${PATH} protocol`)?.click();
		await settle();

		named('Write these notes')?.click();
		await settle();

		expect(stub.plans[0].places).toEqual([{ path: PATH, tags: ['parsing'] }]);
	});

	it('shows no tags on a place nothing was suggested for', async () => {
		await atTheList([{ path: PATH }]);

		expect(labelled(`Do not tag ${PATH} parsing`)).toBeUndefined();
	});
});

describe('the tags a run suggests at the end', () => {
	const PATH = 'src/parser.ts';

	beforeEach(async () => {
		api.on('GET /nodes', () => [node(1, '1', { title: 'The parser', tags: ['protocol'] })]);
		await nodes.load({ graph: HOME });
		await atTheList([{ path: PATH }]);
		stub.reports = [
			{
				stage: 'done',
				places: [
					{
						path: PATH,
						note: { ref: PARSER, done: 'written', suggested: ['parsing'] }
					}
				]
			}
		];
	});

	it('shows them, and says nothing is on until the person says so', async () => {
		named('Write these notes')?.click();
		await settle();

		expect(screen()).toContain('Tags it suggests. Nothing goes on until you say so.');
		expect(named('Tag it parsing')).toBeDefined();
	});

	it('puts them on the note when the person asks, and stops offering', async () => {
		const wrote: unknown[] = [];
		api.on(
			`PATCH /nodes/${encodeURIComponent(PARSER.slice(0, PARSER.lastIndexOf('/')))}/${encodeURIComponent(PARSER.slice(PARSER.lastIndexOf('/') + 1))}`,
			(_url, init) => {
				wrote.push(JSON.parse(String(init?.body)));
				return node(1, '1', { title: 'The parser', tags: ['parsing', 'protocol'] });
			}
		);
		named('Write these notes')?.click();
		await settle();

		named('Tag it parsing')?.click();
		await settle();

		expect(wrote).toEqual([{ tags: ['protocol', 'parsing'] }]);
		expect(named('Tag it parsing')).toBeUndefined();
	});

	it('offers nothing where the run suggested none', async () => {
		stub.reports = [
			{ stage: 'done', places: [{ path: PATH, note: { ref: PARSER, done: 'written' } }] }
		];
		named('Write these notes')?.click();
		await settle();

		expect(screen()).not.toContain('Tags it suggests.');
	});
});
