// Words already written for a person, carried on the act that did not happen —
// AI.md § "User-Facing Copy Names the Outcome, Never the Mechanism".

/**
 * An act a surface asked for that did not happen, saying so in words somebody
 * wrote for a person to read. A host rejects with one where it has such words;
 * anything else it rejects with is the inside of an error, which no surface
 * shows.
 */
export class Refusal extends Error {
	constructor(says: string, options?: ErrorOptions) {
		super(says, options);
		this.name = 'Refusal';
	}
}

/** What a surface shows when an act did not happen: the words on a refusal, or
 *  its own line about what to try. */
export function refusedWith(error: unknown, otherwise: string): string {
	const said = error instanceof Refusal ? error.message.trim() : '';
	return said || otherwise;
}
