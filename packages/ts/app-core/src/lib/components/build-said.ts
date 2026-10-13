/**
 * What a build reads as, for the card — DESIGN.md § "A build" holds the words
 * and this is the one place they are written.
 */

import type { GraphDifference } from '@sloppy/graph';
import {
	type Build,
	type BuildCheck,
	type BuildHandoff,
	type BuildMerge,
	type BuildNeed,
	type BuildRole,
	type BuildSlug,
	type BuildState,
	type BuildTask,
	type BuildTaskRun,
	type BuildTaskState,
	CHAT_AGENTS,
	chatAgentName,
	chatAgentReach,
	type NodeView,
	type OwnedRef
} from '@sloppy/types';
import type { DifferenceBetween } from '../stores/history.svelte.js';

/** The programs Sloppy can have build, as somebody with none of them reads it. */
const PROGRAMS = CHAT_AGENTS.filter((agent) => chatAgentReach(agent) === 'program')
	.map(chatAgentName)
	.join(' or ');

/** What the act says where this machine has no assistant it can run. */
export const NEEDS_A_PROGRAM = `Sloppy asks ${PROGRAMS} to build, and it is not on this machine. Install it, then look again.`;

/** What discarding a build costs, which is what the one question says. */
export const DISCARD_COSTS =
	'The build and everything it wrote go. Your own notes and your folder are untouched.';

/** Where a build has got to, in one line. */
const STATE_SAID: Record<BuildState, string> = {
	reading: 'Reading your notes.',
	answering: 'Read the plan, answer what it asks, then build it.',
	building: 'Building.',
	reviewing: 'Reading what was built.',
	merging: 'Putting the work together.',
	built: 'Built.',
	stopped: 'Stopped. What landed is still here.',
	contested: 'A task nobody could settle. The decision is yours.',
	discarded: 'Discarded.'
};

export function buildSaid(state: BuildState): string {
	return STATE_SAID[state];
}

/** The same, short enough to stand beside a build's name in a list. */
const STATE_SHORT: Record<BuildState, string> = {
	reading: 'reading your notes',
	answering: 'waiting on you',
	building: 'building',
	reviewing: 'being read',
	merging: 'putting it together',
	built: 'built',
	stopped: 'stopped',
	contested: 'needs you',
	discarded: 'discarded'
};

export function buildShort(state: BuildState): string {
	return STATE_SHORT[state];
}

/** Where one task has got to. */
const TASK_SAID: Record<BuildTaskState, string> = {
	waiting: 'Waiting',
	building: 'Building',
	asking: 'Held on a question',
	reviewing: 'Being read',
	built: 'Built',
	contested: 'Nobody could settle this',
	merged: 'In the line'
};

export function taskSaid(state: BuildTaskState): string {
	return TASK_SAID[state];
}

/** Whether a build is still working, which is what Stop is offered on. */
export function working(state: BuildState): boolean {
	return (
		state === 'reading' ||
		state === 'answering' ||
		state === 'building' ||
		state === 'reviewing' ||
		state === 'merging'
	);
}

/** Whether a build is over, which is what the three acts stand on. */
export function over(state: BuildState): boolean {
	return state === 'built' || state === 'stopped' || state === 'contested';
}

/** A note as somebody cites it: the address they navigate by, then what it is
 *  called. Nothing for a note with neither. */
export function citedAs(note: Pick<NodeView, 'address' | 'title'>): string | undefined {
	const title = note.title.trim();
	if (note.address === undefined) return title === '' ? undefined : title;
	return title === '' ? note.address : `${note.address} · ${title}`;
}

/** What one session of a build is FOR, in the words the card and the
 *  transcript both read it by. `title` is the task's, where it has one. */
export function sessionSaid(role: BuildRole, title?: string): string {
	switch (role) {
		case 'planner':
			return 'Reading your notes';
		case 'implementer':
			return title === undefined ? 'Building' : `Building ${title}`;
		case 'reviewer':
			return title === undefined ? 'Reading what was built' : `Reading ${title}`;
		case 'merger':
			return 'Putting the work together';
	}
}

/** One question on the card: the plan's, or one a task raised and is held on.
 *  `by` is that task, and absent is the plan's own. */
export interface Question {
	need: BuildNeed;
	by?: BuildSlug;
	/** The note somebody wrote for it. */
	note?: OwnedRef;
	/** Whether they set it aside instead. */
	dropped: boolean;
}

/** Every question the card stands, the plan's first and then each task's in
 *  the order they were asked. */
export function questionsOf(build: Build): Question[] {
	const asked: { need: BuildNeed; by?: BuildSlug }[] = [
		...(build.plan?.needs ?? []).map((need) => ({ need })),
		...Object.entries(build.tasks).flatMap(([by, run]) =>
			run.needs.map((need) => ({ need, by: by as BuildSlug }))
		)
	];
	return asked.map(({ need, by }) => {
		const answer = build.answers[need.id];
		return {
			need,
			...(by === undefined ? {} : { by }),
			...(answer?.note === undefined ? {} : { note: answer.note }),
			dropped: answer?.dropped === true
		};
	});
}

/** How many questions nobody has answered or set aside. */
export function waitingOn(build: Build): number {
	return questionsOf(build).filter((one) => one.note === undefined && !one.dropped).length;
}

/** One task as the card reads it: what the plan said, where it got to, what
 *  its last session handed on, and the merge of it into the line. */
export interface TaskRead {
	id: BuildSlug;
	task: BuildTask;
	run: BuildTaskRun;
	/** The newest hand-off, absent where no session of it has left one. */
	last?: BuildHandoff;
	merge?: BuildMerge;
}

/** The tasks in the order the plan named them. A task with no run of its own
 *  yet reads as waiting. */
export function tasksOf(build: Build): TaskRead[] {
	return (build.plan?.tasks ?? []).map((task) => {
		const run = build.tasks[task.id] ?? { state: 'waiting', handoffs: [], needs: [], rounds: 0 };
		const last = run.handoffs.at(-1);
		const merge = build.merges.find((one) => one.task === task.id);
		return {
			id: task.id,
			task,
			run,
			...(last === undefined ? {} : { last }),
			...(merge === undefined ? {} : { merge })
		};
	});
}

/** Every place the build wrote, each once, in the order the tasks did. */
export function filesOf(build: Build): string[] {
	return [...new Set(tasksOf(build).flatMap((one) => one.last?.files ?? []))];
}

/** Every note the build wrote or changed, each once. */
export function notesOf(build: Build): OwnedRef[] {
	return [...new Set(tasksOf(build).flatMap((one) => one.last?.notes ?? []))];
}

/** What a check said, in one line: the command, and whether it came to
 *  anything to fix. */
export function checkSaid(check: BuildCheck): string {
	return check.passed ? 'Nothing to fix' : 'Something to fix';
}

/** How far the build's line has got into the reader's own. `settling` is a
 *  bring-in part way through: the build and the reader both wrote in some of
 *  the same notes, and those are the reader's to choose between. */
export type BuildBrought = 'open' | 'settling' | 'in';

const BROUGHT_SAID: Record<BuildBrought, string> = {
	open: 'yours to take',
	settling: 'part way in, with notes in two versions',
	in: 'brought in'
};

export function broughtSaid(brought: BuildBrought): string {
	return BROUGHT_SAID[brought];
}

/** What the acts that take the line's version say where the folder keeps no
 *  such line, so nothing of the build is there to stand on or read against. */
export function noLineHere(line: string): string {
	return `There is nothing here called ${line}.`;
}

/** What a bring-in that left notes in two versions asks for next, where the
 *  history itself says nothing because nothing was refused. */
export function settleTheNotes(left: number): string {
	return left === 1
		? 'One note is in two versions: the build and you both wrote in it. Choose what it says, then keep a version to finish bringing it in.'
		: `${left.toLocaleString()} notes are in two versions: the build and you both wrote in them. Choose what each one says, then keep a version to finish bringing it in.`;
}

/** The build's notes set against the folder's, as the canvas draws any two
 *  states — named the way every other comparison names its two sides. A note
 *  that only moved is not `changed`: the move is drawn on its lines. */
export function notesOnTheCanvas(held: DifferenceBetween): {
	says: string;
	difference: GraphDifference;
} {
	return { says: 'Your notes to the build', difference: drawn(held) };
}

function drawn(held: DifferenceBetween): GraphDifference {
	const added: OwnedRef[] = [];
	const changed: OwnedRef[] = [];
	const moved: { ref: OwnedRef; from?: OwnedRef }[] = [];
	for (const note of held.notes) {
		if (note.became === 'added') added.push(note.ref);
		if (note.became !== 'kept') continue;
		if (note.moved) {
			moved.push({
				ref: note.ref,
				...(note.moved.from === undefined ? {} : { from: note.moved.from })
			});
		}
		if (note.retitled || note.renumbered || note.reordered || note.sections.length > 0) {
			changed.push(note.ref);
		}
	}
	return { added: new Set(added), removed: held.gone, moved, changed: new Set(changed) };
}
