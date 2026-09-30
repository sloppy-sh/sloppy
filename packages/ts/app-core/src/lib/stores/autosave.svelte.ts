/**
 * Keeping a version while somebody writes, on their own clock —
 * docs/ARCHITECTURE.md § "The vault's history". It is off until somebody asks
 * for it, it keeps on a line of work, and it never says anything on screen.
 */

import { runtime } from '../runtime.js';
import { graphHistory } from './history.svelte.js';
import { prefs } from './prefs.svelte.js';
import { troubleIn, whatHappened } from './what-happened.svelte.js';

/** What a version kept this way is called, so a run of them reads as one
 *  thing rather than as a hundred separate decisions. */
export const WHILE_WRITING = 'While you were writing';

/** Whether a version this way may be kept right now: something to keep it in,
 *  somebody who asked for it, and nothing else going on in the folder. */
function worthATry(): boolean {
	return (
		graphHistory.keeps &&
		prefs.current.autosave &&
		!graphHistory.busy &&
		graphHistory.merging === null
	);
}

/**
 * Keep one now, if there is anything to keep. Nothing to keep is the ordinary
 * answer and is not a failure; a folder in the middle of something the person
 * began refuses, and that is the person's own repository being used correctly,
 * so it is recorded rather than put in front of them.
 */
export async function saveNow(): Promise<void> {
	if (!worthATry()) return;
	const history = runtime.history();
	if (!history) return;
	if (!(await graphHistory.lineToWriteOn())) {
		whatHappened.put(
			'trouble',
			`a version was not kept while writing: ${graphHistory.says ?? 'there was no line to keep it on'}`
		);
		return;
	}
	try {
		await history.commit(WHILE_WRITING);
		await graphHistory.read();
	} catch (trouble) {
		whatHappened.put('trouble', `a version was not kept while writing: ${troubleIn(trouble)}`);
	}
}

/**
 * Start keeping versions on the clock. Returns the disposer. **Nothing runs
 * until somebody has turned it on**, and the interval is read again each tick
 * so changing the period does not need this started over.
 */
export function savesWhileWriting(): () => void {
	if (typeof window === 'undefined') return () => {};
	let timer: ReturnType<typeof setTimeout> | undefined;
	let going = true;

	const again = (): void => {
		if (!going) return;
		timer = setTimeout(async () => {
			await saveNow();
			again();
		}, prefs.current.autosaveMinutes * 60_000);
	};

	// What was written stays written when the window goes away — the one moment
	// a period would be too late.
	const whenHidden = (): void => {
		if (document.visibilityState === 'hidden') void saveNow();
	};

	again();
	document.addEventListener('visibilitychange', whenHidden);
	return () => {
		going = false;
		if (timer !== undefined) clearTimeout(timer);
		document.removeEventListener('visibilitychange', whenHidden);
	};
}
