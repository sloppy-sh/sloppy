// A build's four acts: what the agent is told back, what the thread says, and
// what a role that was never served an act is answered with.

import type {
	BuildHandoff,
	BuildNeed,
	BuildPlan,
	BuildReview,
	BuildRole,
	BuildToolCall
} from '@sloppy/types';
import { beforeEach, describe, expect, it } from 'vitest';
import { serveBuildCall, type BuildActing, type BuildActTaken } from './build-acts.js';
import { ref } from './stores/fake-api.test-support.js';

const PLAN: BuildPlan = {
	tasks: [
		{
			id: 'reader',
			title: 'The reading half',
			effect: 'It reads.',
			paths: ['src/read.ts'],
			notes: [ref(1)]
		}
	],
	needs: [{ id: 'units', question: 'In what unit?', why: 'The sum is wrong otherwise.' }],
	disputes: [],
	checks: ['pnpm check']
};

const HANDOFF: BuildHandoff = {
	summary: 'The reading half reads.',
	files: ['src/read.ts'],
	checks: [{ command: 'pnpm check', passed: true, said: '' }],
	notes: [],
	undone: '',
	finished: true
};

/** The build as the acts see it: what each one was asked, and what the store
 *  answers it with. */
class Store implements BuildActing {
	plans: BuildPlan[] = [];
	raised: BuildNeed[] = [];
	handoffs: BuildHandoff[] = [];
	reviews: BuildReview[] = [];
	answer: BuildActTaken = 'taken';

	constructor(readonly role: BuildRole) {}

	async plan(plan: BuildPlan): Promise<BuildActTaken> {
		this.plans.push(plan);
		return this.answer;
	}

	async raise(need: BuildNeed): Promise<BuildActTaken> {
		this.raised.push(need);
		return this.answer;
	}

	async handOff(handoff: BuildHandoff): Promise<BuildActTaken> {
		this.handoffs.push(handoff);
		return this.answer;
	}

	async review(review: BuildReview): Promise<BuildActTaken> {
		this.reviews.push(review);
		return this.answer;
	}
}

function call(act: BuildToolCall['act'], args: unknown): BuildToolCall {
	return { call: 'c1', act, arguments: args } as BuildToolCall;
}

let planner: Store;

beforeEach(() => {
	planner = new Store('planner');
});

describe('the plan', () => {
	it('is held, and the thread says what it holds', async () => {
		const done = await serveBuildCall(planner, call('plan_build', PLAN));

		expect(planner.plans).toEqual([PLAN]);
		expect(done.trouble).toBeUndefined();
		expect(done.told).toBe('1 task · 1 question.');
		expect(done.said).toContain('in front of the person');
	});

	it('says how many disagreements there are only where there are any', async () => {
		const with_ = await serveBuildCall(
			planner,
			call('plan_build', { ...PLAN, disputes: [{ notes: [ref(1)], what: 'Two answers.' }] })
		);

		expect(with_.told).toBe('1 task · 1 question · 1 disagreement.');
	});

	it('is refused where one already stands, in words the agent can act on', async () => {
		planner.answer = 'already';

		const done = await serveBuildCall(planner, call('plan_build', PLAN));

		expect(done.trouble).toBe(true);
		expect(done.said).toContain('already has a plan');
		expect(done.told).toBe('The plan was already in.');
	});

	it('is not an act any other role does', async () => {
		for (const role of ['implementer', 'reviewer', 'merger'] as const) {
			const store = new Store(role);
			const done = await serveBuildCall(store, call('plan_build', PLAN));

			expect(done.trouble).toBe(true);
			expect(store.plans).toEqual([]);
		}
	});
});

describe('a question', () => {
	const NEED: BuildNeed = {
		id: 'units',
		question: 'In what unit is the budget counted?',
		why: 'The sum is wrong otherwise.'
	};

	it('tells a reading session to go on reading', async () => {
		const done = await serveBuildCall(planner, call('raise_need', NEED));

		expect(planner.raised).toEqual([NEED]);
		expect(done.said).toContain('Go on reading');
		expect(done.told).toBe(NEED.question);
	});

	it('tells a session building to hand off and wait', async () => {
		const store = new Store('implementer');

		const done = await serveBuildCall(store, call('raise_need', NEED));

		expect(done.said).toContain('`hand_off` now');
		expect(done.said).toContain('once they have answered');
	});

	it('is refused where the build is holding as many as it can', async () => {
		planner.answer = 'full';

		const done = await serveBuildCall(planner, call('raise_need', NEED));

		expect(done.trouble).toBe(true);
		expect(done.said).toContain('as many questions as it can');
	});
});

describe('a hand-off', () => {
	it('says what it carried, and that the session is done', async () => {
		const store = new Store('implementer');

		const done = await serveBuildCall(store, call('hand_off', HANDOFF));

		expect(store.handoffs).toEqual([HANDOFF]);
		expect(done.told).toBe('Handed on: 1 file, 1 check passed.');
		expect(done.said).toContain('nothing more for you to do');
	});

	it('says so where it is part-way, and where a check failed', async () => {
		const store = new Store('implementer');

		const done = await serveBuildCall(
			store,
			call('hand_off', {
				...HANDOFF,
				finished: false,
				files: [],
				checks: [
					{ command: 'pnpm check', passed: false, said: 'no' },
					{ command: 'pnpm lint', passed: true, said: '' }
				]
			})
		);

		expect(done.told).toBe('Handed on part-way: 0 files, 1 of 2 checks failed.');
	});

	it('says where a piece has handed on too many times', async () => {
		const store = new Store('implementer');
		store.answer = 'full';

		const done = await serveBuildCall(store, call('hand_off', HANDOFF));

		expect(done.trouble).toBe(true);
		expect(done.said).toContain('as many times as it can');
	});
});

describe('a review', () => {
	it('reads as nothing to fix where it is clean', async () => {
		const store = new Store('reviewer');

		const done = await serveBuildCall(
			store,
			call('review_build', { clean: true, findings: [] } satisfies BuildReview)
		);

		expect(store.reviews).toEqual([{ clean: true, findings: [] }]);
		expect(done.told).toBe('Nothing to fix.');
	});

	it('counts what blocks apart from what is only worth knowing', async () => {
		const store = new Store('reviewer');

		const done = await serveBuildCall(
			store,
			call('review_build', {
				clean: false,
				findings: [
					{ file: 'src/read.ts', severity: 'blocking', what: 'It throws.', why: 'It stops.' },
					{ file: 'src/read.ts', severity: 'advisory', what: 'A name.', why: 'Reads badly.' }
				]
			} satisfies BuildReview)
		);

		expect(done.told).toBe('1 to fix · 1 worth knowing.');
	});

	it('is refused where this piece has already been read', async () => {
		const store = new Store('reviewer');
		store.answer = 'already';

		const done = await serveBuildCall(store, call('review_build', { clean: true, findings: [] }));

		expect(done.trouble).toBe(true);
		expect(done.told).toBe('Already read.');
	});

	it('is not an act an implementer does', async () => {
		const store = new Store('implementer');

		const done = await serveBuildCall(store, call('review_build', { clean: true, findings: [] }));

		expect(done.trouble).toBe(true);
		expect(store.reviews).toEqual([]);
	});
});
