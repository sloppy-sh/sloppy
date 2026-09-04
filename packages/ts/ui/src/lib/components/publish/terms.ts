// What somebody is told before they publish, asked about one branch on its own
// surface and about every note they chose on the canvas. PRODUCT.md § "Design
// Principles" 5 puts it at the decision, and one wording serves both.

import type { Address } from '@sloppy/types';

/** What a publish is about: one branch, by the address a person cites, or
 *  however many notes they chose. */
export type PublishSubject = { address: Address } | { notes: number };

function subjectOf(of: PublishSubject): { name: string; it: string; stands: string } {
	if ('address' in of) return { name: of.address, it: 'it', stands: 'it stands' };
	if (of.notes === 1) return { name: 'this note', it: 'it', stands: 'it stands' };
	return {
		name: `these ${of.notes.toLocaleString()} notes`,
		it: 'them',
		stands: 'they stand'
	};
}

/** What publishing puts out, and what taking it down cannot take back.
 *  `answersReach` is false where answers people write never arrive here. */
export function publishingSays(of: PublishSubject, answersReach: boolean): string[] {
	const { name, it } = subjectOf(of);
	return [
		`Everything under ${name} goes out: every note in ${it}, finished or not, and every picture in them.`,
		`Anyone who can find your profile can read ${it}. There is no link to keep back and nobody to let in.`,
		`If you take ${it} down, whoever has already read ${it} keeps their copy.`,
		answersReach
			? `Anyone reading ${it} may answer, until you say otherwise.`
			: `Anyone reading ${it} may answer. Their answers reach people reading ${it} elsewhere — you will not see them here.`
	];
}

/** What publishing does to what is already out. */
export function publishingAgain(of: PublishSubject): string {
	const { stands } = subjectOf(of);
	const name =
		'address' in of
			? of.address
			: of.notes === 1
				? 'the one you have already published'
				: `the ${of.notes.toLocaleString()} you have already published`;
	return `Publishing again sends ${name} as ${stands} now. Every version before it stays readable.`;
}
