import { SloppyApiError } from '@sloppy/client';

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
