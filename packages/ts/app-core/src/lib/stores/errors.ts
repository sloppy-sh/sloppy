import { SloppyApiError } from '@sloppy/client';

/**
 * The server's own words for a person, where it gave any. A surface shows this
 * when it has it and its own line when it does not; `SloppyApiError.message`
 * names a path and a status and may never reach a person.
 */
export function serverMessage(err: unknown): string | undefined {
	return err instanceof SloppyApiError ? err.detail : undefined;
}
