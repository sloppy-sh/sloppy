/**
 * The room the chrome standing at the page's start edge takes, in px, for
 * whatever bounds itself against the rest of the window — DESIGN.md § "The
 * four inset vars". One writer, the way `dock-stack` has one.
 */

class ChromeInset {
	#start = $state(0);
	#least = $state(0);

	/** 0 wherever no column stands. */
	get start(): number {
		return this.#start;
	}

	/** The least that chrome will shrink to, for deciding whether there is room
	 *  to stand beside it. What it takes now is no answer to that: the column
	 *  yields to a dock opening, so a dock that asked it would be reading a
	 *  number its own arrival moves. */
	get least(): number {
		return this.#least;
	}

	takes(px: number, least = px): void {
		this.#start = px;
		this.#least = least;
	}
}

export const chromeInset = new ChromeInset();
