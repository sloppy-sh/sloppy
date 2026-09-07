import { SloppyApiError } from '@sloppy/client';

/** A framework's phrase rather than words for a person, and the one thing a
 *  server still old enough to send it has not said. */
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
