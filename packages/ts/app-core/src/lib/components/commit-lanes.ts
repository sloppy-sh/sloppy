// Which lane every version of a history falls into and where the lines between
// them run — DESIGN.md § "The history as a picture". `commit-graph.svelte`
// draws what this answers.
//
// The lane assignment is Git Graph's (mhutchie/vscode-git-graph, MIT), read and
// rewritten rather than copied.

/** A version whose parent is older than the page: its line runs off the bottom. */
const OFF_PAGE = -1;
const UNDRAWN = -1;

export interface LaneCommit {
	id: string;
	/** What it springs from. Newest first is the order `graph()` answers on, and
	 *  a version above what it springs from is read as older than the page. */
	parents: readonly string[];
}

/** Where one version sits, by the row it was handed in. */
export interface LanePlace {
	lane: number;
	/** Which line it is on: an index into {@link Lanes.hues}. */
	line: number;
}

/** A line drawn from one row down to the row under it. */
export interface LaneLink {
	row: number;
	/** The lane it leaves `row` in. */
	from: number;
	/** The lane it arrives in on `row + 1`. */
	to: number;
	line: number;
}

export interface Lanes {
	/** By row, in the order the versions were handed in. */
	places: LanePlace[];
	links: LaneLink[];
	/** The hue each line took, counted from zero and free again once the line
	 *  holding it has ended. A page with more lines than the ramp has hues wraps
	 *  it, which is the caller's to do. */
	hues: number[];
	/** How many lanes wide the page is; one at its narrowest. */
	width: number;
}

interface Row {
	/** Rows, or {@link OFF_PAGE}, in the order the version springs from them. */
	parents: number[];
	walked: number;
	lane: number;
	line: number;
	/** The lanes taken on this row, leftmost first: the row each one runs to,
	 *  and whose line took it. */
	taken: { to: number; line: number }[];
}

interface Drawing {
	links: LaneLink[];
	hues: number[];
	/** The row the last line to hold each hue ended on. */
	spent: number[];
}

export function lanes(commits: readonly LaneCommit[]): Lanes {
	const rows = rowsOf(commits);
	const drawing: Drawing = { links: [], hues: [], spent: [] };
	for (let row = 0; row < rows.length; ) {
		if (next(rows[row]) === null && rows[row].line !== UNDRAWN) row += 1;
		else draw(rows, drawing, row);
	}
	return {
		places: rows.map((row) => ({ lane: row.lane, line: row.line })),
		links: drawing.links,
		hues: drawing.hues,
		width: rows.reduce((most, row) => Math.max(most, row.taken.length), 1)
	};
}

function rowsOf(commits: readonly LaneCommit[]): Row[] {
	const at = new Map<string, number>();
	for (const [row, one] of commits.entries()) if (!at.has(one.id)) at.set(one.id, row);
	return commits.map((one, row) => ({
		parents: one.parents.map((id) => {
			const found = at.get(id);
			// Walking down the page is the whole of how a line is drawn, so a parent
			// that is not under its child is one this page cannot reach.
			return found === undefined || found <= row ? OFF_PAGE : found;
		}),
		walked: 0,
		lane: 0,
		line: UNDRAWN,
		taken: []
	}));
}

/**
 * The line out of one version, down to the version it springs from and on
 * through everything that one springs from in turn, until it meets a line
 * already drawn or runs off the page.
 */
function draw(rows: Row[], drawing: Drawing, startAt: number): void {
	let one = rows[startAt];
	let parent = next(one);
	let lane = one.line === UNDRAWN ? free(one) : one.lane;

	const joined = joins(rows, one, parent);
	if (joined !== null) {
		for (let row = startAt + 1; row < rows.length; row += 1) {
			const here = rows[row];
			const met = takenFor(here, joined.row, joined.line);
			const into = met ?? free(here);
			drawing.links.push({ row: row - 1, from: lane, to: into, line: joined.line });
			take(here, into, joined.row, joined.line);
			lane = into;
			if (met !== null) {
				one.walked += 1;
				return;
			}
		}
		return;
	}

	const line = drawing.hues.length;
	drawing.hues.push(freeHue(drawing.spent, startAt));
	place(one, line, lane);
	take(one, lane, startAt, line);
	if (parent === null) {
		// Git Graph runs the lane of a version that springs from nothing down to
		// the foot of the page. Here that would draw a line out of the one place a
		// history has none, so the line ends where the version does.
		drawing.spent[drawing.hues[line]] = startAt;
		return;
	}

	let row = startAt + 1;
	for (; row < rows.length; row += 1) {
		const here = rows[row];
		const into = row === parent && here.line !== UNDRAWN ? here.lane : free(here);
		drawing.links.push({ row: row - 1, from: lane, to: into, line });
		take(here, into, parent ?? OFF_PAGE, line);
		lane = into;
		if (row !== parent) continue;
		one.walked += 1;
		const drawn = here.line !== UNDRAWN;
		place(here, line, into);
		one = here;
		parent = next(one);
		if (parent === null || drawn) break;
	}
	if (row === rows.length && parent === OFF_PAGE) one.walked += 1;
	drawing.spent[drawing.hues[line]] = row;
}

/** The line a version that brought one in runs down, where it and the version it
 *  took in are both already drawn. Null opens a line of its own instead. */
function joins(rows: Row[], one: Row, parent: number | null): { row: number; line: number } | null {
	if (parent === null || parent === OFF_PAGE) return null;
	if (one.parents.length < 2 || one.line === UNDRAWN) return null;
	const took = rows[parent];
	return took.line === UNDRAWN ? null : { row: parent, line: took.line };
}

function next(one: Row): number | null {
	return one.walked < one.parents.length ? one.parents[one.walked] : null;
}

function free(one: Row): number {
	return one.taken.length;
}

function take(one: Row, lane: number, to: number, line: number): void {
	if (lane === one.taken.length) one.taken.push({ to, line });
}

function takenFor(one: Row, to: number, line: number): number | null {
	const at = one.taken.findIndex((held) => held.to === to && held.line === line);
	return at < 0 ? null : at;
}

function place(one: Row, line: number, lane: number): void {
	if (one.line !== UNDRAWN) return;
	one.line = line;
	one.lane = lane;
}

function freeHue(spent: number[], startAt: number): number {
	const found = spent.findIndex((ended) => startAt > ended);
	if (found >= 0) return found;
	spent.push(0);
	return spent.length - 1;
}
