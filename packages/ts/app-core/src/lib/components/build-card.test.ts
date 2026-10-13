// The card a build is read on, in every state it stands in — DESIGN.md
// § "A build". Nothing here starts a program: the card is handed a build.

import 'fake-indexeddb/auto';
import {
	buildLine,
	ulid,
	type Build,
	type BuildCheck,
	type BuildFinding,
	type BuildHandoff,
	type BuildNeed,
	type BuildState,
	type BuildTask,
	type BuildTaskRun,
	type ContextUsage,
	type OwnedRef,
	type Ulid
} from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DID, homeOf, node, ref, useFakeApi, VIEWER } from '../stores/fake-api.test-support.js';
import { nodes } from '../stores/nodes.svelte.js';
import { session } from '../stores/session.svelte.js';
import { citedAs } from './build-said.js';

// The bar is its own file's test; what belongs here is whether the card draws
// one for the session working on a task.
vi.mock('./context-chart.svelte', async () => ({
	default: (await import('./context-chart.test-support.svelte')).default
}));

const BuildCard = (await import('./build-card.svelte')).default;

const HOME = homeOf(DID);
const PARSER = ref(1);
const VAULT = ref(2);
const CONVERSATION = ulid();

const PLAN_TASK: BuildTask = {
	id: 'reader',
	title: 'Read the notes first',
	effect: 'The agent looks for the note saying what a thing is for.',
	paths: ['src/reader.ts'],
	notes: [PARSER]
};

function build(over: Partial<Build> = {}): Build {
	return {
		id: ulid(),
		graph: HOME,
		project: '/home/ada/garden',
		about: [PARSER],
		name: 'the-reader',
		line: buildLine('the-reader'),
		from: 'c0',
		state: 'reading',
		answers: {},
		tasks: {},
		sessions: [],
		merges: [],
		created: new Date().toISOString(),
		...over
	};
}

const QUESTION: BuildNeed = {
	id: 'units',
	about: PARSER,
	question: 'Which way does the reader go when a note names no file?',
	why: 'The reader cannot be written until the notes say.'
};

const HANDOFF: BuildHandoff = {
	summary: 'The reader reads the note first and asks where none says.',
	files: ['src/reader.ts'],
	checks: [],
	notes: [VAULT],
	undone: 'Nothing about the web.',
	finished: true
};

const FINDING: BuildFinding = {
	file: 'src/reader.ts',
	line: 12,
	severity: 'blocking',
	what: 'It reads the note twice.',
	why: 'The second read is the one that lands.'
};

const CHECK: BuildCheck = { command: 'pnpm check', passed: true, said: '' };

function run(over: Partial<BuildTaskRun> = {}): BuildTaskRun {
	return { state: 'waiting', handoffs: [], needs: [], rounds: 0, ...over };
}

const USAGE: ContextUsage = {
	total: 48_000,
	limit: 200_000,
	parts: [],
	at: new Date().toISOString()
};

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
const asked = {
	go: 0,
	answered: [] as string[],
	dropped: [] as string[],
	added: [] as string[],
	removed: [] as string[],
	opened: [] as OwnedRef[],
	stopped: 0,
	carriedOn: 0,
	workedOn: 0,
	broughtIn: 0,
	discarded: 0,
	notes: 0
};

function show(held: Build, over: Record<string, unknown> = {}): void {
	mounted = mount(BuildCard, {
		target,
		props: {
			build: held,
			contextOf: (conversation: Ulid) => (conversation === CONVERSATION ? USAGE : null),
			nameOf: (note: OwnedRef) => {
				const one = nodes.get(note);
				return one && citedAs(one);
			},
			onGo: () => (asked.go += 1),
			onAnswer: (need: string) => asked.answered.push(need),
			onDrop: (need: string) => asked.dropped.push(need),
			onAddNote: (task: string) => asked.added.push(task),
			onRemoveNote: (task: string) => asked.removed.push(task),
			onOpen: (note: OwnedRef) => asked.opened.push(note),
			onStop: () => (asked.stopped += 1),
			onCarryOn: () => (asked.carriedOn += 1),
			onWorkOn: () => (asked.workedOn += 1),
			onBringIn: () => (asked.broughtIn += 1),
			onDiscard: () => (asked.discarded += 1),
			onNotes: () => (asked.notes += 1),
			...over
		}
	});
	flushSync();
}

const screen = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

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

beforeEach(async () => {
	stubViewport();
	nodes.clear();
	const api = useFakeApi();
	api.on('GET /nodes', () => [
		node(1, '1', { title: 'The parser' }),
		node(2, '1a', { title: 'The vault' })
	]);
	session.adopt(VIEWER, 'a-session');
	await nodes.load({ graph: HOME });
	target = document.createElement('div');
	document.body.appendChild(target);
	for (const key of Object.keys(asked)) {
		const held = asked[key as keyof typeof asked];
		if (Array.isArray(held)) held.length = 0;
		else (asked[key as keyof typeof asked] as number) = 0;
	}
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	nodes.clear();
	session.clear();
	target.remove();
	document.body.innerHTML = '';
});

describe('while the notes are being read', () => {
	it('says so and holds nothing to act on', () => {
		show(build({ state: 'reading' }));

		expect(screen()).toContain('Reading your notes.');
		expect(offered('Go')).toBe(false);
		expect(offered('Bring it in')).toBe(false);
		expect(document.body.querySelector('[data-build-task]')).toBeNull();
	});

	it('offers Stop, which is there throughout the work', () => {
		const working: BuildState[] = ['reading', 'answering', 'building', 'reviewing', 'merging'];
		for (const state of working) {
			show(build({ state, plan: { tasks: [PLAN_TASK], needs: [], disputes: [], checks: [] } }));
			expect(offered('Stop')).toBe(true);
			if (mounted) unmount(mounted, { outro: false });
			mounted = undefined;
			document.body.innerHTML = '';
			target = document.createElement('div');
			document.body.appendChild(target);
		}
	});
});

describe('the plan, standing to be answered', () => {
	const answering = (over: Partial<Build> = {}) =>
		build({
			state: 'answering',
			plan: {
				tasks: [PLAN_TASK],
				needs: [QUESTION],
				disputes: [{ notes: [PARSER, VAULT], what: 'One says the reader waits, the other not.' }],
				checks: ['pnpm check']
			},
			tasks: { reader: run() },
			...over
		});

	it('reads as the task it is for, its notes and where it will write', () => {
		show(answering());

		expect(screen()).toContain('Read the notes first');
		expect(screen()).toContain('The agent looks for the note saying what a thing is for.');
		expect(screen()).toContain('1 · The parser');
		expect(screen()).toContain('src/reader.ts');
	});

	it('asks its questions, says what is unanswered, and offers Go', () => {
		show(answering());

		expect(screen()).toContain('Which way does the reader go when a note names no file?');
		expect(screen()).toContain('The reader cannot be written until the notes say.');
		expect(screen()).toContain('1 question is unanswered');
		expect(offered('Go')).toBe(true);

		pressed('Go');
		expect(asked.go).toBe(1);
	});

	it('answers a question by writing a note, or by setting it aside', () => {
		show(answering());

		pressed('Write the note');
		expect(asked.answered).toEqual(['units']);

		pressed('Set it aside');
		expect(asked.dropped).toEqual(['units']);
	});

	it('asks for no second note while one is being written', () => {
		show(answering(), { writing: true });

		pressed('Write the note');
		expect(asked.answered).toEqual([]);

		pressed('Set it aside');
		expect(asked.dropped).toEqual(['units']);
	});

	it('says a question is answered where a note answers it, and offers neither act', () => {
		show(answering({ answers: { units: { note: VAULT } } }));

		expect(screen()).toContain('Answered in 1a · The vault');
		expect(offered('Write the note')).toBe(false);
		expect(screen()).not.toContain('question is unanswered');
	});

	it('says a question was set aside', () => {
		show(answering({ answers: { units: { dropped: true } } }));

		expect(screen()).toContain('Set aside.');
	});

	it('lets the reader add a note to a task and take one off', () => {
		show(answering());

		const off = document.body.querySelector<HTMLButtonElement>(
			'[aria-label="Leave 1 · The parser out of Read the notes first"]'
		);
		expect(off).not.toBeNull();
		off?.click();
		flushSync();
		expect(asked.removed).toEqual(['reader']);

		pressed('Add a note');
		expect(asked.added).toEqual(['reader']);
	});

	it('reports a disagreement and settles none of it', () => {
		show(answering());

		expect(screen()).toContain('One says the reader waits, the other not.');
		expect(offered('Settle it')).toBe(false);
	});

	it('is read with nothing to answer where the plan asks nothing, and Go first', () => {
		show(
			build({
				state: 'answering',
				plan: { tasks: [PLAN_TASK], needs: [], disputes: [], checks: [] },
				tasks: { reader: run() }
			})
		);

		expect(screen()).not.toContain('Needs');
		expect(screen()).not.toContain('question is unanswered');
		expect(offered('Go')).toBe(true);
	});
});

describe('while the work runs', () => {
	const building = (over: Partial<Build> = {}) =>
		build({
			state: 'building',
			plan: { tasks: [PLAN_TASK], needs: [], disputes: [], checks: ['pnpm check'] },
			tasks: { reader: run({ state: 'building' }) },
			sessions: [{ conversation: CONVERSATION, role: 'implementer', task: 'reader' }],
			...over
		});

	it('says where each task has got to', () => {
		show(building());

		const row = document.body.querySelector('[data-build-task="reader"]');
		expect(row?.querySelector('[data-task-state="building"]')?.textContent?.trim()).toBe(
			'Building'
		);
	});

	it('draws the bar for the session working on it', () => {
		show(building());

		const bar = document.body.querySelector('[data-slot="context-chart"]');
		expect(bar?.textContent).toContain('48000 of 200000');
	});

	it('leaves the notes alone once the work has started', () => {
		show(building());

		expect(
			document.body.querySelector('[aria-label="Leave 1 · The parser out of Read the notes first"]')
		).toBeNull();
		expect(offered('Add a note')).toBe(false);
	});

	it('says which task a question raised mid-task is holding', () => {
		show(
			building({
				tasks: { reader: run({ state: 'asking', needs: [{ ...QUESTION, id: 'where' }] }) }
			})
		);

		expect(screen()).toContain('Read the notes first is held until this is answered.');
		expect(
			document.body.querySelector('[data-build-task="reader"] [data-task-state="asking"]')
				?.textContent
		).toContain('Held on a question');
	});

	it('draws what a review found, each with its place and why', () => {
		show(
			building({
				state: 'reviewing',
				tasks: {
					reader: run({
						state: 'reviewing',
						handoffs: [HANDOFF],
						review: { clean: false, findings: [FINDING] },
						rounds: 1
					})
				}
			})
		);

		const found = document.body.querySelector('[data-build-finding="blocking"]');
		expect(found?.textContent).toContain('src/reader.ts:12');
		expect(found?.textContent).toContain('It reads the note twice.');
		expect(found?.textContent).toContain('The second read is the one that lands.');
	});

	it('says what a task left undone', () => {
		show(building({ tasks: { reader: run({ state: 'built', handoffs: [HANDOFF] }) } }));

		expect(screen()).toContain('Left undone: Nothing about the web.');
	});
});

describe('what was built', () => {
	const built = (over: Partial<Build> = {}) =>
		build({
			state: 'built',
			plan: { tasks: [PLAN_TASK], needs: [], disputes: [], checks: ['pnpm check'] },
			tasks: { reader: run({ state: 'merged', handoffs: [HANDOFF] }) },
			merges: [{ task: 'reader', settled: true, conflicts: [] }],
			checked: [CHECK],
			...over
		});

	it('says what was built, where it wrote, and what the checks said', () => {
		show(built());

		expect(screen()).toContain('The reader reads the note first and asks where none says.');
		expect(screen()).toContain('src/reader.ts');
		expect(screen()).toContain('pnpm check');
		expect(document.body.querySelector('[data-build-check="passed"]')?.textContent).toContain(
			'Nothing to fix'
		);
	});

	it('names the notes it wrote and opens them against the reader’s own', () => {
		show(built());

		pressed('1a · The vault');
		expect(asked.opened).toEqual([VAULT]);

		pressed('See them against your own');
		expect(asked.notes).toBe(1);
	});

	it('lists each merge, and the line into the reader’s own as theirs to take', () => {
		show(built());

		expect(
			document.body.querySelector('[data-build-merge="reader"]')?.textContent?.replace(/\s+/g, ' ')
		).toContain('Read the notes first into the line — it went in by itself');
		expect(
			document.body.querySelector('[data-build-merge="line"]')?.textContent?.replace(/\s+/g, ' ')
		).toContain('the-reader into your own — yours to take');
	});

	it('says what it took to settle a merge that did not go in by itself', () => {
		show(built({ merges: [{ task: 'reader', settled: true, conflicts: ['src/reader.ts'] }] }));

		expect(
			document.body.querySelector('[data-build-merge="reader"]')?.textContent?.replace(/\s+/g, ' ')
		).toContain('settled in 1 file');
	});

	it('says the line is in once it has been brought in', () => {
		show(built({}), { taken: true });

		expect(
			document.body.querySelector('[data-build-merge="line"]')?.textContent?.replace(/\s+/g, ' ')
		).toContain('brought in');
	});

	it('offers the three acts, and no Go', () => {
		show(built());

		expect(offered('Work on this version')).toBe(true);
		expect(offered('Bring it in')).toBe(true);
		expect(offered('Discard')).toBe(true);
		expect(offered('Go')).toBe(false);
		expect(offered('Stop')).toBe(false);
	});

	it('works on the version and brings it in from the card', () => {
		show(built());

		pressed('Work on this version');
		expect(asked.workedOn).toBe(1);

		pressed('Bring it in');
		expect(asked.broughtIn).toBe(1);
	});

	it('asks before discarding, and says what that costs', () => {
		show(built());

		pressed('Discard');
		expect(asked.discarded).toBe(0);
		expect(screen()).toContain('Your own notes and your folder are untouched.');

		pressed('Discard it');
		expect(asked.discarded).toBe(1);
	});

	it('offers nothing to work on where the line’s version is not in hand', () => {
		show(built(), { onWorkOn: undefined, onNotes: undefined });

		expect(offered('Work on this version')).toBe(false);
		expect(offered('See them against your own')).toBe(false);
		expect(offered('Bring it in')).toBe(true);
	});

	it('says why the last act did not land, in the words it was refused in', () => {
		show(built(), { says: 'Settle the notes that are in two versions first.' });

		expect(screen()).toContain('Settle the notes that are in two versions first.');
	});
});

describe('a build that stopped, and one nobody could settle', () => {
	it('keeps what landed and offers Continue', () => {
		show(
			build({
				state: 'stopped',
				plan: { tasks: [PLAN_TASK], needs: [], disputes: [], checks: [] },
				tasks: { reader: run({ state: 'built', handoffs: [HANDOFF] }) }
			})
		);

		expect(screen()).toContain('Stopped. What landed is still here.');
		expect(offered('Continue')).toBe(true);
		expect(offered('Stop')).toBe(false);
		expect(screen()).toContain('The reader reads the note first and asks where none says.');

		pressed('Continue');
		expect(asked.carriedOn).toBe(1);
	});

	it('says a contested task is the reader’s decision, and shows what was found', () => {
		show(
			build({
				state: 'contested',
				plan: { tasks: [PLAN_TASK], needs: [], disputes: [], checks: [] },
				tasks: {
					reader: run({
						state: 'contested',
						handoffs: [HANDOFF],
						review: { clean: false, findings: [FINDING] },
						rounds: 2
					})
				}
			})
		);

		expect(screen()).toContain('A task nobody could settle. The decision is yours.');
		expect(
			document.body.querySelector('[data-build-task="reader"] [data-task-state="contested"]')
				?.textContent
		).toContain('Nobody could settle this');
		expect(document.body.querySelector('[data-build-finding="blocking"]')).not.toBeNull();
		expect(offered('Bring it in')).toBe(true);
	});
});
