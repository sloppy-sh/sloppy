import { SloppyApiError } from '@sloppy/client';

/** A status whose body describes our own wiring rather than the reader's
 *  situation — a route that is not there, a server that fell over. */
function aboutUs(status: number): boolean {
	return status === 404 || status >= 500;
}

/**
 * What to put in front of a person when a call failed. The server's own words
 * where it chose some for a reader — `SloppyApiError.detail` — and ours where
 * it did not.
 */
export function reason(error: unknown, fallback: string): string {
	if (error instanceof SloppyApiError && error.detail && !aboutUs(error.status)) {
		return error.detail;
	}
	return fallback;
}

/** A credential the server refused, as distinct from a call that never landed. */
export function isSignedOut(error: unknown): boolean {
	return error instanceof SloppyApiError && error.status === 401;
}
