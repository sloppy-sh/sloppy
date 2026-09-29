// What a row of the history is made of — DESIGN.md § "The history as a
// picture". `commit-graph.svelte` draws these; `commit-lanes.ts` places them.

import type { GraphCommit } from '@sloppy/local';

/** One version as the picture draws it. */
export interface DrawnVersion {
	id: string;
	message: string;
	/** Whoever kept it, where the graph has a name for them. */
	author?: string;
	/** When, as the row shows it. */
	when: string;
	/** What it springs from, newest first: none on the first version of a
	 *  history, two where it brought a line in. */
	parents: string[];
	/** Every branch at it: one here by its own name, one kept somewhere else as
	 *  `origin/main`. Empty is a version no branch is at. */
	refs: string[];
	/** Absent is a version nobody signed. */
	signed?: { by: string; verified: boolean };
}

/** The day a version was kept, in the reader's own language. */
export function whenKept(at: string): string {
	const day = new Date(at);
	return Number.isNaN(day.getTime())
		? ''
		: day.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Who kept it, where that is a name rather than an identifier. */
export function keptBy(author: string): string | undefined {
	return author === '' || author.startsWith('did:') ? undefined : author;
}

/**
 * The picture as it is drawn, out of the history as it is held. One copy, so
 * the sheet and the column beside the graph cannot draw the same version two
 * different ways.
 */
export function drawnFrom(picture: readonly GraphCommit[]): DrawnVersion[] {
	return picture.map((one) => {
		const author = keptBy(one.author);
		return {
			id: one.id,
			message: one.message,
			...(author === undefined ? {} : { author }),
			when: whenKept(one.at),
			parents: one.parents,
			refs: one.refs,
			...(one.signature === undefined ? {} : { signed: one.signature })
		};
	});
}

/**
 * A run of versions nobody wrote a message for, folded into the first of them
 * — DESIGN.md § "The history as a picture". The run is only ever folded where
 * it is more than one: a single one reads as itself.
 */
export interface Folded {
	/** What to draw, with a folded run standing as its first version. */
	drawn: DrawnVersion[];
	/** How many a folded row stands for, by that row's id; absent is a row
	 *  standing for itself alone. */
	holding: Map<string, number>;
}

export function foldRuns(
	versions: readonly DrawnVersion[],
	message: string,
	opened: ReadonlySet<string>
): Folded {
	const drawn: DrawnVersion[] = [];
	const holding = new Map<string, number>();
	for (let at = 0; at < versions.length; at += 1) {
		const one = versions[at];
		if (one.message !== message) {
			drawn.push(one);
			continue;
		}
		let end = at;
		while (end + 1 < versions.length && versions[end + 1].message === message) end += 1;
		const run = end - at + 1;
		const named = versions.slice(at, end + 1).some((held) => held.refs.length > 0);
		// One of them is one version, and a run somebody has opened is every one
		// of them. A version a line points at is one somebody looks for by name,
		// so a run carrying one is not folded at all.
		if (run < 2 || named || opened.has(one.id)) {
			for (const held of versions.slice(at, end + 1)) drawn.push(held);
			at = end;
			continue;
		}
		drawn.push(one);
		holding.set(one.id, run);
		at = end;
	}
	return { drawn, holding };
}
