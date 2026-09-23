import { SloppyApiError } from '@sloppy/client';
import { Refusal } from '@sloppy/ui';

/** A framework's phrase, never words a person can act on. */
const UNWRITTEN = 'Internal server error';

/**
 * The server's own words for a person, where it gave any. A surface shows this
 * when it has it and its own line when it does not; `SloppyApiError.message`
 * names a path and a status and may never reach a person.
 */
export function serverMessage(err: unknown): string | undefined {
	if (!(err instanceof SloppyApiError)) return undefined;
	if (err.status >= 500 && err.detail === UNWRITTEN) return undefined;
	return err.detail;
}

/**
 * Words somebody wrote for a person to read, where anything did: a server's or
 * a graph on this device's own answer, a refusal already carrying them, or the
 * line the native shell rejects with, which crosses its bridge as a bare
 * string. Anything else is the inside of an error and reaches no screen.
 */
export function wordsFor(err: unknown): string | undefined {
	const said =
		typeof err === 'string' ? err : err instanceof Refusal ? err.message : serverMessage(err);
	return said?.trim() || undefined;
}

/** What a surface in `@sloppy/ui` is rejected with, so what it shows a person is
 *  the words something wrote for one and its own line otherwise. */
export function refusal(error: unknown, otherwise: string): Refusal {
	return new Refusal(wordsFor(error) ?? otherwise, { cause: error });
}
