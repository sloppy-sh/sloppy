// What an egg has asked for, for the surface that draws one to watch —
// DESIGN.md § Eggs.

/** A count rather than a flag, so asking twice is answered twice. */
class EggsAsked {
	#sweeps = $state(0);

	get sweeps(): number {
		return this.#sweeps;
	}

	sweep(): void {
		this.#sweeps += 1;
	}
}

export const eggs = new EggsAsked();
