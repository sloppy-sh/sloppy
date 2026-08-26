import { SloppyApiError } from '@sloppy/client';
import { describe, expect, it } from 'vitest';
import { isSignedOut, reason } from './errors.js';

const OURS = 'Sloppy is not answering right now. Try again in a moment.';

describe('reason', () => {
	it('passes through what the server wrote for a reader', () => {
		const error = new SloppyApiError(400, 'log line', {
			detail: 'That address does not offer sign-in.'
		});
		expect(reason(error, OURS)).toBe('That address does not offer sign-in.');
	});

	it('keeps a missing route to ourselves', () => {
		const error = new SloppyApiError(404, 'log line', { detail: 'Cannot GET /api/auth/me' });
		expect(reason(error, OURS)).toBe(OURS);
	});

	it('keeps a server failure to ourselves', () => {
		const error = new SloppyApiError(500, 'log line', { detail: 'Internal server error' });
		expect(reason(error, OURS)).toBe(OURS);
	});

	it('answers for a failure that never reached the server', () => {
		expect(reason(new TypeError('Failed to fetch'), OURS)).toBe(OURS);
	});
});

describe('isSignedOut', () => {
	it('is true only for a refused credential', () => {
		expect(isSignedOut(new SloppyApiError(401, 'log line'))).toBe(true);
		expect(isSignedOut(new SloppyApiError(403, 'log line'))).toBe(false);
		expect(isSignedOut(new TypeError('Failed to fetch'))).toBe(false);
	});
});
