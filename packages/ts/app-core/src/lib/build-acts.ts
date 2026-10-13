/**
 * A build's own four acts, done in the page the build runs in —
 * docs/ARCHITECTURE.md § "Building from the notes". `chat-acts.ts` is the other
 * half of what a build's sessions are served, and `BuildAccess` in `runtime.ts`
 * is where their writing lands.
 *
 * An act answers two readers, exactly as the chat's do: `said` is the agent's,
 * and the line the thread draws is the person's. What the act CHANGES is the
 * build, which the store holding it does through {@link BuildActing} — so
 * nothing here knows where a build is kept or which session is running.
 */

import type {
	BuildHandoff,
	BuildNeed,
	BuildPlan,
	BuildReview,
	BuildRole,
	BuildToolCall,
	ChatActDone
} from '@sloppy/types';

/** Words for the AGENT, which reads an answer rather than being left waiting
 *  on one. */
const PLAN_IN =
	'This build already has a plan, so that one was not taken. There is nothing more to plan here.';
const PLAN_TAKEN =
	'The plan is in front of the person. They answer the questions in it and start the work; there is nothing more for you to do.';
const NEED_FULL =
	'This build is holding as many questions as it can. Build what the notes already say, and say what you could not in your hand-off.';
const NEED_ASKED_ALONE =
	'That question is on the build’s plan. Go on reading, and answer with `plan_build` when you are done.';
const NEED_ASKED =
	'That question is in front of the person. Call `hand_off` now with what you have; a fresh session goes on from it once they have answered.';
const HANDED_ON = 'Noted. There is nothing more for you to do.';
const HANDOFF_FULL =
	'This piece has handed on as many times as it can. It is in front of the person now; there is nothing more for you to do.';
const REVIEWED = 'Noted. There is nothing more for you to do.';
const REVIEW_IN = 'You have already answered about this piece, so that one was not taken.';
const NOT_THIS_ROLE =
	'That act is not one this session does. The acts you were given are the whole of what you can call here.';

/** The person's half, as one line in the thread. */
const PLAN_IN_TOLD = 'The plan was already in.';
const NEED_FULL_TOLD = 'Too many questions to hold another.';
const HANDOFF_FULL_TOLD = 'Handed on too many times.';
const REVIEW_IN_TOLD = 'Already read.';
const NOT_THIS_ROLE_TOLD = 'Not one of this session’s acts.';

/** Whether what a session answered with was taken, and where it was not, what
 *  stopped it: a plan or a review already in, or a build holding as much as it
 *  can. */
export type BuildActTaken = 'taken' | 'already' | 'full';

/**
 * What a build's acts are done to: the build the calling session belongs to, as
 * the store running it holds the build. `role` is what the session is FOR,
 * which decides the acts it may call at all.
 */
export interface BuildActing {
	readonly role: BuildRole;
	/** The plan held, and the build moved to the person. */
	plan(plan: BuildPlan): Promise<BuildActTaken>;
	/** The question held — under another id where the one it arrived under is
	 *  taken, so one answer can never reach two questions. */
	raise(need: BuildNeed): Promise<BuildActTaken>;
	/** What this session hands on, held for the next one. */
	handOff(handoff: BuildHandoff): Promise<BuildActTaken>;
	/** What a reading session found, held against the task. */
	review(review: BuildReview): Promise<BuildActTaken>;
}

/**
 * One of a build's acts, done and answered. The arguments arrived parsed, so
 * what is decided here is only whether the build can take it.
 */
export async function serveBuildCall(at: BuildActing, call: BuildToolCall): Promise<ChatActDone> {
	switch (call.act) {
		case 'plan_build': {
			if (at.role !== 'planner') return refused();
			const taken = await at.plan(call.arguments);
			return taken === 'taken'
				? { said: PLAN_TAKEN, told: planTold(call.arguments), touched: [] }
				: trouble(PLAN_IN, PLAN_IN_TOLD);
		}
		case 'raise_need': {
			const taken = await at.raise(call.arguments);
			if (taken === 'full') return trouble(NEED_FULL, NEED_FULL_TOLD);
			return {
				said: at.role === 'planner' ? NEED_ASKED_ALONE : NEED_ASKED,
				told: shortly(call.arguments.question),
				touched: []
			};
		}
		case 'hand_off': {
			const taken = await at.handOff(call.arguments);
			if (taken === 'full') return trouble(HANDOFF_FULL, HANDOFF_FULL_TOLD);
			return { said: HANDED_ON, told: handoffTold(call.arguments), touched: [] };
		}
		case 'review_build': {
			if (at.role !== 'reviewer') return refused();
			const taken = await at.review(call.arguments);
			return taken === 'taken'
				? { said: REVIEWED, told: reviewTold(call.arguments), touched: [] }
				: trouble(REVIEW_IN, REVIEW_IN_TOLD);
		}
	}
}

/** What the plan says in the thread, in the words the card is read in. */
function planTold(plan: BuildPlan): string {
	const said = [many(plan.tasks.length, 'task'), many(plan.needs.length, 'question')];
	if (plan.disputes.length > 0) said.push(many(plan.disputes.length, 'disagreement'));
	return `${said.join(' · ')}.`;
}

function handoffTold(handoff: BuildHandoff): string {
	const files = many(handoff.files.length, 'file');
	const failed = handoff.checks.filter((one) => !one.passed).length;
	const checks =
		handoff.checks.length === 0
			? 'no checks'
			: failed === 0
				? `${many(handoff.checks.length, 'check')} passed`
				: `${failed} of ${many(handoff.checks.length, 'check')} failed`;
	return `${handoff.finished ? 'Handed on' : 'Handed on part-way'}: ${files}, ${checks}.`;
}

function reviewTold(review: BuildReview): string {
	if (review.clean && review.findings.length === 0) return 'Nothing to fix.';
	const blocking = review.findings.filter((one) => one.severity === 'blocking').length;
	const rest = review.findings.length - blocking;
	const said = [];
	if (blocking > 0) said.push(`${blocking} to fix`);
	if (rest > 0) said.push(`${rest} worth knowing`);
	return said.length === 0 ? 'Read, with nothing named.' : `${said.join(' · ')}.`;
}

function many(count: number, one: string): string {
	return `${count} ${one}${count === 1 ? '' : 's'}`;
}

/** Past this a line in the thread is something to scroll rather than read. */
const TOLD_MAX = 120;

function shortly(said: string): string {
	const line = said.split('\n')[0].trim();
	return line.length > TOLD_MAX ? `${line.slice(0, TOLD_MAX - 1)}…` : line;
}

function refused(): ChatActDone {
	return trouble(NOT_THIS_ROLE, NOT_THIS_ROLE_TOLD);
}

function trouble(said: string, told: string): ChatActDone {
	return { said, trouble: true, told, touched: [] };
}
