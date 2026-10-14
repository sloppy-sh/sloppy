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

	/** What that chrome will not give up, for deciding whether there is room to
	 *  stand beside it. A column the reader has taken a width for yields to a
	 *  dock opening, so what it takes now is no answer there — it is a number the
	 *  dock's own arrival moves. One still sizing itself to the window yields
	 *  nothing, and keeps the whole of what it takes. */
	get least(): number {
		return this.#least;
	}

	takes(px: number, least = px): void {
		this.#start = px;
		this.#least = least;
	}
}

export const chromeInset = new ChromeInset();
