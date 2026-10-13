// A build end to end, driven the way the assistants drive one: a folder in
// memory, the lines and copies over it, and a stub agent that answers with the
// four acts. docs/ARCHITECTURE.md § "Building from the notes".

import 'fake-indexeddb/auto';
import {
	DeviceBuilds,
	DeviceThreads,
	LocalApi,
	MemoryBuilds,
	MemoryFiles,
	MemoryHistory
} from '@sloppy/local';
import {
	BUILD_ROUNDS_MOST,
	BUILD_TASKS_AT_ONCE,
	buildLine,
	type BlockDocument,
	type BuildHandoff,
	type BuildPlan,
	type BuildRole,
	type BuildTask,
	type ChatAgent,
	type ChatEvent,
	type ChatToolAnswer,
	type ContextUsage,
	type OwnedRef,
	type SloppyToolCall,
	type Ulid
} from '@sloppy/types';
import { Refusal } from '@sloppy/ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, resetApi } from '../api.js';
import { initRuntime, type ChatAccess, type ChatAsked, type ChatLive } from '../runtime.js';
import { seamSettledAgain } from '../seam.svelte.js';
import { builds, fillingUp } from './build.svelte.js';
import { chat } from './chat.svelte.js';
import { graphHistory } from './history.svelte.js';
import { nodes } from './nodes.svelte.js';
import { prefs } from './prefs.svelte.js';

const ROOT = '/work/compiler';

/** Which folder each of the CHAT's acts was served against, newest last. */
const served = vi.hoisted(() => ({ roots: [] as string[] }));

vi.mock('../chat-acts.js', () => ({
	serveChatCall: (files: { root: string }) => {
		served.roots.push(files.root);
		return Promise.resolve({ said: '{}', touched: [] });
	}
}));

let store: Map<string, Uint8Array>;
let kept: MemoryHistory;
let stub: Stub;
let graph: OwnedRef;
let feature: OwnedRef;
let beside: OwnedRef;

function folder(): MemoryFiles {
	return new MemoryFiles({ root: ROOT, store, data: '/data' });
}

function words(said: string): BlockDocument {
	return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: said }] }] };
}

interface Carried {
	hear: (event: ChatEvent) => void;
	serve: (call: SloppyToolCall) => Promise<ChatToolAnswer>;
}

/** The agent, as the shell carries one: a conversation per `ChatAsked`, keyed
 *  the way the shell keys one, so a build's several stand at once. */
class Stub implements ChatAccess {
	asked: ChatAsked[] = [];
	said: { of: string; said: string }[] = [];
	closed: string[] = [];
	readonly standing = new Map<string, Carried>();
	readonly builds = new MemoryBuilds(folder());
	/** What this device says it can run. A test makes it a device with nothing
	 *  it can start, or one that does not answer at all. */
	has: ChatAgent[] = ['claude_code'];
	untold = false;
	/** Words this device rejects the next session with, as a shell with nothing
	 *  to run it does. */
	refuse: string | null = null;

	agents(): Promise<ChatAgent[]> {
		if (this.untold) return Promise.reject(new Error('nothing answered'));
		return Promise.resolve([...this.has]);
	}

	open(
		asked: ChatAsked,
		hear: (event: ChatEvent) => void,
		serve: (call: SloppyToolCall) => Promise<ChatToolAnswer>
	): Promise<ChatLive> {
		if (this.refuse !== null) return Promise.reject(new Refusal(this.refuse));
		this.asked.push(asked);
		const of = asked.conversation ?? asked.thread.id;
		this.standing.set(of, { hear, serve });
		return Promise.resolve({
			say: (said: string) => {
				this.said.push({ of, said });
				return Promise.resolve();
			},
			stop: () => Promise.resolve(),
			close: () => {
				this.closed.push(of);
				this.standing.delete(of);
				return Promise.resolve();
			},
			context: () => Promise.resolve()
		});
	}

	tell(of: string, event: ChatEvent): void {
		this.standing.get(of)?.hear(event);
	}

	answer(of: string, call: SloppyToolCall): Promise<ChatToolAnswer> {
		const held = this.standing.get(of);
		if (!held) throw new Error(`nothing is serving ${of}`);
		return held.serve(call);
	}
}

/** The conversation most recently opened for that role, and for that task
 *  where one is named — a task's copy is what its sessions are opened in. */
function of(role: BuildRole, task?: string): string {
	const held = [...stub.asked]
		.reverse()
		.find(
			(one) => one.role === role && (task === undefined || one.cwd?.endsWith(`/${task}`) === true)
		);
	if (!held?.conversation)
		throw new Error(`no ${role} session${task === undefined ? '' : ` for ${task}`}`);
	return held.conversation;
}

/** One act answered and the turn it was answered in ended, which is where the
 *  build acts on it. */
async function act(session: string, call: SloppyToolCall): Promise<ChatToolAnswer> {
	const answer = await stub.answer(session, call);
	stub.tell(session, { event: 'ended' });
	await settled();
	return answer;
}

async function settled(): Promise<void> {
	for (let turn = 0; turn < 40; turn += 1) await new Promise((wake) => setTimeout(wake));
}

function shell(): void {
	initRuntime({
		apiHost: () => '',
		mode: () => 'local',
		createApi: () => new LocalApi(folder()),
		vault: {
			folder: () => ROOT,
			graph: () => new LocalApi(folder()).graphHere(),
			asks: true,
			open: async () => ROOT
		},
		history: () => kept,
		project: async () => folder(),
		chat: stub,
		threads: new DeviceThreads(folder()),
		builds: new DeviceBuilds(folder())
	});
	resetApi();
	seamSettledAgain();
}

function task(id: string, over: Partial<BuildTask> = {}): BuildTask {
	return {
		id,
		title: `The ${id} half`,
		effect: `It ${id}s.`,
		paths: [`src/${id}.ts`],
		notes: [feature],
		...over
	};
}

function plan(over: Partial<BuildPlan> = {}): BuildPlan {
	return { tasks: [task('reader')], needs: [], disputes: [], checks: ['pnpm check'], ...over };
}

function handoff(over: Partial<BuildHandoff> = {}): BuildHandoff {
	return {
		summary: 'The reading half reads.',
		files: ['src/reader.ts'],
		checks: [{ command: 'pnpm check', passed: true, said: '' }],
		notes: [],
		undone: '',
		finished: true,
		...over
	};
}

function call(act: string, args: unknown): SloppyToolCall {
	return { call: `c${Math.random()}`, act, arguments: args } as SloppyToolCall;
}

/** A build with its plan in, ready for Go. */
async function planned(held: BuildPlan = plan()): Promise<void> {
	await builds.start([feature], 'reads-a-plan');
	await settled();
	await act(of('planner'), call('plan_build', held));
}

/** And one running, with Go pressed. */
async function going(held: BuildPlan = plan()): Promise<void> {
	await planned(held);
	await builds.go();
	await settled();
}

beforeEach(async () => {
	localStorage.clear();
	prefs.init();
	store = new Map();
	served.roots.length = 0;
	kept = new MemoryHistory(folder(), { author: 'Ada' });
	stub = new Stub();
	chat.clear();
	builds.clear();
	graphHistory.clear();
	nodes.clear();
	shell();
	graph = await new LocalApi(folder()).graphHere();
	feature = (await api.createNode({ title: 'The reading half' })).ref;
	await api.createBlock({ node: feature, content: words('It reads a plan off the notes.') });
	beside = (await api.createNode({ from: { relation: 'under', note: feature }, title: 'Beside' }))
		.ref;
	await kept.commit('The notes as they are');
	await chat.opened(graph);
	await chat.lookForAgents();
	await builds.opened(graph);
});

afterEach(() => {
	builds.clear();
	chat.clear();
	graphHistory.clear();
	nodes.clear();
	initRuntime({
		apiHost: () => '',
		mode: () => 'hosted',
		createApi: undefined,
		vault: undefined,
		history: undefined,
		project: undefined,
		chat: undefined,
		threads: undefined,
		builds: undefined
	});
	resetApi();
	seamSettledAgain();
	localStorage.clear();
});

describe('a build read, answered and run', () => {
	it('reads the notes, puts a plan in front of the person, and runs the work on Go', async () => {
		expect(builds.offered).toBe(true);

		await builds.start([feature], 'reads-a-plan');
		await settled();

		const reading = builds.current;
		expect(reading?.state).toBe('reading');
		expect(reading?.line).toBe(buildLine('reads-a-plan'));
		expect(builds.offered).toBe(false);
		// The reading session reads the project itself: the build's own copy does
		// not exist until Go.
		expect(stub.asked[0].role).toBe('planner');
		expect(stub.asked[0].cwd).toBe(ROOT);
		expect(stub.asked[0].brief).toContain('It reads a plan off the notes.');
		expect(stub.said[0].said).toContain('`plan_build`');

		await act(of('planner'), call('plan_build', plan({ needs: [], disputes: [] })));

		expect(builds.current?.state).toBe('answering');
		expect(builds.current?.plan?.tasks[0].id).toBe('reader');
		expect(builds.current?.tasks.reader.state).toBe('waiting');
		// Nothing of the person's has moved yet.
		expect((await kept.log(10)).commits).toHaveLength(1);

		// Something written since the last version, so Go has one to keep.
		await api.createNode({ title: 'Written since' });
		await builds.go();
		await settled();

		expect(builds.current?.state).toBe('building');
		expect(builds.current?.tasks.reader.state).toBe('building');
		expect((await kept.log(10)).commits).toHaveLength(2);
		expect(builds.current?.from).toBe(await kept.currentCommit());
		const building = stub.asked.find((one) => one.role === 'implementer');
		expect(building?.cwd).toBe(`${ROOT}/builds/${builds.current?.id}/reader`);
		expect(building?.brief).toContain('It reads a plan off the notes.');
	});

	it('reads what was built, merges it, runs the line’s checks and is built', async () => {
		await going();

		await act(of('implementer', 'reader'), call('hand_off', handoff()));

		expect(builds.current?.tasks.reader.state).toBe('reviewing');
		expect(builds.current?.state).toBe('reviewing');
		expect(stub.said.some((one) => one.said.includes('The reading half reads.'))).toBe(true);

		await act(of('reviewer', 'reader'), call('review_build', { clean: true, findings: [] }));

		expect(builds.current?.tasks.reader.state).toBe('merged');
		expect(builds.current?.merges).toEqual([{ task: 'reader', settled: true, conflicts: [] }]);
		expect(builds.current?.state).toBe('merging');

		const merger = of('merger');
		expect(stub.said.find((one) => one.of === merger)?.said).toContain('Run the checks');

		await act(
			merger,
			call('hand_off', handoff({ checks: [{ command: 'pnpm check', passed: true, said: 'ok' }] }))
		);

		expect(builds.current?.state).toBe('built');
		expect(builds.current?.checked).toEqual([{ command: 'pnpm check', passed: true, said: 'ok' }]);
	});

	it('is a thread of its own kind, whose turns say which session said them', async () => {
		await builds.start([feature], 'reads-a-plan');
		await settled();
		const id = builds.current?.id as Ulid;

		const thread = chat.threads.find((one) => one.id === id);
		expect(thread?.kind).toBe('build');
		expect(thread?.build).toBe(id);

		const planner = of('planner');
		stub.tell(planner, { event: 'block', at: 0, block: { kind: 'said', said: 'Reading.' } });
		stub.tell(planner, { event: 'ended' });
		await settled();

		const kept = await new DeviceThreads(folder()).read(id);
		expect(kept?.turns.every((turn) => turn.conversation === planner)).toBe(true);
		expect(kept?.turns.some((turn) => turn.from === 'agent')).toBe(true);
		// A build thread is never picked up: each session is a fresh one.
		expect(kept?.session).toBeUndefined();
	});

	it('serves a session’s note acts against the copy it works in', async () => {
		await going();

		await stub.answer(
			of('implementer', 'reader'),
			call('write_note', { about: 'src/reader.ts', sections: ['## Why\n\nBecause.'] })
		);

		expect(served.roots).toEqual([`${ROOT}/builds/${builds.current?.id}/reader`]);
	});

	it('refuses an act the session was never served', async () => {
		await going();

		const answer = await stub.answer(
			of('implementer', 'reader'),
			call('review_build', { clean: true, findings: [] })
		);

		expect(answer.trouble).toBe(true);
	});
});

describe('how many run at once', () => {
	it('builds no more tasks than the bound, and starts the next as one is read', async () => {
		const three = plan({ tasks: [task('one'), task('two'), task('three')] });
		await going(three);

		expect(stub.asked.filter((one) => one.role === 'implementer')).toHaveLength(
			BUILD_TASKS_AT_ONCE
		);
		expect(builds.current?.tasks.three.state).toBe('waiting');

		await act(of('implementer', 'one'), call('hand_off', handoff()));
		await act(of('reviewer', 'one'), call('review_build', { clean: true, findings: [] }));

		expect(builds.current?.tasks.three.state).toBe('building');
	});

	it('holds a task until the ones it waits for are in', async () => {
		await going(plan({ tasks: [task('one'), task('two', { after: ['one'] })] }));

		expect(builds.current?.tasks.two.state).toBe('waiting');
		expect(stub.asked.filter((one) => one.role === 'implementer')).toHaveLength(1);

		await act(of('implementer', 'one'), call('hand_off', handoff()));
		await act(of('reviewer', 'one'), call('review_build', { clean: true, findings: [] }));

		expect(builds.current?.tasks.two.state).toBe('building');
	});
});

describe('a session whose window fills', () => {
	const FULL: ContextUsage = {
		total: 76,
		limit: 100,
		compactsAt: 80,
		at: '2026-10-13T10:00:00.000Z',
		parts: []
	};

	it('says where a session is let fill to', () => {
		expect(fillingUp(FULL)).toBe(true);
		expect(fillingUp({ ...FULL, total: 60 })).toBe(false);
		// An agent that says nothing about making room is measured against its
		// window.
		expect(fillingUp({ ...FULL, total: 95, compactsAt: undefined })).toBe(true);
	});

	it('is asked to hand off once, and a fresh one goes on from what it handed on', async () => {
		await going();
		const first = of('implementer', 'reader');

		stub.tell(first, { event: 'context', usage: FULL });
		stub.tell(first, { event: 'context', usage: { ...FULL, total: 78 } });
		await settled();

		const asks = stub.said.filter(
			(one) => one.of === first && one.said.startsWith('Stop where you are')
		);
		expect(asks).toHaveLength(1);
		expect(builds.sessions.find((one) => one.conversation === first)?.context?.total).toBe(78);

		await act(
			first,
			call(
				'hand_off',
				handoff({ finished: false, undone: 'The second pass.', summary: 'Half of it.' })
			)
		);

		const next = of('implementer', 'reader');
		expect(next).not.toBe(first);
		expect(stub.closed).toContain(first);
		expect(builds.current?.tasks.reader.state).toBe('building');
		expect(builds.current?.tasks.reader.handoffs).toHaveLength(1);
		const told = stub.said.find((one) => one.of === next)?.said ?? '';
		expect(told).toContain('Half of it.');
		expect(told).toContain('The second pass.');
	});
});

describe('a question raised while the work runs', () => {
	it('holds the task, is answered by a note, and the task goes on', async () => {
		await going();
		const first = of('implementer', 'reader');

		await act(
			first,
			call('raise_need', {
				id: 'units',
				question: 'In what unit is the budget counted?',
				why: 'The sum is wrong otherwise.'
			})
		);

		expect(builds.current?.tasks.reader.state).toBe('asking');
		expect(builds.asking).toEqual(['reader']);
		expect(
			stub.said.some((one) => one.of === first && one.said.startsWith('Stop where you are'))
		).toBe(true);

		await act(
			first,
			call('hand_off', handoff({ finished: false, summary: 'Waiting on the unit.' }))
		);

		expect(builds.current?.tasks.reader.state).toBe('asking');
		// Nothing starts for a task holding a question.
		expect(of('implementer', 'reader')).toBe(first);

		await builds.answer('units', 'Tokens, as the agent counts them.');
		await settled();

		const written = await api.listNodes({ origin: feature });
		const answer = written.find((one) => one.title.startsWith('In what unit'));
		expect(answer?.parent).toBe(feature);
		expect(builds.needs.find((one) => one.need.id === 'units')?.note).toBe(answer?.ref);
		expect(builds.current?.tasks.reader.state).toBe('building');
		const next = of('implementer', 'reader');
		expect(next).not.toBe(first);
		const told = stub.said.find((one) => one.of === next)?.said ?? '';
		expect(told).toContain('In what unit');
		expect(told).toContain(answer?.ref as string);
	});

	it('is set aside as plainly as it is answered', async () => {
		await going();
		const first = of('implementer', 'reader');
		await act(
			first,
			call('raise_need', { id: 'units', question: 'What unit?', why: 'Wrong sum.' })
		);
		await act(first, call('hand_off', handoff({ finished: false })));

		await builds.drop('units');
		await settled();

		expect(builds.needs.find((one) => one.need.id === 'units')?.dropped).toBe(true);
		expect(builds.current?.tasks.reader.state).toBe('building');
		expect(stub.said.find((one) => one.of === of('implementer', 'reader'))?.said).toContain(
			'set aside'
		);
	});

	it('leaves the task behind it waiting, and builds it once the question is answered', async () => {
		await going(plan({ tasks: [task('one'), task('two', { after: ['one'] })] }));
		const first = of('implementer', 'one');

		await act(
			first,
			call('raise_need', { id: 'units', question: 'What unit?', why: 'Wrong sum.' })
		);
		await act(first, call('hand_off', handoff({ finished: false, summary: 'Waiting on it.' })));

		expect(builds.sessions).toEqual([]);
		expect(builds.current?.tasks.one.state).toBe('asking');
		expect(builds.current?.tasks.two.state).toBe('waiting');

		await builds.answer('units', 'Tokens, as the agent counts them.');
		await settled();
		await act(of('implementer', 'one'), call('hand_off', handoff()));
		await act(of('reviewer', 'one'), call('review_build', { clean: true, findings: [] }));

		expect(builds.current?.tasks.two.state).toBe('building');
	});

	it('keeps a second question under another id, so one answer reaches one question', async () => {
		await going();
		const first = of('implementer', 'reader');

		await act(
			first,
			call('raise_need', { id: 'units', question: 'What unit?', why: 'Wrong sum.' })
		);
		await act(first, call('raise_need', { id: 'units', question: 'Which clock?', why: 'Drifts.' }));

		const ids = builds.needs.map((one) => one.need.id);
		expect(new Set(ids).size).toBe(2);
		expect(ids).toContain('units');
		expect(ids).toContain('units-2');
	});
});

describe('a task a review will not pass', () => {
	it('goes round until the cap, then is contested and the person decides', async () => {
		await going();

		for (let round = 0; round <= BUILD_ROUNDS_MOST; round += 1) {
			await act(of('implementer', 'reader'), call('hand_off', handoff()));
			await act(
				of('reviewer', 'reader'),
				call('review_build', {
					clean: false,
					findings: [
						{ file: 'src/reader.ts', severity: 'blocking', what: 'It throws.', why: 'It stops.' }
					]
				})
			);
			if (round < BUILD_ROUNDS_MOST) {
				expect(builds.current?.tasks.reader.state).toBe('building');
				expect(builds.current?.tasks.reader.rounds).toBe(round + 1);
				expect(stub.said.find((one) => one.of === of('implementer', 'reader'))?.said).toContain(
					'It throws.'
				);
			}
		}

		expect(builds.current?.tasks.reader.state).toBe('contested');
		expect(builds.current?.state).toBe('contested');
		expect(builds.current?.merges).toEqual([]);
	});

	it('brings the tasks that passed into the line, so there is a rest to bring in', async () => {
		await going(plan({ tasks: [task('one'), task('two')] }));

		for (let round = 0; round <= BUILD_ROUNDS_MOST; round += 1) {
			await act(of('implementer', 'one'), call('hand_off', handoff({ files: ['src/one.ts'] })));
			await act(
				of('reviewer', 'one'),
				call('review_build', {
					clean: false,
					findings: [{ file: 'src/one.ts', severity: 'blocking', what: 'No.', why: 'Stops.' }]
				})
			);
		}
		expect(builds.current?.tasks.one.state).toBe('contested');

		await act(of('implementer', 'two'), call('hand_off', handoff({ files: ['src/two.ts'] })));
		await act(of('reviewer', 'two'), call('review_build', { clean: true, findings: [] }));

		expect(builds.current?.tasks.two.state).toBe('merged');
		expect(builds.current?.merges).toEqual([{ task: 'two', settled: true, conflicts: [] }]);
		expect(builds.current?.state).toBe('merging');

		await act(of('merger'), call('hand_off', handoff()));

		// What passed is on the line and checked, and the contested task is still
		// what the build is standing on.
		expect(builds.current?.checked).toEqual([{ command: 'pnpm check', passed: true, said: '' }]);
		expect(builds.current?.state).toBe('contested');
	});

	it('contests a task waiting on a contested one rather than leaving it waiting', async () => {
		await going(plan({ tasks: [task('one'), task('two', { after: ['one'] })] }));

		for (let round = 0; round <= BUILD_ROUNDS_MOST; round += 1) {
			await act(of('implementer', 'one'), call('hand_off', handoff()));
			await act(
				of('reviewer', 'one'),
				call('review_build', {
					clean: false,
					findings: [{ file: 'src/one.ts', severity: 'blocking', what: 'No.', why: 'Stops.' }]
				})
			);
		}

		expect(builds.current?.tasks.two.state).toBe('contested');
		expect(builds.current?.state).toBe('contested');
	});

	it('contests tasks waiting on each other, which is a plan nobody can carry out', async () => {
		await going(
			plan({ tasks: [task('one', { after: ['two'] }), task('two', { after: ['one'] })] })
		);

		expect(builds.current?.tasks.one.state).toBe('contested');
		expect(builds.current?.tasks.two.state).toBe('contested');
		expect(builds.current?.state).toBe('contested');
	});

	it('contests the whole chain behind a task nobody could settle', async () => {
		await going(
			plan({
				tasks: [task('three', { after: ['two'] }), task('two', { after: ['one'] }), task('one')]
			})
		);

		for (let round = 0; round <= BUILD_ROUNDS_MOST; round += 1) {
			await act(of('implementer', 'one'), call('hand_off', handoff()));
			await act(
				of('reviewer', 'one'),
				call('review_build', {
					clean: false,
					findings: [{ file: 'src/one.ts', severity: 'blocking', what: 'No.', why: 'Stops.' }]
				})
			);
		}

		expect(builds.current?.tasks.two.state).toBe('contested');
		expect(builds.current?.tasks.three.state).toBe('contested');
	});
});

describe('two tasks that wrote the same file', () => {
	it('has a session settle it with both paragraphs in hand, and keeps what it took', async () => {
		await going();
		const id = builds.current?.id as Ulid;
		stub.builds.conflictOn(id, 'reader', ['src/reader.ts']);

		await act(of('implementer', 'reader'), call('hand_off', handoff()));
		await act(of('reviewer', 'reader'), call('review_build', { clean: true, findings: [] }));

		expect(builds.current?.merges).toEqual([
			{ task: 'reader', settled: false, conflicts: ['src/reader.ts'] }
		]);
		const merger = of('merger');
		expect(stub.asked.find((one) => one.conversation === merger)?.cwd).toBe(
			`${ROOT}/builds/${id}/line`
		);
		const told = stub.said.find((one) => one.of === merger)?.said ?? '';
		expect(told).toContain('src/reader.ts');
		expect(stub.asked.find((one) => one.conversation === merger)?.brief).toContain('It readers.');

		await act(merger, call('hand_off', handoff()));

		expect(builds.current?.merges).toEqual([
			{ task: 'reader', settled: true, conflicts: ['src/reader.ts'] }
		]);
		expect(builds.current?.tasks.reader.state).toBe('merged');
	});
});

describe('a build after the app has been closed', () => {
	it('is read back and picks each unfinished task up from its last hand-off', async () => {
		await going();
		await act(
			of('implementer', 'reader'),
			call('hand_off', handoff({ finished: false, summary: 'Half of it.' }))
		);
		const id = builds.current?.id as Ulid;
		const was = builds.current;

		// The app closes: nothing of the run is left, and the sessions are gone.
		builds.clear();
		stub.standing.clear();
		stub.asked.length = 0;
		stub.said.length = 0;
		await builds.opened(graph);
		await settled();

		// Everything but the row for the session that picked it up again, which
		// is a session this run opened.
		expect({ ...builds.current, sessions: [] }).toEqual({ ...was, sessions: [] });
		expect(builds.current?.sessions).toHaveLength((was?.sessions.length ?? 0) + 1);
		expect(builds.current?.id).toBe(id);
		expect(builds.current?.state).toBe('building');
		const next = stub.asked.find((one) => one.role === 'implementer');
		expect(next?.cwd).toBe(`${ROOT}/builds/${id}/reader`);
		expect(stub.said.find((one) => one.of === next?.conversation)?.said).toContain('Half of it.');
	});

	it('leaves a build nobody has answered yet standing, with nothing running', async () => {
		await planned();
		const was = builds.current;

		builds.clear();
		stub.standing.clear();
		stub.asked.length = 0;
		await builds.opened(graph);
		await settled();

		expect(builds.current).toEqual(was);
		expect(builds.current?.state).toBe('answering');
		expect(stub.asked).toEqual([]);
	});
});

describe('stopping and going on', () => {
	it('keeps what landed, lets the sessions go, and takes it up again', async () => {
		await going();
		const first = of('implementer', 'reader');

		await builds.stop();
		await settled();

		expect(builds.current?.state).toBe('stopped');
		expect(stub.closed).toContain(first);
		expect(builds.sessions).toEqual([]);

		await builds.goOn();
		await settled();

		expect(builds.current?.state).toBe('building');
		expect(of('implementer', 'reader')).not.toBe(first);
	});

	it('lets the line’s copy go when it stops, and takes it back on Continue', async () => {
		await going();
		const id = builds.current?.id as Ulid;

		await builds.stop();
		await settled();

		expect(stub.builds.gaveUpTheLine(id)).toBe(true);

		await builds.goOn();
		await settled();
		await act(of('implementer', 'reader'), call('hand_off', handoff()));
		await act(of('reviewer', 'reader'), call('review_build', { clean: true, findings: [] }));
		await settled();

		expect(stub.builds.gaveUpTheLine(id)).toBe(false);
	});

	it('stops a build whose reading session died, and reads again on Continue', async () => {
		await builds.start([feature], 'reads-a-plan');
		await settled();
		const first = of('planner');

		stub.tell(first, { event: 'over', said: 'The assistant is not signed in.' });
		await settled();

		expect(builds.current?.state).toBe('stopped');
		expect(builds.says).toBe('The assistant is not signed in.');

		await builds.goOn();
		await settled();

		expect(builds.current?.state).toBe('reading');
		expect(of('planner')).not.toBe(first);
	});

	it('stops the build where a task’s copy will not open, and says what happened', async () => {
		await going();
		const first = of('implementer', 'reader');
		await stub.builds.discard(builds.current?.id as Ulid);

		await act(first, call('hand_off', handoff({ finished: false })));

		expect(builds.current?.state).toBe('stopped');
		expect(builds.says).toContain('not here any more');
		expect(builds.sessions).toEqual([]);
	});

	it('stops the build where a task would not come into the line, and brings it in on Continue', async () => {
		await going();
		await act(of('implementer', 'reader'), call('hand_off', handoff()));
		const id = builds.current?.id as Ulid;
		await stub.builds.finishTask(id, 'reader');

		await act(of('reviewer', 'reader'), call('review_build', { clean: true, findings: [] }));

		expect(builds.current?.state).toBe('stopped');
		expect(builds.says).toContain('not here any more');
		expect(builds.sessions).toEqual([]);
		expect(builds.current?.merges).toEqual([]);

		await stub.builds.taskCheckout(id, 'reader');
		await builds.goOn();
		await settled();

		expect(builds.current?.tasks.reader.state).toBe('merged');
		expect(builds.current?.merges).toEqual([{ task: 'reader', settled: true, conflicts: [] }]);
		expect(builds.current?.state).toBe('merging');
	});

	it('stops the build where a session could not go on, and says why', async () => {
		await going();

		stub.tell(of('implementer', 'reader'), {
			event: 'over',
			said: 'The assistant is not signed in.'
		});
		await settled();

		expect(builds.current?.state).toBe('stopped');
		expect(builds.says).toBe('The assistant is not signed in.');
	});
});

describe('a question the plan asks', () => {
	it('is answered by a note under the note it is about, before Go', async () => {
		await planned(
			plan({
				needs: [
					{
						id: 'units',
						about: beside,
						question: 'In what unit is the budget counted?',
						why: 'The sum is wrong otherwise.'
					}
				]
			})
		);

		expect(builds.needs).toHaveLength(1);
		expect(builds.current?.state).toBe('answering');

		await builds.answer('units', 'Tokens, as the agent counts them.');

		const written = (await api.listNodes({ origin: feature })).find((one) =>
			one.title.startsWith('In what unit')
		);
		expect(written?.parent).toBe(beside);
		expect(builds.needs[0].note).toBe(written?.ref);
		// Answering starts nothing: Go is still the person's.
		expect(builds.current?.state).toBe('answering');
		expect(stub.asked.filter((one) => one.role === 'implementer')).toEqual([]);
	});

	it('is handed to every task it bears on, and named in the turn that starts one', async () => {
		await planned(
			plan({
				tasks: [task('reader', { notes: [beside] }), task('writer')],
				needs: [
					{
						id: 'units',
						about: beside,
						question: 'In what unit is the budget counted?',
						why: 'The sum is wrong otherwise.'
					},
					{ id: 'ceiling', question: 'What is the ceiling?', why: 'Nothing says.' }
				]
			})
		);

		await builds.answer('units', 'Tokens, as the agent counts them.');
		await builds.answer('ceiling', 'Eight thousand of them.');
		await settled();

		const under = await api.listNodes({ origin: feature });
		const unit = under.find((one) => one.title.startsWith('In what unit'))?.ref as OwnedRef;
		const ceiling = under.find((one) => one.title.startsWith('What is the ceiling'))
			?.ref as OwnedRef;
		// A question about one note goes to the tasks built from it; one about the
		// feature as a whole goes to all of them.
		expect(builds.current?.plan?.tasks[0].notes).toEqual([beside, unit, ceiling]);
		expect(builds.current?.plan?.tasks[1].notes).toEqual([feature, ceiling]);

		await builds.go();
		await settled();

		const brief =
			stub.asked.find((one) => one.role === 'implementer' && one.cwd?.endsWith('/reader'))?.brief ??
			'';
		expect(brief).toContain('Tokens, as the agent counts them.');
		expect(brief).toContain('Eight thousand of them.');
		const told = stub.said.find((one) => one.of === of('implementer', 'reader'))?.said ?? '';
		expect(told).toContain('In what unit');
		expect(told).toContain(unit);
	});

	it('is set aside where the person drops it, and the tasks are told so', async () => {
		await planned(plan({ needs: [{ id: 'units', question: 'What unit?', why: 'Wrong sum.' }] }));

		await builds.drop('units');
		await builds.go();
		await settled();

		expect(builds.current?.plan?.tasks[0].notes).toEqual([feature]);
		expect(stub.said.find((one) => one.of === of('implementer', 'reader'))?.said).toContain(
			'set aside'
		);
	});

	it('is not answered with nothing, and not answered twice over', async () => {
		await planned(plan({ needs: [{ id: 'units', question: 'What unit?', why: 'Wrong sum.' }] }));

		expect(await builds.answer('units', '   ')).toBe(false);
		expect(builds.says).toBe('Write the answer first.');
		expect(await builds.answer('nothing-asked-this', 'Words.')).toBe(false);
	});
});

describe('what a build is called', () => {
	it('is held to a name a line can have, and refuses one a line already has', async () => {
		await graphHistory.startLine(buildLine('taken'));
		await graphHistory.read();

		expect(await builds.nameTaken('taken')).toBe(true);
		expect(await builds.nameTaken('not-taken')).toBe(false);

		expect(await builds.start([feature], 'Not A Name' as never)).toBe(false);
		expect(builds.says).toContain('letter or a digit');
		expect(builds.current).toBe(null);
	});

	it('refuses a second build on one project', async () => {
		await builds.start([feature], 'reads-a-plan');
		await settled();

		expect(await builds.start([feature], 'reads-it-again')).toBe(false);
		expect(builds.says).toContain('already a build');
	});
});

describe('the notes a task is built from', () => {
	it('are the reader’s to add to and take from before Go, and exactly what is inlined', async () => {
		await planned();

		expect(await builds.addNote('reader', beside)).toBe(true);
		expect(builds.current?.plan?.tasks[0].notes).toEqual([feature, beside]);
		expect(await builds.takeNote('reader', feature)).toBe(true);
		expect(builds.current?.plan?.tasks[0].notes).toEqual([beside]);

		await builds.go();
		await settled();

		const brief = stub.asked.find((one) => one.role === 'implementer')?.brief ?? '';
		expect(brief).toContain(beside);
		expect(brief).not.toContain(feature);
		expect(brief.match(/did:syr:/g)).toHaveLength(1);
	});

	it('are not the reader’s once the work has started, and never none', async () => {
		await going();

		expect(await builds.addNote('reader', beside)).toBe(false);
		expect(await builds.takeNote('reader', feature)).toBe(false);
	});
});

describe('a session that answers in words instead of an act', () => {
	it('asks the reading session for the act it was given, then stops the build', async () => {
		await builds.start([feature], 'reads-a-plan');
		await settled();
		const planner = of('planner');

		stub.tell(planner, { event: 'ended' });
		await settled();

		const asked = stub.said.filter((one) => one.of === planner);
		expect(asked[asked.length - 1].said).toContain('`plan_build`');
		// A planner was never served a hand-off, so it is never asked for one.
		expect(asked.some((one) => one.said.includes('`hand_off`'))).toBe(false);

		stub.tell(planner, { event: 'ended' });
		await settled();

		expect(builds.current?.state).toBe('stopped');
		expect(builds.says).toBe('The assistant stopped without saying what the work is.');
		expect(builds.sessions).toEqual([]);

		await builds.goOn();
		await settled();

		expect(builds.current?.state).toBe('reading');
		expect(of('planner')).not.toBe(planner);
	});

	it('asks a session reading one task for `review_build`', async () => {
		await going();
		await act(of('implementer', 'reader'), call('hand_off', handoff()));
		const reviewer = of('reviewer', 'reader');

		stub.tell(reviewer, { event: 'ended' });
		await settled();

		const asked = stub.said.filter((one) => one.of === reviewer);
		expect(asked[asked.length - 1].said).toContain('`review_build`');
		expect(asked.some((one) => one.said.includes('`hand_off`'))).toBe(false);
	});

	it('contests the task where a session building it answers nothing twice over', async () => {
		await going();
		const first = of('implementer', 'reader');

		stub.tell(first, { event: 'ended' });
		await settled();
		stub.tell(first, { event: 'ended' });
		await settled();

		expect(builds.current?.tasks.reader.state).toBe('contested');
		expect(builds.says).toBe('The assistant stopped without saying what it built.');
	});
});

describe('a device with no assistant to build with', () => {
	it('keeps the act and says it needs one installed here', async () => {
		stub.has = ['anthropic'];
		await chat.lookForAgents();

		// DESIGN.md § "A build": an act that vanishes teaches nobody why.
		expect(builds.offered).toBe(true);
		expect(builds.assistantHere).toBe(false);
		expect(await builds.start([feature], 'reads-a-plan')).toBe(false);
		expect(builds.says).toContain('installed on this device');
		expect(builds.current).toBe(null);
		// Nothing was minted, no session opened, and no version kept.
		expect(stub.asked).toEqual([]);
		expect((await kept.log(10)).commits).toHaveLength(1);
	});

	it('refuses one whose chat is set to an assistant it cannot run', async () => {
		stub.has = ['claude_code', 'anthropic'];
		await chat.lookForAgents();
		chat.pick('anthropic', undefined);

		expect(builds.assistantHere).toBe(false);
		expect(await builds.start([feature], 'reads-a-plan')).toBe(false);
		expect(builds.says).toContain('installed on this device');
		expect(builds.current).toBe(null);
		expect(stub.asked).toEqual([]);

		chat.pick('claude_code', undefined);

		expect(builds.assistantHere).toBe(true);
		expect(builds.assistantSays).toBe(null);
		expect(await builds.start([feature], 'reads-a-plan')).toBe(true);
		await settled();

		expect(stub.asked[0].agent).toBe('claude_code');
	});

	it('is told apart from a device that did not say what it has', async () => {
		stub.untold = true;
		await chat.lookForAgents();

		expect(builds.assistantHere).toBeUndefined();
		expect(await builds.start([feature], 'reads-a-plan')).toBe(false);
		expect(builds.says).not.toContain('installed');
		expect(builds.current).toBe(null);
	});
});

describe('a session that will not start at all', () => {
	it('stops the build with what the device said, and Continue opens it again', async () => {
		stub.refuse = 'The assistant is not signed in.';

		// The build is minted, so the card is there to read — and it is stopped
		// rather than standing in a phase with nothing running.
		expect(await builds.start([feature], 'reads-a-plan')).toBe(true);
		await settled();

		expect(builds.current?.state).toBe('stopped');
		expect(builds.says).toBe('The assistant is not signed in.');
		expect(builds.sessions).toEqual([]);

		stub.refuse = null;
		await builds.goOn();
		await settled();

		expect(builds.current?.state).toBe('reading');
		expect(stub.asked.filter((one) => one.role === 'planner')).toHaveLength(1);
	});

	it('stops one mid-run where a task’s session will not open', async () => {
		await planned();
		stub.refuse = 'The assistant is not signed in.';

		await builds.go();
		await settled();

		expect(builds.current?.state).toBe('stopped');
		expect(builds.says).toBe('The assistant is not signed in.');
		expect(builds.sessions).toEqual([]);

		stub.refuse = null;
		await builds.goOn();
		await settled();

		expect(builds.current?.state).toBe('building');
		expect(of('implementer', 'reader')).toBeTruthy();
	});
});

describe('discarding a build', () => {
	it('takes the line, the copies and the thread, and leaves the folder alone', async () => {
		await going();
		const id = builds.current?.id as Ulid;
		const theirs = (await kept.log(10)).commits.length;

		expect(await builds.discard()).toBe(true);
		await settled();

		expect(builds.current).toBe(null);
		expect(builds.offered).toBe(true);
		expect(await stub.builds.standing(ROOT)).toEqual([]);
		expect(await new DeviceBuilds(folder()).read(id)).toBeUndefined();
		expect(chat.threads.some((one) => one.id === id)).toBe(false);
		expect((await kept.log(10)).commits).toHaveLength(theirs);
		expect((await kept.status()).branch).toBe('main');
	});
});
