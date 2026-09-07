import { SloppyApiError } from '@sloppy/client';
import { describe, expect, it } from 'vitest';
import { serverMessage } from './errors.js';

describe('the server’s own words for a person', () => {
	it('are shown where the server wrote some', () => {
		const err = new SloppyApiError(400, 'POST /graphs failed with 400', {
			detail: 'That name is already taken.'
		});

		expect(serverMessage(err)).toBe('That name is already taken.');
	});

	it('are nothing where the failure carried none', () => {
		expect(serverMessage(new SloppyApiError(500, 'GET /graphs failed with 500'))).toBeUndefined();
		expect(serverMessage(new Error('a bug in a component'))).toBeUndefined();
	});

	it('are nothing where a framework answered for the server', () => {
		const err = new SloppyApiError(500, 'GET /graphs failed with 500', {
			detail: 'Internal server error'
		});

		expect(serverMessage(err)).toBeUndefined();
	});

	it('still show a refusal that happens to be worded that way', () => {
		const err = new SloppyApiError(400, 'GET /graphs failed with 400', {
			detail: 'Internal server error'
		});

		expect(serverMessage(err)).toBe('Internal server error');
	});
});
