// What the picture of a history is laid out as — DESIGN.md § "The history as a
// picture". `commit-graph.svelte` draws what these answer.

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

/** Where one version sits: row `n` is the `n`th handed in, lane 0 the
 *  leftmost. */
export interface Placed {
	lane: number;
	/** Each version it springs from that is on this page, by row and lane. */
	springs: { row: number; lane: number }[];
	/** Whether anything it springs from is older than this page. */
	older: boolean;
}

/**
 * Lanes for a page of versions, in the order `graph()` hands them — newest
 * first and never above what they spring from, which is what lets one pass
 * settle every lane.
 *
 * A version takes the lane something already drawn springs into it from, else
 * the leftmost free one.
 */
export function placed(versions: readonly { id: string; parents: readonly string[] }[]): Placed[] {
	const row = new Map<string, number>();
	versions.forEach((one, at) => row.set(one.id, at));
	const held: (string | undefined)[] = [];
	const lane = new Map<string, number>();
	for (const one of versions) {
		const found = held.indexOf(one.id);
		const mine = found < 0 ? free(held) : found;
		for (let other = 0; other < held.length; other += 1) {
			if (other !== mine && held[other] === one.id) held[other] = undefined;
		}
		lane.set(one.id, mine);
		held[mine] = one.parents[0];
		for (const parent of one.parents.slice(1)) {
			const waiting = held.indexOf(parent);
			held[waiting < 0 ? free(held) : waiting] = parent;
		}
	}
	return versions.map((one) => ({
		lane: lane.get(one.id) ?? 0,
		springs: one.parents.flatMap((parent) => {
			const at = row.get(parent);
			const into = lane.get(parent);
			return at === undefined || into === undefined ? [] : [{ row: at, lane: into }];
		}),
		older: one.parents.some((parent) => !row.has(parent))
	}));
}

function free(held: (string | undefined)[]): number {
	const at = held.indexOf(undefined);
	if (at >= 0) return at;
	held.push(undefined);
	return held.length - 1;
}

/** Every version the line the folder is on leads back through, which is the one
 *  drawn at full ink. A line a version brought in is its own. */
export function alongTheLine(
	versions: readonly DrawnVersion[],
	from: string | undefined
): Set<string> {
	const by = new Map(versions.map((one) => [one.id, one]));
	const held = new Set<string>();
	let walk = from;
	while (walk !== undefined && by.has(walk) && !held.has(walk)) {
		held.add(walk);
		walk = by.get(walk)?.parents[0];
	}
	return held;
}
