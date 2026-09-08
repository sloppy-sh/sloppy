// What somebody is told before they publish, asked about one branch on its own
// surface and about every note they chose on the canvas. PRODUCT.md § "Design
// Principles" 5 puts it at the decision, and one wording serves both.

import type { Address } from '@sloppy/types';

/** What a publish is about: one branch, by the name a person cites it by — its
 *  address, or words for one whose author gave it none — or however many notes
 *  they chose. */
export type PublishSubject = { branch: string } | { notes: number };

function subjectOf(of: PublishSubject): {
	name: string;
	it: string;
	stands: string;
	several: boolean;
} {
	if ('branch' in of) return { name: of.branch, it: 'it', stands: 'it stands', several: false };
	if (of.notes === 1) return { name: 'this note', it: 'it', stands: 'it stands', several: false };
	return {
		name: `these ${of.notes.toLocaleString()} notes`,
		it: 'them',
		stands: 'they stand',
		several: true
	};
}

/** What publishing puts out, and what taking it down cannot take back.
 *  `answersReach` is false where answers people write never arrive here. */
export function publishingSays(of: PublishSubject, answersReach: boolean): string[] {
	const { name, it, several } = subjectOf(of);
	// "here" names the control the branch's own sheet carries. A set of notes is
	// told otherwise on each note's own surface, so there is no here to point at.
	const otherwise = 'branch' in of ? 'until you say otherwise here' : 'until you say otherwise';
	return [
		`Everything under ${name} goes out: every note in ${it}, finished or not, and every picture in them.`,
		`The name you gave the graph ${several ? 'each of them sits' : `${it} sits`} in goes out too.`,
		`How ${several ? 'they look' : 'it looks'} on the graph goes out as well — the ring and the size, though not a picture you set there.`,
		`Anyone who can find your profile can read ${it}. There is no link to keep back and nobody to let in.`,
		`If you take ${it} down, whoever has already read ${it} keeps their copy.`,
		answersReach
			? `Anyone reading ${it} may answer, ${otherwise}.`
			: `Anyone reading ${it} may answer. Their answers reach people reading ${it} elsewhere — you will not see them here.`
	];
}

/** What publishing does to what is already out. */
export function publishingAgain(of: PublishSubject): string {
	const { stands } = subjectOf(of);
	const name =
		'branch' in of
			? of.branch
			: of.notes === 1
				? 'the one you have already published'
				: `the ${of.notes.toLocaleString()} you have already published`;
	const before = 'branch' in of || of.notes === 1 ? 'it' : 'them';
	return `Publishing again sends ${name} as ${stands} now. Every version before ${before} stays readable.`;
}

/** What publishing again does to who may answer: nothing. */
export const KEEPS_TERMS = 'What you have already published keeps the terms you set on it.';

/** A branch rooted above this one that already carries it, so publishing here
 *  puts that writing out a second time. */
export function alreadyCarried(of: PublishSubject, by: Address): string {
	const what =
		'branch' in of ? 'this branch' : of.notes === 1 ? 'the note you chose' : 'notes you chose';
	return `${by} already carries ${what}, on its own terms.`;
}

/** A branch under this one published inviting fewer people to answer. What goes
 *  out here carries it on these terms. */
export function narrowerSays(under: Address, out: 'going' | 'already'): string {
	const carrier = out === 'going' ? 'What you publish here' : 'What is published here';
	return `${under} is published inviting fewer people to answer. ${carrier} carries it on these terms.`;
}
