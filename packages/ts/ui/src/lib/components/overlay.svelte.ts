/**
 * Whether a modal surface is up, as a count rather than a flag so stacked
 * sheets do not clear the state when the first one closes.
 *
 * The hand-off between two components that must not know about each other: a
 * modal DECLARES itself open, and the shell DECIDES what to do about it — which
 * is to hide the nav pill, since a `fixed` pill floats over an open sheet and
 * clips its footer.
 */
class OverlayState {
	#count = $state(0);

	get open(): boolean {
		return this.#count > 0;
	}

	/** Returns the disposer that declares it closed again; calling it twice is a
	 *  no-op, so an `$effect` cleanup can own it. */
	push(): () => void {
		this.#count++;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.#count = Math.max(0, this.#count - 1);
		};
	}
}

export const overlay = new OverlayState();
