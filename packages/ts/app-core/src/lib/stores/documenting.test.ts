// Asking a tool on this device to write a project's notes — docs/ARCHITECTURE.md
// § "Asking a tool to write the notes". Four steps in order, one ask at a time,
// and no tool started here: every run below is a stand-in.

import type {
	DocumentingIntent,
	DocumentingPlan,
	DocumentingProgress,
	DocumentingTool,
	ProposedPlace
} from '@sloppy/types';
import { Refusal } from '@sloppy/ui';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initRuntime, updateRuntime, type DocumentingAccess } from '../runtime.js';
import { seamSettledAgain } from '../seam.svelte.js';
import { documenting } from './documenting.svelte.js';
import { nodes } from './nodes.svelte.js';
import { session } from './session.svelte.js';
import {
	type FakeApi,
	HOME,
	homeOf,
	node,
	ref,
	useFakeApi,
	VIEWER
} from './fake-api.test-support.js';

const ELSEWHERE = homeOf('did:syr:z6MkjSomebodyElsesGraphAAAAAAAAAAAAAAAAAAAAAA');

interface Held {
	surveys: DocumentingIntent[];
	plans: DocumentingPlan[];
	stops: number;
}

class Stub implements DocumentingAccess {
	readonly held: Held = { surveys: [], plans: [], stops: 0 };
	tool: readonly DocumentingTool[] = ['claude_code'];
	/** Set while this device is to reject the ask rather than answer it. */
	untold = false;
	asks = 0;
	/** What the next survey answers with, or what it rejects with — the native
	 *  shell's bare line, or a refusal already carrying words. */
	proposes: ProposedPlace[] | Refusal | string = [];
	/** Every progress the next run reports, the last of which it resolves with. */
	reports: DocumentingProgress[] | Refusal | string = [{ stage: 'done', places: [] }];
	/** Whether the next survey or run hangs until something stops it. */
	holding = false;
	#waiting: (() => void) | null = null;

	tools(): Promise<DocumentingTool[]> {
		this.asks += 1;
		if (this.untold) return Promise.reject(new Error('no bridge'));
		return Promise.resolve([...this.tool]);
	}

	async survey(intent: DocumentingIntent): Promise<ProposedPlace[]> {
		this.held.surveys.push(intent);
		await this.#held();
		if (!Array.isArray(this.proposes)) throw this.proposes;
		return this.proposes;
	}

	async run(
		plan: DocumentingPlan,
		watch: (progress: DocumentingProgress) => void
	): Promise<DocumentingProgress> {
		this.held.plans.push(plan);
		await this.#held();
		if (!Array.isArray(this.reports)) throw this.reports;
		for (const progress of this.reports) watch(progress);
		return this.reports[this.reports.length - 1];
	}

	stop(): Promise<void> {
		this.held.stops += 1;
		this.#waiting?.();
		this.#waiting = null;
		return Promise.resolve();
	}

	hold(): void {
		this.holding = true;
	}

	#held(): Promise<void> {
		if (!this.holding) return Promise.resolve();
		this.holding = false;
		return new Promise((wake) => {
			this.#waiting = wake;
		});
	}
}

let stub: Stub;

function settle(): Promise<void> {
	return new Promise((wake) => setTimeout(wake));
}

beforeEach(() => {
	documenting.clear();
	stub = new Stub();
	initRuntime({ apiHost: () => 'http://api.test', documenting: stub });
	seamSettledAgain();
});

afterEach(() => {
	documenting.clear();
	initRuntime({ apiHost: () => '', documenting: undefined });
	seamSettledAgain();
});

describe('what this device can be asked', () => {
	it('says a tool is reachable only where the shell can reach one', () => {
		expect(documenting.reaches).toBe(true);
		updateRuntime({ documenting: undefined });
		seamSettledAgain();
		expect(documenting.reaches).toBe(false);
	});

	it('asks nothing of the device until somebody opens it', async () => {
		expect(documenting.tools).toBeNull();
		await documenting.opened(HOME);
		expect(documenting.tools).toEqual(['claude_code']);
	});

	it('answers with no tools on a device that has none', async () => {
		stub.tool = [];
		await documenting.opened(HOME);
		expect(documenting.tools).toEqual([]);
	});

	it('says an ask that went nowhere is not a device with nothing on it', async () => {
		stub.untold = true;
		await documenting.opened(HOME);
		expect(documenting.tools).toBe('untold');

		stub.untold = false;
		await documenting.lookForTools();
		expect(documenting.tools).toEqual(['claude_code']);
	});

	it('asks again where the last ask could not answer, and not where it did', async () => {
		stub.untold = true;
		await documenting.opened(HOME);
		stub.untold = false;
		await documenting.opened(HOME);
		expect(stub.asks).toBe(2);

		await documenting.opened(HOME);
		expect(stub.asks).toBe(2);
	});
});

describe('the four steps, in order', () => {
	beforeEach(async () => {
		await documenting.opened(HOME);
	});

	it('opens on the words and goes nowhere on its own', () => {
		expect(documenting.step).toBe('intent');
		expect(stub.held.surveys).toHaveLength(0);
		expect(stub.held.plans).toHaveLength(0);
	});

	it('carries what was said into the survey and into the plan', async () => {
		stub.proposes = [{ path: 'src/parser.ts', reason: 'The whole of the reading' }];
		documenting.say('  What a newcomer needs first  ');
		await documenting.survey();

		expect(stub.held.surveys).toEqual([{ said: 'What a newcomer needs first' }]);
		expect(documenting.step).toBe('refining');

		await documenting.run();
		expect(stub.held.plans[0].intent).toEqual({ said: 'What a newcomer needs first' });
		expect(stub.held.plans[0].places).toEqual([
			{ path: 'src/parser.ts', reason: 'The whole of the reading' }
		]);
	});

	it('writes no notes until the list has been settled', async () => {
		stub.proposes = [{ path: 'src/parser.ts' }];
		await documenting.survey();
		expect(stub.held.plans).toHaveLength(0);
	});

	it('leaves somebody at their words where the survey could not go on', async () => {
		stub.proposes = 'Sloppy could not read this project. Open it again.';
		await documenting.survey();

		expect(documenting.step).toBe('intent');
		expect(documenting.trouble).toBe('Sloppy could not read this project. Open it again.');
		expect(documenting.places).toEqual([]);
	});

	it('takes a survey that found nothing to the list all the same', async () => {
		stub.proposes = [];
		await documenting.survey();

		expect(documenting.step).toBe('refining');
		expect(documenting.trouble).toBeNull();
	});

	it('takes a survey somebody stopped back to their words, saying nothing', async () => {
		stub.proposes = [{ path: 'src/parser.ts' }];
		stub.hold();
		const asking = documenting.survey();
		await settle();
		await documenting.stop();
		await asking;

		expect(stub.held.stops).toBe(1);
		expect(documenting.step).toBe('intent');
		expect(documenting.places).toEqual([]);
		expect(documenting.trouble).toBeNull();
	});
});

describe('settling the list', () => {
	beforeEach(async () => {
		await documenting.opened(HOME);
		stub.proposes = [
			{ path: 'src/parser.ts', reason: 'The reading' },
			{ path: 'docs', reason: 'What is written down' },
			{ path: 'src/graph.ts', note: ref(7) }
		];
		await documenting.survey();
	});

	it('takes a place out', () => {
		documenting.drop('docs');
		expect(documenting.places.map((place) => place.path)).toEqual([
			'src/parser.ts',
			'src/graph.ts'
		]);
	});

	it('adds a place with no reason, because nobody proposed it', () => {
		documenting.add('src/ink.ts');
		expect(documenting.places[3]).toEqual({ path: 'src/ink.ts' });
	});

	it('names each place once however often it is added', () => {
		documenting.add('docs');
		documenting.add('docs');
		expect(documenting.places.filter((place) => place.path === 'docs')).toHaveLength(1);
	});

	it('reorders the places the run writes in', () => {
		documenting.move('docs', -1);
		expect(documenting.places.map((place) => place.path)).toEqual([
			'docs',
			'src/parser.ts',
			'src/graph.ts'
		]);
		documenting.move('docs', -1);
		expect(documenting.places[0].path).toBe('docs');
		documenting.move('src/graph.ts', 1);
		expect(documenting.places[2].path).toBe('src/graph.ts');
	});

	it('hands the run the list as it stands, in its order', async () => {
		documenting.drop('src/parser.ts');
		documenting.add('README.md');
		documenting.move('README.md', -1);
		await documenting.run();

		expect(stub.held.plans[0].places).toEqual([
			{ path: 'docs', reason: 'What is written down' },
			{ path: 'README.md' },
			{ path: 'src/graph.ts', note: ref(7) }
		]);
	});

	it('keeps the words when somebody goes back to say something else', () => {
		documenting.say('Only the parser');
		documenting.askAgain();

		expect(documenting.step).toBe('intent');
		expect(documenting.said).toBe('Only the parser');
		expect(documenting.places).toEqual([]);
	});
});

describe('the run', () => {
	beforeEach(async () => {
		await documenting.opened(HOME);
		stub.proposes = [{ path: 'src/parser.ts' }];
		await documenting.survey();
	});

	it('follows the run as it goes and keeps the last answer', async () => {
		const seen: DocumentingProgress[] = [];
		stub.reports = [
			{ stage: 'writing', at: 'src/parser.ts', places: [] },
			{
				stage: 'done',
				places: [{ path: 'src/parser.ts', note: { ref: ref(9), done: 'written' } }]
			}
		];
		const running = documenting.run();
		seen.push(documenting.progress as DocumentingProgress);
		await running;

		expect(seen[0]).toEqual({ stage: 'reading', places: [] });
		expect(documenting.step).toBe('over');
		expect(documenting.progress?.stage).toBe('done');
		expect(documenting.progress?.places[0].note).toEqual({ ref: ref(9), done: 'written' });
	});

	it('carries the words of a run that could not go on', async () => {
		stub.reports = [
			{ stage: 'stopped', places: [], trouble: 'That took too long. Choose fewer places.' }
		];
		await documenting.run();

		expect(documenting.step).toBe('over');
		expect(documenting.trouble).toBe('That took too long. Choose fewer places.');
	});

	it('says nothing of its own about a run somebody stopped', async () => {
		stub.reports = [
			{
				stage: 'stopped',
				places: [{ path: 'src/parser.ts', note: { ref: ref(9), done: 'offered' } }]
			}
		];
		await documenting.run();

		expect(documenting.step).toBe('over');
		expect(documenting.trouble).toBeNull();
		expect(documenting.progress?.places).toHaveLength(1);
	});

	it('leaves somebody at the list where the run was refused outright', async () => {
		stub.reports = new Refusal('Sloppy is already writing about this project.');
		await documenting.run();

		expect(documenting.step).toBe('refining');
		expect(documenting.trouble).toBe('Sloppy is already writing about this project.');
		expect(documenting.places).toHaveLength(1);
	});

	it('ends what is underway when asked', async () => {
		stub.hold();
		const running = documenting.run();
		await settle();
		expect(documenting.step).toBe('running');
		await documenting.stop();
		await running;

		expect(stub.held.stops).toBe(1);
		expect(documenting.step).toBe('over');
	});
});

describe('another graph', () => {
	it('has not been asked this one\u2019s question', async () => {
		await documenting.opened(HOME);
		documenting.say('The parser');
		stub.proposes = [{ path: 'src/parser.ts' }];
		await documenting.survey();

		documenting.forget(ELSEWHERE);

		expect(documenting.step).toBe('intent');
		expect(documenting.said).toBe('');
		expect(documenting.places).toEqual([]);
	});

	it('keeps what is held for the graph it is about', async () => {
		await documenting.opened(HOME);
		stub.proposes = [{ path: 'src/parser.ts' }];
		await documenting.survey();

		documenting.forget(HOME);

		expect(documenting.step).toBe('refining');
		expect(documenting.places).toHaveLength(1);
	});

	it('ends a run that was underway for the graph left behind', async () => {
		await documenting.opened(HOME);
		stub.proposes = [{ path: 'src/parser.ts' }];
		await documenting.survey();
		stub.hold();
		const running = documenting.run();
		await settle();

		documenting.forget(ELSEWHERE);
		await running;

		expect(stub.held.stops).toBe(1);
		expect(documenting.step).toBe('intent');
	});
});

describe('the tags on a plan', () => {
	const PARSER = 'src/parser.ts';
	const VAULT = 'src/vault.ts';

	async function refining(places: ProposedPlace[]): Promise<void> {
		stub.proposes = places;
		await documenting.opened(HOME);
		await documenting.survey();
	}

	it('proposes what the survey gave each place', async () => {
		await refining([{ path: PARSER, tags: ['parsing'] }]);

		expect(documenting.places).toEqual([{ path: PARSER, tags: ['parsing'] }]);
	});

	it('takes one off without taking the place off', async () => {
		await refining([{ path: PARSER, tags: ['parsing', 'protocol'] }]);

		documenting.untag(PARSER, 'parsing');

		expect(documenting.places).toEqual([{ path: PARSER, tags: ['protocol'] }]);
	});

	it('leaves a place carrying no tags at all once the last one goes', async () => {
		await refining([{ path: PARSER, tags: ['parsing'] }]);

		documenting.untag(PARSER, 'parsing');

		expect(documenting.places).toEqual([{ path: PARSER }]);
	});

	it('takes it off the one place, and off nowhere else', async () => {
		await refining([
			{ path: PARSER, tags: ['parsing'] },
			{ path: VAULT, tags: ['parsing'] }
		]);

		documenting.untag(PARSER, 'parsing');

		expect(documenting.places).toEqual([{ path: PARSER }, { path: VAULT, tags: ['parsing'] }]);
	});

	it('runs on what survived, which is what the person allowed', async () => {
		await refining([{ path: PARSER, tags: ['parsing', 'protocol'] }]);
		documenting.untag(PARSER, 'protocol');

		await documenting.run();

		expect(stub.held.plans[0].places).toEqual([{ path: PARSER, tags: ['parsing'] }]);
	});
});

describe('the tags a run suggested', () => {
	const PARSER = 'src/parser.ts';
	const NOTE = ref(1);
	/** The two path segments `@sloppy/client` binds a reference as. */
	const WRITING_IT = `PATCH /nodes/${encodeURIComponent(NOTE.slice(0, NOTE.lastIndexOf('/')))}/${encodeURIComponent(NOTE.slice(NOTE.lastIndexOf('/') + 1))}`;
	let api: FakeApi;

	/** A run that left one note, with `suggested` beside it. */
	async function over(suggested?: string[]): Promise<void> {
		stub.reports = [
			{
				stage: 'done',
				places: [
					{
						path: PARSER,
						note: {
							ref: NOTE,
							done: 'written',
							...(suggested === undefined ? {} : { suggested })
						}
					}
				]
			}
		];
		stub.proposes = [{ path: PARSER }];
		await documenting.opened(HOME);
		await documenting.survey();
		await documenting.run();
	}

	function left(): string[] | undefined {
		return documenting.progress?.places[0].note?.suggested;
	}

	beforeEach(() => {
		nodes.clear();
		api = useFakeApi();
		updateRuntime({ documenting: stub });
		seamSettledAgain();
		session.adopt(VIEWER, 'a-session');
		api.on('GET /nodes', () => [node(1, '1', { tags: ['protocol'] })]);
	});

	afterEach(() => {
		nodes.clear();
		session.clear();
	});

	it('puts them on the note beside what it already carries', async () => {
		await nodes.load();
		const asked: unknown[] = [];
		api.on(WRITING_IT, (_url, init) => {
			asked.push(JSON.parse(String(init?.body)));
			return node(1, '1', { tags: ['parsing', 'protocol'] });
		});
		await over(['parsing']);

		await documenting.takeIn(documenting.progress!.places[0]);

		expect(asked).toEqual([{ tags: ['protocol', 'parsing'] }]);
		expect(nodes.get(NOTE)?.tags).toEqual(['parsing', 'protocol']);
	});

	it('stops offering them once they are on', async () => {
		await nodes.load();
		api.on(WRITING_IT, () => node(1, '1', { tags: ['parsing', 'protocol'] }));
		await over(['parsing']);
		expect(left()).toEqual(['parsing']);

		await documenting.takeIn(documenting.progress!.places[0]);

		expect(left()).toBeUndefined();
		expect(documenting.trouble).toBeNull();
	});

	it('leaves them standing, and says so, where the note could not be written', async () => {
		await nodes.load();
		api.on(WRITING_IT, () => new Response('nope', { status: 500 }));
		await over(['parsing']);

		await documenting.takeIn(documenting.progress!.places[0]);

		expect(left()).toEqual(['parsing']);
		expect(documenting.trouble).not.toBeNull();
	});

	it('reads a note this device has not, so putting one on takes none off', async () => {
		const wrote: unknown[] = [];
		api.on(WRITING_IT.replace('PATCH', 'GET'), () => node(1, '1', { tags: ['protocol'] }));
		api.on(WRITING_IT, (_url, init) => {
			wrote.push(JSON.parse(String(init?.body)));
			return node(1, '1', { tags: ['parsing', 'protocol'] });
		});
		await over(['parsing']);
		expect(nodes.get(NOTE)).toBeUndefined();

		await documenting.takeIn(documenting.progress!.places[0]);

		expect(wrote).toEqual([{ tags: ['protocol', 'parsing'] }]);
	});

	it('says so and leaves the suggestion where the note is not there at all', async () => {
		await over(['parsing']);

		await documenting.takeIn(documenting.progress!.places[0]);

		expect(left()).toEqual(['parsing']);
		expect(documenting.trouble).not.toBeNull();
	});

	it('asks for nothing where the run suggested none', async () => {
		await nodes.load();
		let asked = 0;
		api.on(WRITING_IT, () => {
			asked += 1;
			return node(1, '1');
		});
		await over();

		await documenting.takeIn(documenting.progress!.places[0]);

		expect(asked).toBe(0);
	});
});
