/**
 * What each of a build's sessions is told before anything is said to it: what
 * the role is for, the task it is on, the notes it is built from WHOLE, and the
 * rules it works under — docs/ARCHITECTURE.md § "Building from the notes".
 *
 * **The notes are the bulk of it and nothing else of the graph is here.** That
 * is the whole of why a session's window stays small: what it needs is in front
 * of it, so it hunts for nothing, and what it does not need never arrives.
 * `build-said.ts` is what is said INTO a session once it is running.
 */

import type { BuildRole, BuildTask, OwnedRef } from '@sloppy/types';

/** One note as a session is handed it: whole, in the markdown its author
 *  wrote. `address` is absent on a note nobody has numbered, and `anchors` are
 *  the places in the code it points at, from the project root. */
export interface BriefNote {
	note: OwnedRef;
	title: string;
	address?: string;
	sections: readonly string[];
	anchors: readonly string[];
}

/** What a build's sessions are told alongside their own job. */
export interface BriefOf {
	notes: readonly BriefNote[];
	/** The commands this project runs to tell whether it still works. EMPTY is
	 *  a project that names none, and nothing is run. */
	checks: readonly string[];
}

/** The reading session's brief: the notes the build was asked for, and the plan
 *  as the whole of its answer. */
export function plannerBrief(of: BriefOf): string {
	return [
		'You are reading a project to plan how a piece of it gets built.',
		'',
		'The notes below say what that piece is FOR. They come first: the code grows out of them, and where they do not say something the build has to get right, you ask rather than decide. Read them, read what they point at in the code, and read whatever else of the project you need.',
		'',
		'Answer with one call of `plan_build` and nothing else. It carries:',
		'- the tasks the work splits into, each with what the project will do differently once it is built in one paragraph, the places it writes, and the exact notes it is built from. No two tasks write the same place.',
		'- the questions the notes do not answer and the build cannot be right without. Each is answered by a note the person writes, so ask for what belongs in a note.',
		'- where two notes, or a note and the code, say different things.',
		'- the commands this project runs to tell whether it still works, read off the repository.',
		'',
		'Nothing you write in prose is read. Use `raise_need` for a question you want in front of the person as you read; it goes on the plan either way.',
		'',
		rules('planner'),
		'',
		notesSaid(of.notes),
		checksSaid(of.checks)
	].join('\n');
}

/** One task's brief, for the session writing the code. */
export function implementerBrief(task: BuildTask, of: BriefOf): string {
	return [
		'You are building one piece of a project out of the notes that say what it is for.',
		'',
		taskSaid(task),
		'',
		'Work only in the places named above. Read the project, search the notes, and read the web where you can. Write the code, run the checks below, and write a note for anything you decided that the notes did not already say — a reason only where you can name the source it came from.',
		'',
		'End with one call of `hand_off`: what you built, the files you wrote, every check you ran and what it said, the notes you wrote, and what you left undone. The next session is given that and nothing else of yours.',
		'',
		'Where the notes do not say something you would otherwise guess, call `raise_need`. The question goes in front of the person, and you hand off with what you have; a fresh session goes on from it once they have answered.',
		'',
		rules('implementer'),
		'',
		notesSaid(of.notes),
		checksSaid(of.checks)
	].join('\n');
}

/** And the brief for the session reading what was written. */
export function reviewerBrief(task: BuildTask, of: BriefOf): string {
	return [
		'You are reading what was built for one piece of a project against what it was for.',
		'',
		taskSaid(task),
		'',
		'Read the notes below, read what was written, and run the checks. Then answer with one call of `review_build`: whether it is clean, and one finding per thing that is wrong, each with its file, whether it blocks, what is wrong and what it costs.',
		'',
		'Clean with nothing found is the right answer for work that is right. Do not invent a finding to look thorough, and do not report what you would have built differently where what is there does what the task was for.',
		'',
		'Change nothing yourself.',
		'',
		rules('reviewer'),
		'',
		notesSaid(of.notes),
		checksSaid(of.checks)
	].join('\n');
}

/** The brief for the session working on the build's own line: settling what two
 *  tasks left in two versions, and running the line's checks. */
export function mergerBrief(tasks: readonly BuildTask[], of: BriefOf): string {
	return [
		'You are working on the line the whole build lands on, where the pieces come together.',
		'',
		'What each piece was for:',
		...tasks.map((task) => `- ${task.title}: ${task.effect}`),
		'',
		'Where two of them left a file in two versions, settle it so that both are still answered — what each piece was for is above, and a file that keeps only one side of it has lost half the work. Then run the checks below and fix what they report.',
		'',
		'End with one call of `hand_off`: what you settled, the files, every check you ran and what it said, and what you left undone.',
		'',
		rules('merger'),
		'',
		notesSaid(of.notes),
		checksSaid(of.checks)
	].join('\n');
}

/** What every role is held to, and the two lines each of them differs by.
 *  The reading session is the one that runs in the person's own folder, so it
 *  is the one told the folder is theirs. */
function rules(role: BuildRole): string {
	return [
		'The rules, all of them:',
		'- Stay in the folder you were started in, and never push anything anywhere.',
		role === 'planner'
			? "- That folder is the person's own. Read it, and leave everything in it exactly as you found it."
			: "- That folder is a copy of the project made for this work alone. Nothing of the person's own is yours to touch.",
		role === 'implementer'
			? '- Keep to the places this task names. Another piece of the work is in the others right now.'
			: role === 'merger'
				? '- Settle what is in two versions and nothing else. What every piece built stays built.'
				: '- Write nothing. You are reading.',
		'- Start no sub-agents of your own. Every piece of this work is one session with one job, and one that spawns its own is a context nobody can see.',
		'- Ask rather than guess. A build built on a guess is worse than one that waited.',
		'- A reason you write into a note names where it came from. Where you cannot name a source, say what you did and not why.',
		'- Answer with the act you were given. What you write in prose is not read.'
	].join('\n');
}

function taskSaid(task: BuildTask): string {
	return [
		`The piece: ${task.title}`,
		'',
		`What the project does differently once it is built: ${task.effect}`,
		'',
		`The places you write, from the project root: ${task.paths.join(', ')}`
	].join('\n');
}

/** The notes, whole, in the order they were named. Each one is headed by what a
 *  person cites it as, so a session can name one back in a hand-off. */
function notesSaid(notes: readonly BriefNote[]): string {
	if (notes.length === 0) return 'No notes were named for this.\n';
	const said = notes.map((note) =>
		[
			`### ${note.address === undefined ? note.title : `${note.address} — ${note.title}`}`,
			`Note: ${note.note}`,
			...(note.anchors.length === 0
				? []
				: [`Points at, from the project root: ${note.anchors.join(', ')}`]),
			'',
			...(note.sections.length === 0 ? ['(Nothing is written in it yet.)'] : note.sections)
		].join('\n')
	);
	return `## The notes this is built from\n\n${said.join('\n\n')}\n`;
}

function checksSaid(checks: readonly string[]): string {
	if (checks.length === 0) return '\n## The checks\n\nThis project names none, so run nothing.\n';
	return `\n## The checks\n\n${checks.map((one) => `- ${one}`).join('\n')}\n`;
}
