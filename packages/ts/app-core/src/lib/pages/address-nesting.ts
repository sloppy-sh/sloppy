// What writing an address on a note means for where the note sits. AI.md §
// "The Genealogy Is the Protocol" is why the two are never left disagreeing.

import {
	InvalidAddressError,
	isInSubtree,
	parentAddress,
	type Address,
	type OwnedRef
} from '@sloppy/types';

/** A note as this decision reads one. */
export interface NestingNote {
	ref: OwnedRef;
	address?: Address;
	/** Addresses this note has been carried away from, which still lead to it. */
	aliases?: readonly Address[];
	parent?: OwnedRef;
	title: string;
}

export type AddressNesting =
	/** The label agrees with where the note already sits; write it and say nothing. */
	| { act: 'write' }
	/** A note in this graph is at the address the label springs from, or was at
	 *  it and still leads to it. Exactly one of the two follows: `address` is
	 *  what the moved note takes, where the note it lands under is at the address
	 *  the label springs from; `wasAt` is the address that led there otherwise,
	 *  and the run the note joins decides what it takes. */
	| { act: 'carry'; under: NestingNote; address?: Address; wasAt?: Address }
	/** The label is a branch's own number, and the note springs from something. */
	| { act: 'branch'; address: Address }
	/** Nothing in this graph is at the address the label springs from. `write` is
	 *  the notes that would have to be written for it to be, topmost first, and
	 *  the note the topmost of them hangs under — absent where that one opens a
	 *  branch. `write` itself is absent where an address on that chain has been
	 *  spent already, which is nobody's to write a note at. */
	| {
			act: 'nowhere';
			parent: Address;
			address: Address;
			write?: { missing: readonly [Address, ...Address[]]; under?: NestingNote };
	  }
	| { act: 'refuse'; words: string };

/**
 * What the person means by writing `taking` on `note`: the label alone, or the
 * label and a move to where it says the note springs from. `graph` is the notes
 * of the graph this one is read in, this device's whole reach of it — a note
 * missing from it is a question this cannot answer, so the label is written and
 * the graph is left as it is.
 */
export function addressNesting(
	note: NestingNote,
	taking: Address,
	graph: readonly NestingNote[]
): AddressNesting {
	const springs = impliedParent(taking);
	if (springs === undefined) return { act: 'write' };

	const above = note.parent === undefined ? null : graph.find((one) => one.ref === note.parent);
	if (above === undefined) return { act: 'write' };
	if (springs === null) {
		return above === null ? { act: 'write' } : { act: 'branch', address: taking };
	}
	if (above !== null && leadsTo(above, springs)) return { act: 'write' };

	const found = graph.find((one) => leadsTo(one, springs));
	if (found === undefined) return nothingAt(note, springs, taking, graph);
	const cycles = wouldCycle(note, found, springs, taking, graph);
	if (cycles) return cycles;
	return found.address === springs
		? { act: 'carry', under: found, address: taking }
		: { act: 'carry', under: found, wasAt: springs };
}

/** The chain of notes nobody has written between the graph and `springs`, and
 *  the note that chain would hang under. */
function nothingAt(
	note: NestingNote,
	springs: Address,
	taking: Address,
	graph: readonly NestingNote[]
): AddressNesting {
	const answer = { act: 'nowhere', parent: springs, address: taking } as const;
	const missing: [Address, ...Address[]] = [springs];
	for (let at = impliedParent(springs); at != null; at = impliedParent(at)) {
		const reached = at;
		const found = graph.find((one) => leadsTo(one, reached));
		if (found === undefined) {
			missing.unshift(reached);
			continue;
		}
		const cycles = wouldCycle(note, found, reached, taking, graph);
		if (cycles) return cycles;
		return found.address === reached ? { ...answer, write: { missing, under: found } } : answer;
	}
	return { ...answer, write: { missing } };
}

/** Whether the note would end up springing from itself by landing under
 *  `found`, whose address is `at`. */
function wouldCycle(
	note: NestingNote,
	found: NestingNote,
	at: Address,
	taking: Address,
	graph: readonly NestingNote[]
): AddressNesting | null {
	if (found.ref === note.ref) {
		return {
			act: 'refuse',
			words: `${taking} would make this note spring from itself. Pick another number.`
		};
	}
	if (!beneath(note, found, graph)) return null;
	return {
		act: 'refuse',
		words: `${at} springs from this note, so this note cannot spring from it. Pick a number outside it.`
	};
}

/** `undefined` where the number in it is larger than a graph can carry, which
 *  the server refuses in its own words. */
function impliedParent(address: Address): Address | null | undefined {
	try {
		return parentAddress(address);
	} catch (error) {
		if (error instanceof InvalidAddressError) return undefined;
		throw error;
	}
}

/** Whether `address` reaches this note: what it is at, or what it was at. */
function leadsTo(note: NestingNote, address: Address): boolean {
	return note.address === address || (note.aliases?.includes(address) ?? false);
}

/** Whether `target` lies under `note`: by the genealogy where this reach holds
 *  the chain up from it, and by the addresses where it does not. */
function beneath(note: NestingNote, target: NestingNote, graph: readonly NestingNote[]): boolean {
	if (
		note.address !== undefined &&
		target.address !== undefined &&
		isInSubtree(note.address, target.address)
	) {
		return true;
	}
	const walked = new Set<OwnedRef>();
	let up = target.parent;
	while (up !== undefined && !walked.has(up)) {
		if (up === note.ref) return true;
		walked.add(up);
		up = graph.find((one) => one.ref === up)?.parent;
	}
	return false;
}
