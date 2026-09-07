/**
 * Which modal surfaces are up, as a stack rather than a flag so a second sheet
 * over a first does not clear the state when it closes, and so the one on top
 * can be closed without knowing what it is.
 *
 * The hand-off between components that must not know about each other: a modal
 * DECLARES itself open and how it closes, and the rest DECIDE what to do about
 * it — the shell hides the nav pill, since a `fixed` pill floats over an open
 * sheet and clips its footer, and Android's back gesture takes the top one off.
 */
class OverlayState {
	#closers = $state<Array<() => void>>([]);

	get open(): boolean {
		return this.#closers.length > 0;
	}

	/** Returns the disposer that declares it closed again; calling it twice is a
	 *  no-op, so an `$effect` cleanup can own it. */
	push(close: () => void): () => void {
		this.#closers.push(close);
		let released = false;
		return () => {
			if (released) return;
			released = true;
			const at = this.#closers.indexOf(close);
			if (at !== -1) this.#closers.splice(at, 1);
		};
	}

	/** Closes the surface that went up last, and answers whether there was one.
	 *  The surface's own close runs, so it dismisses the way it would to a tap. */
	closeTop(): boolean {
		const close = this.#closers.at(-1);
		if (!close) return false;
		close();
		return true;
	}
}

export const overlay = new OverlayState();
