// A router for the suites that mount a page: where the reader is, and the
// entries they can go back and forward to.

/** Where the router has the reader, for a suite standing in for it. `landing`
 *  is the part of the note the entry was pushed at, where it names one. */
export const at = $state<{
	path: string;
	note: string | null;
	notes: string[];
	landing: string | null;
}>({
	path: '/',
	note: null,
	notes: [],
	landing: null
});

interface Entry {
	path: string;
	note: string | null;
	notes: string[];
	landing: string | null;
}

let entries: Entry[] = [{ path: '/', note: null, notes: [], landing: null }];
let standing = 0;

function stand(): void {
	at.path = entries[standing].path;
	at.note = entries[standing].note;
	at.notes = entries[standing].notes;
	at.landing = entries[standing].landing;
}

/** One entry, nothing behind it and nothing ahead. */
export function startAt(path = '/'): void {
	entries = [{ path, note: null, notes: [], landing: null }];
	standing = 0;
	stand();
}

/** An empty path leaves the reader where they are, as `pushState` does. */
export function pushed(
	path: string,
	note: string | null,
	notes: string[] = [],
	landing: string | null = null
): void {
	entries = [...entries.slice(0, standing + 1), { path: path || at.path, note, notes, landing }];
	standing = entries.length - 1;
	stand();
}

export function replaced(
	path: string,
	note: string | null,
	notes: string[] = [],
	landing: string | null = null
): void {
	entries[standing] = { path: path || at.path, note, notes, landing };
	stand();
}

export function back(): void {
	if (standing > 0) standing -= 1;
	stand();
}

export function forward(): void {
	if (standing < entries.length - 1) standing += 1;
	stand();
}
