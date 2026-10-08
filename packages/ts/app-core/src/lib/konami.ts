// The keystroke one of the two eggs answers — DESIGN.md § Eggs is the doc of
// record for what an egg may and may not be.

/** Up up down down left right left right B A, as `KeyboardEvent.key` spells
 *  each one, lowercased so a held shift still reads as the letter. */
const CODE = [
	'arrowup',
	'arrowup',
	'arrowdown',
	'arrowdown',
	'arrowleft',
	'arrowright',
	'arrowleft',
	'arrowright',
	'b',
	'a'
];

const WRITING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/**
 * Watch the window for the code, and run `onEntered` each time it is finished.
 * Returns the function that stops watching.
 *
 * A key that went into a field or into somebody's writing is not read at all,
 * so typing never trips it.
 */
export function watchForKonami(onEntered: () => void): () => void {
	let reached = 0;

	const onKey = (event: KeyboardEvent): void => {
		const at = event.target;
		if (at instanceof Element && at.closest(WRITING) !== null) return;
		// A chord belongs to whatever binds it, and leaves the run where it was.
		if (event.metaKey || event.ctrlKey || event.altKey) return;

		const key = event.key.toLowerCase();
		if (key === CODE[reached]) {
			reached += 1;
			if (reached < CODE.length) return;
			reached = 0;
			onEntered();
			return;
		}
		// A wrong key is not necessarily a wrong start.
		reached = key === CODE[0] ? 1 : 0;
	};

	window.addEventListener('keydown', onKey);
	return () => window.removeEventListener('keydown', onKey);
}
