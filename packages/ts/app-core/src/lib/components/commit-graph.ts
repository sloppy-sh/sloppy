// What a row of the history is made of — DESIGN.md § "The history as a
// picture". `commit-graph.svelte` draws these; `commit-lanes.ts` places them.

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
