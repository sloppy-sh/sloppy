// A router for the suites that mount a page: where the reader is, and the
// entries they can go back and forward to.

/** Where the router has the reader, for a suite standing in for it. */
export const at = $state<{ path: string; note: string | null }>({ path: '/', note: null });

interface Entry {
	path: string;
	note: string | null;
}

let entries: Entry[] = [{ path: '/', note: null }];
let standing = 0;

function stand(): void {
	at.path = entries[standing].path;
	at.note = entries[standing].note;
}

/** One entry, nothing behind it and nothing ahead. */
export function startAt(path = '/'): void {
	entries = [{ path, note: null }];
	standing = 0;
	stand();
}

/** An empty path leaves the reader where they are, as `pushState` does. */
export function pushed(path: string, note: string | null): void {
	entries = [...entries.slice(0, standing + 1), { path: path || at.path, note }];
	standing = entries.length - 1;
	stand();
}

export function replaced(path: string, note: string | null): void {
	entries[standing] = { path: path || at.path, note };
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
