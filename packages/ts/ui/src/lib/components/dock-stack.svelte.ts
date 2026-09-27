// What stands docked down the right-hand edge of the page, and the one width
// they owe it together — DESIGN.md § "The four inset vars". Two panels each
// writing that var would race, and whichever drew last would win.

class Standing {
	readonly outer: number;
	/** Null while this dock takes no room at all, which is not the same as taking
	 *  none yet: a page with nothing docked owes nothing and the var goes away. */
	width = $state<number | null>(null);

	constructor(outer: number) {
		this.outer = outer;
	}
}

const docks = $state<Standing[]>([]);

let published = '';

function publish(): void {
	const taking = docks.filter((one) => one.width !== null);
	const width =
		taking.length === 0 ? '' : `${taking.reduce((sum, one) => sum + (one.width ?? 0), 0)}px`;
	if (width === published) return;
	published = width;
	const root = document.documentElement;
	if (width) root.style.setProperty('--reading-dock-inset-right', width);
	else root.style.removeProperty('--reading-dock-inset-right');
	// The canvas beside resizes to its parent on a window `resize` and nothing
	// else, and the window did not change: only the box the docks left it.
	window.dispatchEvent(new Event('resize'));
}

export interface RightDock {
	/** What is docked outside this one, together, in px — how far from the right
	 *  edge of the page it stands. */
	readonly from: number;
	/** What every OTHER dock takes, together, in px — the room this one may not
	 *  have, so that what they are all docked against keeps its own. */
	readonly others: number;
	/** The width it takes now; null while it takes none. */
	takes(width: number | null): void;
	/** Off the page, and the width it owed goes with it. */
	leaves(): void;
}

/** A place in the stack of docks down the right edge. The higher `outer` is,
 *  the further from the graph the dock stands, so the one that stays is
 *  outermost and what is opened to read beside it sits between the two. */
export function docksRight(outer: number): RightDock {
	const mine = new Standing(outer);
	docks.push(mine);
	return {
		get from() {
			return docks.reduce((sum, one) => (one.outer > outer ? sum + (one.width ?? 0) : sum), 0);
		},
		get others() {
			return docks.reduce((sum, one) => (one === mine ? sum : sum + (one.width ?? 0)), 0);
		},
		takes(width: number | null) {
			mine.width = width;
			publish();
		},
		leaves() {
			const at = docks.indexOf(mine);
			if (at >= 0) docks.splice(at, 1);
			publish();
		}
	};
}
