/**
 * What is said INTO one of a build's sessions once it is running: the one turn
 * that starts it on its job, and the ones that follow — a hand-off to go on
 * from, findings to fix, an answer to a question it asked, a hand-off asked for
 * before its window fills. `build-brief.ts` is what a session is told before
 * any of this.
 *
 * **A hand-off is the only thing that passes between sessions**, so these
 * compose one out of what the build holds rather than out of a transcript —
 * docs/ARCHITECTURE.md § "Building from the notes".
 */

import {
	type BuildHandoff,
	type BuildReview,
	type BuildRole,
	CHAT_ASKED_MAX,
	type OwnedRef
} from '@sloppy/types';

/** One question the person has answered, as the session that asked it is told.
 *  **Absent `note` is a question they set aside**, which is built without. */
export interface NeedAnswered {
	question: string;
	note?: OwnedRef;
}

/** The one turn a session whose window is filling is sent: it hands off now,
 *  and a fresh one goes on from what it wrote. */
export const HAND_OFF_NOW =
	'Stop where you are and call `hand_off` now, with `finished` false unless you are actually done. Say in it exactly what the next session has to pick up, because it will be given this and nothing else of yours.';

/**
 * The turn a session that has to answer NOW is sent — its window is filling, or
 * it ended a turn having said nothing at all. **It names the act that role was
 * served**: `toolsForRole` gives a planner and a reviewer no `hand_off`, so
 * asking either for one is asking for what it cannot call.
 */
export function answerNow(role: BuildRole): string {
	switch (role) {
		case 'planner':
			return 'Stop where you are and call `plan_build` now, with the tasks you can already name and everything you still do not know as a need. Words on their own are not read here.';
		case 'reviewer':
			return 'Stop where you are and call `review_build` now, with what you have found so far and `clean` false unless what you read is right.';
		default:
			return HAND_OFF_NOW;
	}
}

/** The turn that starts the reading session on the plan. */
export function planningSaid(): string {
	return within('Read what your brief names, then answer with `plan_build`.');
}

/** The turn that starts a session on one task: on nothing, or on what the last
 *  session left and whatever has been answered since. */
export function buildingSaid(of: {
	handoff?: BuildHandoff;
	answered?: readonly NeedAnswered[];
}): string {
	const said = ['Build the piece your brief names.'];
	if (of.handoff) said.push('', 'A session before you got this far:', handoffSaid(of.handoff));
	if (of.answered !== undefined && of.answered.length > 0) said.push('', answeredSaid(of.answered));
	return within(said.join('\n'));
}

/** And the turn that starts a session on what a review found. */
export function fixingSaid(review: BuildReview, handoff: BuildHandoff | undefined): string {
	const blocking = review.findings.filter((one) => one.severity === 'blocking');
	const said = [
		'The piece your brief names was built and read, and it was not right yet. Fix what blocks, then hand off.'
	];
	if (handoff) said.push('', 'What was built:', handoffSaid(handoff));
	said.push(
		'',
		'What blocks:',
		...blocking.map(
			(one) =>
				`- ${one.file}${one.line === undefined ? '' : `:${one.line}`} — ${one.what} (${one.why})`
		)
	);
	const advisory = review.findings.filter((one) => one.severity !== 'blocking');
	if (advisory.length > 0)
		said.push(
			'',
			'Worth knowing, and worth nobody a second round — fix one only where it is a line:',
			...advisory.map((one) => `- ${one.file} — ${one.what}`)
		);
	return within(said.join('\n'));
}

/** The turn that starts a session reading one task. */
export function reviewingSaid(handoffs: readonly BuildHandoff[]): string {
	const said = [
		'Read what was built for the piece your brief names, then answer with `review_build`.'
	];
	const last = handoffs[handoffs.length - 1];
	if (last) said.push('', 'What the sessions that built it said:', handoffSaid(last));
	return within(said.join('\n'));
}

/** The turn that sets a session on files two tasks left in two versions. */
export function mergingSaid(conflicts: readonly string[]): string {
	return within(
		[
			'Two pieces of this build wrote the same files, and these are left in two versions:',
			...conflicts.map((path) => `- ${path}`),
			'',
			'Settle each one so both pieces are still answered, then run the checks and hand off.'
		].join('\n')
	);
}

/** And the turn that has the whole line checked once it is together. */
export function checkingSaid(): string {
	return within(
		'Every piece of this build is on the line you are standing in. Run the checks your brief names, fix what they report, and hand off with what each one said.'
	);
}

/** One hand-off as the next session reads it. */
export function handoffSaid(handoff: BuildHandoff): string {
	const said = [handoff.summary];
	if (handoff.files.length > 0) said.push(`Files: ${handoff.files.join(', ')}`);
	if (handoff.checks.length > 0)
		said.push(
			`Checks: ${handoff.checks
				.map((one) => `${one.command} — ${one.passed ? 'passed' : 'failed'}`)
				.join('; ')}`
		);
	if (handoff.notes.length > 0) said.push(`Notes written: ${handoff.notes.join(', ')}`);
	if (handoff.undone !== '') said.push(`Left undone: ${handoff.undone}`);
	return said.join('\n');
}

/** The questions a session asked, as it is told they are answered. */
export function answeredSaid(answered: readonly NeedAnswered[]): string {
	return [
		'What you asked has been answered:',
		...answered.map((one) =>
			one.note === undefined
				? `- ${one.question} — set aside. Build without it.`
				: `- ${one.question} — answered in the note ${one.note}. Read it.`
		)
	].join('\n');
}

/** Held to what one turn carries. The head is what the session is being asked
 *  to do, so what goes is the end of it. */
function within(said: string): string {
	return said.length <= CHAT_ASKED_MAX ? said : `${said.slice(0, CHAT_ASKED_MAX - 1)}…`;
}
