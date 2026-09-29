/**
 * The room the chrome standing at the page's start edge takes, in px, for
 * whatever bounds itself against the rest of the window — DESIGN.md § "The
 * four inset vars". One writer, the way `dock-stack` has one.
 */

class ChromeInset {
	#start = $state(0);

	/** 0 wherever no column stands. */
	get start(): number {
		return this.#start;
	}

	takes(px: number): void {
		this.#start = px;
	}
}

export const chromeInset = new ChromeInset();
