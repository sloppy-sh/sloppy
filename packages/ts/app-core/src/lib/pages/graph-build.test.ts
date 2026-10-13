// Having assistants build what a note says the project is for, from the graph
// the note is in — DESIGN.md § "A build". Nothing here starts a program: the
// seam and the builds are both stand-ins.

import 'fake-indexeddb/auto';
import { DeviceThreads, MemoryBuilds, MemoryFiles, MemoryHistory } from '@sloppy/local';
import {
	buildLine,
	ulid,
	type BuildHandoff,
	type BuildTask,
	type ChatAgent,
	type NodeView,
	type OwnedRef
} from '@sloppy/types';
import { GRAPH_FILE, graphFile, notePath, VAULT_FORMAT } from '@sloppy/vault';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildsHere, theBuilds } from '../components/build-face.svelte.js';
import { BuildsStandIn } from '../components/build-face.test-support.svelte.js';
import { type ChatAccess, type ChatLive, initRuntime, updateRuntime } from '../runtime.js';
import { seamSettledAgain } from '../seam.svelte.js';
import { canvasInk } from '../stores/canvas-ink.svelte.js';
import { chat } from '../stores/chat.svelte.js';
import { find } from '../stores/find.svelte.js';
import { graphs } from '../stores/graphs.svelte.js';
import { graphHistory } from '../stores/history.svelte.js';
import { nodes } from '../stores/nodes.svelte.js';
import { offers } from '../stores/offers.svelte.js';
import { outlineSections } from '../stores/outline-sections.svelte.js';
import { peers } from '../stores/peers.svelte.js';
import { prefs } from '../stores/prefs.svelte.js';
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
const VAULT = ref(2);

function segments(of: OwnedRef): string {
	const cut = of.lastIndexOf('/');
	return `${encodeURIComponent(of.slice(0, cut))}/${encodeURIComponent(of.slice(cut + 1))}`;
}
const path = (of: OwnedRef) => `/nodes/${segments(of)}`;

class Stub implements ChatAccess {
	agent: readonly ChatAgent[] = ['claude_code'];

	agents(): Promise<ChatAgent[]> {
		return Promise.resolve([...this.agent]);
	}

	open(): Promise<ChatLive> {
		return Promise.resolve({
			say: () => Promise.resolve(),
			stop: () => Promise.resolve(),
			close: () => Promise.resolve()
		});
	}
}

/** Phone by default; the desk is the same parts with room, so the suite asks
 *  for both from one stub — DESIGN.md § Layout. */
let wide = false;

function stubViewport(): void {
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: (query: string) => ({
			matches: wide && query.includes('min-width'),
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
	for (let turn = 0; turn < 10; turn += 1) {
		await new Promise((done) => setTimeout(done, 0));
		flushSync();
	}
	for (let frame = 0; frame < 3; frame += 1) await new Promise(requestAnimationFrame);
	flushSync();
}

const screen = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

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

function pressed(words: string): void {
	const found = [...document.body.querySelectorAll('button')].find(
		(one) => one.textContent?.trim() === words
	);
	if (!found) throw new Error(`Nothing on screen says "${words}"`);
	found.click();
	flushSync();
}

const offered = (words: string): boolean =>
	[...document.body.querySelectorAll('button')].some((one) => one.textContent?.trim() === words);

function typeName(said: string): void {
	const field = document.body.querySelector<HTMLInputElement>(
		'input[aria-label="What to call this build"]'
	);
	if (!field) throw new Error('Nothing asks what to call the build');
	field.value = said;
	field.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

let api: FakeApi;
let files: MemoryFiles;
let serving: MemoryFiles | undefined;
let stub: Stub;
let builds: BuildsStandIn;
let dropFace: (() => void) | undefined;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let held: NodeView[];

function installGraph(): void {
	held = [node(1, '1', { title: 'The parser' }), node(2, '1a', { title: 'The vault' })];
	api.on('GET /nodes/tags', () => []);
	api.on('GET /nodes', (url) => {
		const origin = url.searchParams.get('origin');
		return held.filter((one) => (origin ? one.origin === origin : one.ref === one.origin));
	});
	api.on('GET /publications', () => []);
	for (const one of held) {
		api.on(`GET ${path(one.ref)}`, () => one);
		api.on(`GET ${path(one.ref)}/blocks`, () => []);
	}
}

async function open(): Promise<void> {
	if (mounted) unmount(mounted, { outro: false });
	session.adopt(VIEWER, 'a-session');
	mounted = mount(Graph, { target });
	flushSync();
	await settle();
}

/** One note's mark on the canvas, by the address it is drawn with. */
function mark(address: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('[aria-label="The graph"] button')].find(
		(one) => one.textContent?.trim().split(/\s+/)[0] === address
	);
	if (!found) throw new Error(`No note addressed ${address} is drawn`);
	return found as HTMLButtonElement;
}

/** The menu a press on a mark raises, which is the way in on both surfaces. */
async function markMenu(address: string): Promise<void> {
	document.body.querySelector<HTMLButtonElement>(`[data-menu="${address}"]`)?.click();
	await settle();
}

/** Choosing a set of notes, then the bar they are acted on from. */
async function choose(address: string): Promise<void> {
	await markMenu(address);
	menuItem('Choose this and others').click();
	await settle();
}

beforeEach(async () => {
	startAt('/');
	wide = false;
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
	builds = new BuildsStandIn(HOME, PROJECT);
	dropFace = buildsHere.offers(builds);
	prefs.set('aiOffered', true);
	initRuntime({
		apiHost: () => 'http://api.test',
		project: async () => serving,
		chat: stub,
		threads: new DeviceThreads(files)
	});
	seamSettledAgain();
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	dropFace?.();
	dropFace = undefined;
	prefs.set('aiOffered', false);
	chat.clear();
	offers.clear();
	session.clear();
	initRuntime({ apiHost: () => '', project: undefined, chat: undefined });
	seamSettledAgain();
	target.remove();
	document.body.innerHTML = '';
});

describe('where the act to build stands', () => {
	it('is on a note’s menu, on a graph that is a project', async () => {
		await open();
		await markMenu('1');

		expect(offeredInMenu()).toContain('Build this');
	});

	it('is on a note’s menu with the graph beside it, where there is room for both', async () => {
		wide = true;
		await open();
		await markMenu('1');

		expect(offeredInMenu()).toContain('Build this');
	});

	it('is on the bar of a chosen set, and on the menu over it', async () => {
		await open();
		await choose('1');

		expect(offered('Build these')).toBe(true);

		await markMenu('1');
		expect(offeredInMenu()).toContain('Build this');
	});

	it('says how many it would build, where more than one is chosen', async () => {
		await open();
		await choose('1');
		mark('1a').click();
		await settle();

		expect(offeredInMenu()).toEqual([]);
		await markMenu('1');
		expect(offeredInMenu()).toContain('Build these 2');
	});

	it('is in the palette, where a note is open to build', async () => {
		await open();
		expect(await inThePalette()).not.toContain('Build this');

		mark('1').click();
		await settle();

		expect(await inThePalette()).toContain('Build this');
	});

	it('is nowhere on a graph that is nobody’s project', async () => {
		serving = undefined;
		await open();
		await markMenu('1');

		expect(offeredInMenu()).not.toContain('Build this');
	});

	it('is nowhere until the person has asked for an assistant', async () => {
		prefs.set('aiOffered', false);
		await open();
		await markMenu('1');

		expect(offeredInMenu()).not.toContain('Build this');
	});

	it('is nowhere on a device that cannot build at all', async () => {
		dropFace?.();
		dropFace = undefined;
		await open();
		await markMenu('1');

		expect(offeredInMenu()).not.toContain('Build this');
	});

	it('is nowhere while a build already stands on this project', async () => {
		await open();
		await markMenu('1');
		menuItem('Build this').click();
		await settle();
		pressed('Never mind');
		await builds.begin([PARSER], 'the-parser');
		await settle();
		await markMenu('1');

		expect(offeredInMenu()).not.toContain('Build this');
	});
});

/** Everything the palette offers, which is where an act is reached by name. */
async function inThePalette(): Promise<string[]> {
	window.dispatchEvent(
		new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true })
	);
	await settle();
	const said = [...document.body.querySelectorAll('[role="option"]')].map((row) =>
		(row.textContent ?? '').replace(/\s+/g, ' ').trim()
	);
	window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
	await settle();
	return said;
}

describe('naming the build before anything is kept', () => {
	async function askedFor(address = '1'): Promise<void> {
		await open();
		await markMenu(address);
		menuItem('Build this').click();
		await settle();
	}

	it('asks for a name, and starts the build on the note it was asked from', async () => {
		await askedFor();
		typeName('The reader');
		pressed('Start the build');
		await settle();

		expect(builds.began).toEqual([{ about: [PARSER], name: 'the-reader' }]);
	});

	it('refuses a name something here is already called, in words', async () => {
		builds.lines.add(buildLine('the-reader'));
		await askedFor();
		typeName('the reader');
		pressed('Start the build');
		await settle();

		expect(screen()).toContain('A line of work is already called the-reader.');
		expect(builds.began).toEqual([]);
	});

	it('asks again where nothing in what was typed could be a name', async () => {
		await askedFor();
		typeName('···');
		pressed('Start the build');
		await settle();

		expect(screen()).toContain('Give the build a name with a letter or a digit in it.');
		expect(builds.began).toEqual([]);
	});

	it('costs nothing where the reader changes their mind', async () => {
		await askedFor();
		pressed('Never mind');
		await settle();

		expect(builds.began).toEqual([]);
		expect(builds.standing).toBeNull();
	});

	it('says in one line that it needs an assistant on this machine', async () => {
		stub.agent = ['anthropic'];
		builds.reaches = false;
		await askedFor();

		expect(screen()).toContain('and it is not on this machine');
		expect(offered('Start the build')).toBe(false);
	});

	it('is asked for every note of a chosen set at once', async () => {
		await open();
		await choose('1');
		mark('1a').click();
		await settle();
		pressed('Build these');
		await settle();
		typeName('both');
		pressed('Start the build');
		await settle();

		expect(builds.began[0]?.about).toEqual([PARSER, VAULT]);
	});
});

describe('the build in the dock', () => {
	/** A build begun the way a person begins one: the act on the note, the name,
	 *  Start the build. Nothing else is pressed. */
	async function started(): Promise<void> {
		await open();
		await markMenu('1');
		menuItem('Build this').click();
		await settle();
		typeName('The reader');
		pressed('Start the build');
		await settle();
	}

	/** A chat read before the build was begun, so the dock has somewhere else it
	 *  would open. */
	async function aChatRead(): Promise<void> {
		const when = new Date().toISOString();
		await new DeviceThreads(files).write({
			id: ulid(),
			name: 'About the parser',
			graph: graphs.current,
			project: PROJECT,
			created_at: when,
			updated_at: when,
			places: [],
			turns: []
		});
		document.body.querySelector<HTMLButtonElement>('[aria-label="More"]')?.click();
		await settle();
		menuItem('Chat about the code').click();
		await settle();
	}

	it('stands as the card at the head of its own thread, from the press', async () => {
		await started();

		const card = document.body.querySelector('[data-build-card]');
		expect(card).not.toBeNull();
		expect(card?.textContent).toContain('the-reader');
		expect(card?.querySelector('[data-build-state="reading"]')?.textContent).toContain(
			'Reading your notes'
		);
	});

	// The press is what opens the dock, so what it opens on is the build — not
	// whichever chat the reader was last in.
	it('opens on the build where a chat was already being read', async () => {
		await open();
		await aChatRead();
		expect(document.body.querySelector('[data-build-card]')).toBeNull();

		await markMenu('1');
		menuItem('Build this').click();
		await settle();
		typeName('The reader');
		pressed('Start the build');
		await settle();

		expect(document.body.querySelector('[data-build-card]')?.textContent).toContain('the-reader');
	});

	it('says where it has got to beside it in the list of threads', async () => {
		await started();
		document.body.querySelector<HTMLButtonElement>('[aria-label="Which thread"]')?.click();
		await settle();

		expect(screen()).toContain('reading your notes');
	});

	it('builds the plan the reader pressed Go on', async () => {
		await started();
		const held = builds.standing;
		if (!held) throw new Error('no build');
		builds.put({
			...held,
			state: 'answering',
			plan: {
				tasks: [
					{
						id: 'reader',
						title: 'Read the notes first',
						effect: 'It reads the note saying what the thing is for.',
						paths: ['src/parser.ts'],
						notes: [PARSER]
					}
				],
				needs: [],
				disputes: [],
				checks: []
			},
			tasks: { reader: { state: 'waiting', handoffs: [], needs: [], rounds: 0 } }
		});
		await settle();
		pressed('Go');
		await settle();

		expect(builds.went).toBe(1);
	});

	/** A question standing to be answered, so the acts on it are on screen. */
	async function asking(): Promise<void> {
		await started();
		const standing = builds.standing;
		if (!standing) throw new Error('no build');
		builds.put({
			...standing,
			state: 'answering',
			plan: {
				tasks: [
					{
						id: 'reader',
						title: 'Read the notes first',
						effect: 'It reads the note saying what the thing is for.',
						paths: ['src/parser.ts'],
						notes: [PARSER]
					}
				],
				needs: [
					{
						id: 'units',
						question: 'Which way does the reader go when a note names no file?',
						why: 'The reader cannot be written until the notes say.'
					}
				],
				disputes: [],
				checks: []
			},
			tasks: { reader: { state: 'waiting', handoffs: [], needs: [], rounds: 0 } }
		});
		await settle();
	}

	/** The note the fake answers a write with. */
	const WROTE = ref(9);
	function writesANote(): void {
		const one = node(9, '3', { title: 'Where the reader goes' });
		held = [...held, one];
		api.on('POST /nodes', () => one);
		api.on(`GET ${path(WROTE)}`, () => one);
		api.on(`GET ${path(WROTE)}/blocks`, () => []);
	}

	const wrote = () => api.calls.filter((call) => call.startsWith('POST /nodes')).length;

	it('answers the question with the note written for it', async () => {
		await asking();
		writesANote();

		pressed('Write the note');
		await settle();

		expect(builds.answered).toEqual([{ need: 'units', note: WROTE }]);
	});

	// The question is held on the asking itself, so a write that never landed
	// cannot be answered by whatever note the reader writes next.
	it('leaves the question unanswered where the note written for it never landed', async () => {
		await asking();
		api.on('POST /nodes', () => {
			throw new Error('nothing is listening');
		});

		pressed('Write the note');
		await settle();
		expect(screen()).toContain('Sloppy could not add that note');

		writesANote();
		mark('1a').click();
		await settle();
		pressed('Write a note under this');
		await settle();

		expect(wrote()).toBe(2);
		expect(screen()).toContain('Where the reader goes');
		expect(builds.answered).toEqual([]);
	});
	describe('the line the build wrote', () => {
		const LINE = buildLine('the-reader');
		const NOTE = notePath(ulid());
		const TASK: BuildTask = {
			id: 'reader',
			title: 'Read the notes first',
			effect: 'It reads the note saying what the thing is for.',
			paths: ['src/parser.ts'],
			notes: [PARSER]
		};
		const HANDOFF: BuildHandoff = {
			summary: 'The reader reads the note first.',
			files: ['src/parser.ts'],
			checks: [],
			notes: [PARSER],
			undone: '',
			finished: true
		};

		let kept: MemoryHistory;

		const wrote = (said: string) => new TextEncoder().encode(`${said}\n`);
		const said = async (path: string): Promise<string> =>
			new TextDecoder().decode((await files.read(path)) ?? new Uint8Array());

		/** The build built, with its line standing and the reader on their own. */
		async function finished(): Promise<void> {
			await started();
			const held = builds.standing;
			if (!held) throw new Error('no build');
			builds.put({
				...held,
				state: 'built',
				plan: { tasks: [TASK], needs: [], disputes: [], checks: [] },
				tasks: { reader: { state: 'merged', handoffs: [HANDOFF], needs: [], rounds: 0 } },
				merges: [{ task: 'reader', settled: true, conflicts: [] }]
			});
			await settle();
			kept = new MemoryHistory(files, { branch: 'main', author: 'Ada' });
			updateRuntime({ history: () => kept });
		}

		/** The build’s line, with one note written on it since the fork. */
		async function theLine(): Promise<void> {
			// The folder is a graph's, so a state of it reads as one — which is what
			// a note left in two versions is named out of.
			await files.write(
				GRAPH_FILE,
				graphFile({ format: VAULT_FORMAT, graph: ulid(), name: 'My graph', owner: DID })
			);
			await files.write(NOTE, wrote('What the notes said at the fork'));
			await kept.commit('A first version');
			await kept.branch(LINE);
			await kept.switch(LINE);
			await files.write(NOTE, wrote('What the build wrote'));
			await kept.commit('What the build wrote');
			await kept.switch('main');
		}

		afterEach(() => {
			graphHistory.clear();
			updateRuntime({ history: undefined });
		});

		it('brings it in, and says so where nothing was in two versions', async () => {
			await finished();
			await theLine();

			pressed('Bring it in');
			await settle();

			expect(
				document.body.querySelector('[data-build-merge="line"]')?.textContent?.replace(/\s+/g, ' ')
			).toContain('brought in');
		});

		// The merge leaves the notes both sides wrote in for somebody to choose
		// between, and refuses nothing — so the card has to say so itself.
		it('says what is in two versions, and opens where they are settled', async () => {
			await finished();
			await theLine();
			await files.write(NOTE, wrote('What the reader wrote'));
			await kept.commit('What the reader wrote');

			pressed('Bring it in');
			await settle();

			expect(screen()).toContain(
				'One note is in two versions: the build and you both wrote in it.'
			);
			expect(screen()).toContain(
				'Choose what it says, then keep a version to finish bringing it in.'
			);
			expect(screen()).toContain(`Bringing in ${LINE}`);
			expect(
				document.body.querySelector('[data-build-merge="line"]')?.textContent?.replace(/\s+/g, ' ')
			).toContain('part way in, with notes in two versions');
		});

		// Pressing it again is not a second merge: the one underway is where the
		// reader is sent, rather than refused in the history’s own words.
		it('sends the reader back to settle them rather than refusing', async () => {
			await finished();
			await theLine();
			await files.write(NOTE, wrote('What the reader wrote'));
			await kept.commit('What the reader wrote');
			pressed('Bring it in');
			await settle();

			pressed('Bring it in');
			await settle();

			expect(screen()).not.toContain('Finish the merge you are in the middle of first.');
			expect(screen()).toContain('One note is in two versions');
		});

		it('says why where the bring-in was refused before anything moved', async () => {
			await finished();

			pressed('Bring it in');
			await settle();

			expect(screen()).toContain(`There is nothing here called ${LINE}.`);
			expect(
				document.body.querySelector('[data-build-merge="line"]')?.textContent?.replace(/\s+/g, ' ')
			).toContain('yours to take');
		});

		// The line is opened and written to while the build runs, and on a phone
		// there is no column of versions for a reader to have opened.
		it('stands the reader on the version the line is at, with the lines unread', async () => {
			await finished();
			await theLine();

			pressed('Work on this version');
			await settle();

			expect(await said(NOTE)).toContain('What the build wrote');
		});

		// The tasks go into the line after the card was first drawn, so the head
		// the act takes is the one the line stands at when it is pressed.
		it('takes the version the line stands at now, not the one last read', async () => {
			await finished();
			await theLine();
			await graphHistory.read();
			await kept.switch(LINE);
			await files.write(NOTE, wrote('What the merges put in'));
			await kept.commit('What the merges put in');
			await kept.switch('main');

			pressed('Work on this version');
			await settle();

			expect(await said(NOTE)).toContain('What the merges put in');
		});

		it('says why where there is no such line to work on', async () => {
			await finished();

			pressed('Work on this version');
			await settle();

			expect(screen()).toContain(`There is nothing here called ${LINE}.`);
		});
	});
});

describe('what stands behind the card', () => {
	/** The shell a build needs: one that holds the lines and the copies it works
	 *  in. The stand-in every other test here offers is not one of those. */
	class Holds extends Stub {
		readonly builds = new MemoryBuilds(files);
	}

	it('is the store that runs the phases, which the page offers where a build can run', async () => {
		updateRuntime({ chat: new Holds() });
		seamSettledAgain();

		await open();

		expect(buildsHere.face).toBe(theBuilds);
	});

	it('is left to whatever else was offered where the shell holds none', async () => {
		await open();

		expect(buildsHere.face).toBe(builds);
	});
});
